"""Muestreo de performance del Mac Mini SIN sudo, para el panel en vivo de Sistema.

Fuentes (verificadas en el M4):
  - CPU total:   ps -Ao pcpu (suma/ncpu) — ~15ms
  - GPU:         ioreg -c IOAccelerator → "Device Utilization %" — ~20ms
  - RAM:         vm_stat (active+wired+compressed) vs hw.memsize
  - Swap:        sysctl vm.swapusage
  - Térmica:     pmset -g therm → CPU_Speed_Limit (100 = sin throttle; <100 = throttling).
                 macOS no expone °C sin sudo (powermetrics) — se reporta presión, no grados.
  - Por-job:     ps por process-group (run_tracked usa setsid → pgid = pid líder)
                 + docker stats para contenedores ODM (lento ~1s → se muestrea cada 3 ticks)

Diseño: el hilo muestrea a 1Hz SOLO mientras alguien consulta (último poll < 20s) —
idle = 0 costo, mismo contrato que el render-on-demand de los visores. El cliente
renderiza a 60fps interpolando entre muestras de 1Hz.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
DOCKER = "/usr/local/bin/docker"
NCPU = os.cpu_count() or 10
PAGE = 16384

_HW_MEM = None


def _run(cmd: list, timeout: float = 3) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (subprocess.TimeoutExpired, OSError):
        return ""


def hw_mem() -> int:
    global _HW_MEM
    if _HW_MEM is None:
        try:
            _HW_MEM = int(_run(["sysctl", "-n", "hw.memsize"]).strip() or 0)
        except ValueError:
            _HW_MEM = 0
    return _HW_MEM


def cpu_gpu_snapshot() -> tuple[float, float, list]:
    """(cpu_total_pct, gpu_pct, proc_rows[pid,pgid,pcpu,rss_kb]) en UNA pasada de ps."""
    rows = []
    total = 0.0
    for line in _run(["ps", "-Ao", "pid,pgid,pcpu,rss"]).splitlines()[1:]:
        p = line.split()
        if len(p) < 4:
            continue
        try:
            pid, pgid, pcpu, rss = int(p[0]), int(p[1]), float(p[2]), int(p[3])
        except ValueError:
            continue
        total += pcpu
        rows.append((pid, pgid, pcpu, rss))
    gpu = 0
    m = re.search(r'"Device Utilization %"=(\d+)',
                  _run(["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]))
    if m:
        gpu = int(m.group(1))
    return min(100.0, total / NCPU), float(gpu), rows


def mem_swap() -> tuple[float, float, float, float]:
    """(ram_used_gb, ram_total_gb, swap_used_mb, swap_total_mb)."""
    used_pages = 0
    for line in _run(["vm_stat"]).splitlines():
        for key in ("Pages active", "Pages wired down", "Pages occupied by compressor"):
            if line.startswith(key):
                try:
                    used_pages += int(line.split(":")[1].strip().rstrip("."))
                except (ValueError, IndexError):
                    pass
    sw = _run(["sysctl", "-n", "vm.swapusage"])
    ms = re.findall(r"= *([\d.]+)M", sw)   # total, used, free
    swap_total, swap_used = (float(ms[0]), float(ms[1])) if len(ms) >= 2 else (0.0, 0.0)
    return used_pages * PAGE / 1024**3, hw_mem() / 1024**3, swap_used, swap_total


def thermal() -> dict:
    """CPU_Speed_Limit de pmset: 100 = nominal, <100 = throttling térmico."""
    out = _run(["pmset", "-g", "therm"])
    m = re.search(r"CPU_Speed_Limit\s*=\s*(\d+)", out)
    limit = int(m.group(1)) if m else 100
    return {"speed_limit": limit, "throttling": limit < 100}


def job_usage(jobs: list, proc_rows: list, docker_cache: dict) -> list:
    """CPU/RSS por job corriendo: suma del process-group del pid + docker stats del contenedor."""
    out = []
    for j in jobs:
        cpu = rss_mb = 0.0
        pid = j.get("pid")
        if pid:
            for _p, pgid, pcpu, rss in proc_rows:
                if pgid == pid:
                    cpu += pcpu
                    rss_mb += rss / 1024
        cont = j.get("container")
        if cont and cont in docker_cache:
            dc = docker_cache[cont]
            cpu += dc.get("cpu", 0.0)
            rss_mb += dc.get("mem_mb", 0.0)
        started = j.get("started") or time.time()
        out.append({"id": j.get("id"), "kind": j.get("kind"), "label": j.get("label"),
                    "stage": j.get("stage"), "progress": j.get("progress"),
                    "detail": (j.get("detail") or "")[:90],
                    "elapsed_s": round(time.time() - started),
                    "cpu_pct": round(cpu, 1), "rss_mb": round(rss_mb)})
    return out


def docker_stats() -> dict:
    """{nombre: {cpu, mem_mb}} — LENTO (~1s), llamar poco."""
    out = {}
    for line in _run([DOCKER, "stats", "--no-stream", "--format",
                      "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"], timeout=5).splitlines():
        p = line.split("\t")
        if len(p) < 3:
            continue
        try:
            cpu = float(p[1].rstrip("%"))
            memtxt = p[2].split("/")[0].strip()
            mult = {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024}.get(memtxt[-3:], 0)
            mem = float(memtxt[:-3]) * mult if mult else 0.0
        except (ValueError, IndexError):
            continue
        out[p[0]] = {"cpu": cpu, "mem_mb": mem}
    return out


class PerfSampler:
    """Hilo 1Hz on-demand con ring buffer de 3 min. get() lo (re)activa."""

    def __init__(self, jobstore):
        self.jobstore = jobstore
        self.buf = deque(maxlen=180)
        self.last_poll = 0.0
        self._lock = threading.Lock()
        self._running = False
        self._docker_cache = {}
        self._tick_n = 0

    def _sample(self):
        cpu, gpu, rows = cpu_gpu_snapshot()
        ram_used, ram_total, sw_used, sw_total = mem_swap()
        th = thermal()
        try:
            jobs = [j for j in self.jobstore.recent(12)
                    if j.get("status") in ("running", "queued")]
        except Exception:
            jobs = []
        # docker stats cada 3 ticks y solo si hay contenedores de jobs (es lento)
        self._tick_n += 1
        if any(j.get("container") for j in jobs) and self._tick_n % 3 == 1:
            self._docker_cache = docker_stats()
        try:
            disk_free = round(shutil.disk_usage(VAULT).free / 1024**3, 1)
        except OSError:
            disk_free = None
        return {
            "ts": round(time.time(), 2),
            "cpu": round(cpu, 1), "gpu": round(gpu, 1),
            "load1": os.getloadavg()[0],
            "ram_used_gb": round(ram_used, 2), "ram_total_gb": round(ram_total, 1),
            "swap_used_mb": round(sw_used), "swap_total_mb": round(sw_total),
            "thermal": th, "disk_free_gb": disk_free,
            "jobs": job_usage(jobs, rows, self._docker_cache),
        }

    def _loop(self):
        while True:
            with self._lock:
                if time.time() - self.last_poll > 20:      # nadie mira → duerme el hilo
                    self._running = False
                    return
            try:
                s = self._sample()
                self.buf.append(s)
            except Exception:
                pass
            time.sleep(1.0)

    def get(self) -> dict:
        with self._lock:
            self.last_poll = time.time()
            if not self._running:
                self._running = True
                threading.Thread(target=self._loop, daemon=True).start()
        # primer poll: muestra síncrona para no responder vacío
        if not self.buf:
            try:
                self.buf.append(self._sample())
            except Exception:
                pass
        hist = list(self.buf)
        return {"now": hist[-1] if hist else None, "history": hist,
                "ncpu": NCPU, "sampling_hz": 1}


# ---------- registro central de errores ----------
ERRLOG = VAULT / "ops" / "errors.jsonl"


def log_error(source: str, msg: str, ctx: dict | None = None):
    """Append estructurado a ops/errors.jsonl (el reporte DeepSeek lo consume)."""
    try:
        ERRLOG.parent.mkdir(parents=True, exist_ok=True)
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "source": source, "msg": str(msg)[:500]}
        if ctx:
            rec["ctx"] = {k: str(v)[:200] for k, v in ctx.items()}
        with open(ERRLOG, "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        # rotación simple: >2MB → conserva la mitad final
        if ERRLOG.stat().st_size > 2_000_000:
            lines = ERRLOG.read_text().splitlines()
            ERRLOG.write_text("\n".join(lines[len(lines) // 2:]) + "\n")
    except OSError:
        pass
