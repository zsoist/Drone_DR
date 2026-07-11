"""Perfil de hardware: UNA fuente de verdad para los caps de memoria/concurrencia.

Antes los límites vivían como literales regados (worker.py OPENSPLAT_MEMORY_MIB,
PRESETS "7g"/"8500m", capture_quality "11GB"...). El problema no era el valor —
era que NADA los ataba a la máquina real: mover el vault a otra Mac dejaba caps
calibrados para 16GB corriendo sobre hardware distinto, sin aviso.

config/hardware.json tiene dos secciones:
  machine — hechos detectados (sysctl/docker), se regeneran con --detect
  caps    — límites OPERATIVOS elegidos para esa máquina (los ex-literales).
            Son decisiones calibradas (el 11GB sobrevivió 3 OOMs reales), no
            derivaciones automáticas: detect() los siembra, el operador los ajusta.

Uso:
    from hwconfig import load
    HW = load()                      # lee (o crea) config/hardware.json
    cap = HW["caps"]["opensplat_mib"]

    python3 hwconfig.py --detect     # re-detecta y reescribe la sección machine
"""
import json
import subprocess
import sys
import time
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "config" / "hardware.json"

# caps calibrados para el M4/16GB (los valores que vivían hardcodeados en worker.py)
DEFAULT_CAPS = {
    "opensplat_mib": 11_000,                       # taskpolicy -m: SIGKILL al superarlo
    "odm_light": {"mem": "7g", "concurrency": 4},   # rapido/estandar + fast-ortho fallback
    "odm_heavy": {"mem": "8500m", "concurrency": 2},  # alta/extra/ultra + retry OpenMVS
}


def _run(cmd: list, timeout: float = 10) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (subprocess.TimeoutExpired, OSError):
        return ""


def _sysctl(key: str) -> int:
    try:
        return int(_run(["sysctl", "-n", key]).strip() or 0)
    except ValueError:
        return 0


def detect_machine() -> dict:
    """Detección completa (docker info tarda ~1s — solo se corre al generar, no al cargar)."""
    docker_mem_gb = 0.0
    for line in _run(["/usr/local/bin/docker", "info"], timeout=20).splitlines():
        if "Total Memory" in line:
            try:
                docker_mem_gb = round(float(line.split(":")[1].strip().rstrip("GiB").strip()), 2)
            except (ValueError, IndexError):
                pass
    gpu_cores = 0
    for line in _run(["system_profiler", "SPDisplaysDataType"], timeout=30).splitlines():
        if "Total Number of Cores" in line:
            try:
                gpu_cores = int(line.split(":")[1].strip())
            except (ValueError, IndexError):
                pass
    return {
        "detected_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "system_ram_gb": round(_sysctl("hw.memsize") / 2**30, 1),
        "cpu_cores": _sysctl("hw.ncpu"),
        "perf_cores": _sysctl("hw.perflevel0.physicalcpu"),
        "eff_cores": _sysctl("hw.perflevel1.physicalcpu"),
        "gpu_cores": gpu_cores,
        "unified_memory": True,
        "container_mem_limit_gb": docker_mem_gb,
    }


# Piso: por debajo de esto ningún preset entrena de forma útil.
_MIN_VIABLE_OPENSPLAT_MIB = 4096


def _on_ram_mismatch(recorded_gb: float, live_gb: float, cfg: dict) -> dict:
    """Política asimétrica: hacia arriba conserva (seguro, desperdicia);
    hacia abajo escala con piso (degradado, vivo); imposible → muere claro.
    Nunca silencioso, nunca reescribe el JSON, siempre marca provisional.
    En Apple Silicon un mismatch implica OTRA máquina: la calibración
    registrada no es válida aquí — solo operamos en modo degradado.

    Deuda anotada: solo se escala opensplat_mib (el cap que mata jobs). Los caps
    de ODM (7g/8500m) y la concurrencia también quedan inválidos en máquina menor,
    pero ODM corre en Docker con su propio límite de VM — esa interacción se mide,
    no se hereda por heurística encadenada.
    """
    import perf                                   # tardío: evita ciclos al usar hwconfig standalone
    ctx = {"recorded_gb": recorded_gb, "live_gb": live_gb}

    if live_gb > recorded_gb:
        # Máquina más grande: caps calibrados son conservadores → seguros.
        perf.log_error(
            "hwconfig",
            f"RAM mismatch: live {live_gb}GB > recorded {recorded_gb}GB. "
            f"Keeping calibrated caps (conservative). Recalibrate: "
            f"delete config/hardware.json and rerun detection.",
            ctx=ctx,
        )
        cfg["provisional"] = True
        cfg["provisional_reason"] = f"ram_up:{recorded_gb}->{live_gb}"
        return cfg

    # Máquina más chica: escalar proporcional con piso.
    ratio = live_gb / recorded_gb
    scaled = int(cfg["caps"]["opensplat_mib"] * ratio)

    if scaled < _MIN_VIABLE_OPENSPLAT_MIB:
        # No existe operación segura: morir con diagnóstico > SIGKILL mudo.
        perf.log_error(
            "hwconfig",
            f"RAM mismatch FATAL: live {live_gb}GB scales opensplat cap to "
            f"{scaled}MiB, below viable floor {_MIN_VIABLE_OPENSPLAT_MIB}MiB. "
            f"Refusing to run splat workloads on this hardware.",
            ctx={**ctx, "scaled_mib": scaled},
        )
        raise SystemExit(
            f"hwconfig: {live_gb}GB insufficient for calibrated workloads "
            f"(min viable {_MIN_VIABLE_OPENSPLAT_MIB}MiB, scaled {scaled}MiB)"
        )

    perf.log_error(
        "hwconfig",
        f"RAM mismatch: live {live_gb}GB < recorded {recorded_gb}GB. "
        f"Scaling opensplat cap {cfg['caps']['opensplat_mib']}→{scaled}MiB "
        f"(provisional — recalibrate on this machine).",
        ctx={**ctx, "scaled_mib": scaled},
    )
    cfg["caps"]["opensplat_mib"] = scaled
    cfg["provisional"] = True
    cfg["provisional_reason"] = f"ram_down_scaled:{recorded_gb}->{live_gb}"
    return cfg


_CACHE = None


def load() -> dict:
    """Lee config/hardware.json (lo crea si falta). Chequeo barato de coherencia:
    solo hw.memsize (~5ms) contra lo registrado — la detección completa es de --detect."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    if CONFIG.exists():
        cfg = json.loads(CONFIG.read_text())
    else:
        cfg = {"machine": detect_machine(), "caps": DEFAULT_CAPS}
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps(cfg, indent=1))
    live_gb = round(_sysctl("hw.memsize") / 2**30, 1)
    if live_gb and abs(live_gb - cfg["machine"].get("system_ram_gb", 0)) >= 1:
        cfg = _on_ram_mismatch(cfg["machine"].get("system_ram_gb", 0), live_gb, cfg)
    _CACHE = cfg
    return cfg


if __name__ == "__main__":
    if "--detect" in sys.argv:
        cfg = json.loads(CONFIG.read_text()) if CONFIG.exists() else {"caps": DEFAULT_CAPS}
        cfg["machine"] = detect_machine()
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps(cfg, indent=1))
        print(json.dumps(cfg, indent=1))
    else:
        print(json.dumps(load(), indent=1))
