"""Canario semanal del trainer: el mismo splat corto, trended en DOS series.

Nace del P0 (11-jul): el sistema operó días con un preset sobre-presupuesto y
nadie lo vio porque nada trendeaba. El canario re-entrena SIEMPRE el mismo
escenario (fast, escena fija, mismo split de gaussianas iniciales) y anota
peak_mib + duration_s a un jsonl. Las señales, por condición y no por
calendario: peak ≥20% sobre la mediana histórica = el presupuesto se movió;
duración ≥2× = swap-thrashing silencioso (la firma del 7-jul: completar
lento nadando en swap ES un síntoma, no un pass).
Corre vía launchd com.aerobrain.canary-splat (domingos 04:30) — sin LLM,
sin OAuth, puro shell+python (lane permitida)."""
import json
import subprocess
import sys
import time
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
SCENE = "DJI_20260706133809_0101_D"          # escena 1 de baseline-v1: chica y estable
TREND = VAULT / "ops" / "canary-splat.jsonl"
PIPE = Path(__file__).resolve().parent

sys.path.insert(0, str(PIPE))
from worker import PeakTracker, choose_splat_backend, opensplat_train_cmd, OPENSPLAT_MEMORY_MIB, LIBTORCH_LIB
import os


def main():
    proj = VAULT / "odm" / f"proj_{SCENE}"
    if not (proj / "opensfm" / "reconstruction.json").exists():
        raise SystemExit("canario sin escena — proj de baseline ausente")
    out = VAULT / "eval" / "canary" / "model.ply"
    out.parent.mkdir(parents=True, exist_ok=True)
    backend = choose_splat_backend(1000)
    cmd = opensplat_train_cmd(proj, out, 1000, backend, [])
    peak = PeakTracker()
    t0 = time.time()
    env = {"PATH": "/usr/bin:/bin:/opt/homebrew/bin", "HOME": os.environ.get("HOME", "/tmp"),
           "DYLD_LIBRARY_PATH": str(LIBTORCH_LIB)}
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.STDOUT, start_new_session=True)
    while proc.poll() is None:
        peak(proc.pid)
        time.sleep(5)
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "rc": proc.returncode,
           "duration_s": round(time.time() - t0, 1), "peak_mib": peak.peak_mib,
           "peak_source": peak.peak_source, "cap_mib": OPENSPLAT_MEMORY_MIB,
           "backend": backend["device"]}
    hist = [json.loads(l) for l in TREND.read_text().splitlines()] if TREND.exists() else []
    ok = [h for h in hist if h.get("rc") == 0]
    # deuda de nacimiento (review 11-jul): los umbrales (+20%/2×) son A PRIORI, de la
    # intuición del P0 — las primeras 4 corridas CALIBRAN, no alertan. Al mes, los
    # umbrales se re-derivan de la serie real y el canario pasa de configurado a calibrado.
    if len(ok) >= 4:
        med_peak = sorted(h["peak_mib"] for h in ok)[len(ok) // 2]
        med_dur = sorted(h["duration_s"] for h in ok)[len(ok) // 2]
        alerts = []
        if rec["rc"] == 0 and med_peak and rec["peak_mib"] >= med_peak * 1.2:
            alerts.append(f"peak +{round((rec['peak_mib']/med_peak-1)*100)}% vs mediana")
        if rec["rc"] == 0 and med_dur and rec["duration_s"] >= med_dur * 2:
            alerts.append(f"duración {round(rec['duration_s']/med_dur,1)}× (¿swap?)")
        if rec["rc"] != 0:
            alerts.append(f"rc={rec['rc']} — el canario MURIÓ")
        if alerts:
            rec["alerts"] = alerts
            sys.path.insert(0, str(PIPE))
            import perf
            perf.log_error("canary-splat", "; ".join(alerts), ctx=rec)
    TREND.parent.mkdir(parents=True, exist_ok=True)
    with open(TREND, "a") as f:
        f.write(json.dumps(rec) + "\n")
    out.unlink(missing_ok=True)
    print(json.dumps(rec))


if __name__ == "__main__":
    main()
