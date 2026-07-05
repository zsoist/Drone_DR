"""AeroBrain worker — ejecuta los jobs pesados (ODM 3D, OpenSplat) FUERA del server.

Arquitectura: el server web sólo ENCOLA (status=queued) en el SQLite de jobs;
este proceso los reclama atómicamente y los ejecuta. Reiniciar el server web ya
no mata una fotogrametría de 40 minutos — cada proceso marca huérfanos sólo de
los kinds que le pertenecen (server=light, worker=heavy).

Corre como launchd: com.aerobrain.worker (KeepAlive).
Cancel sigue funcionando: /api/job_cancel marca el status y mata pid/container;
run_tracked (compartido) detecta el cambio y corta la secuencia.
"""
import json
import os
import subprocess
import time
from pathlib import Path

import jobs as jobstore

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

VAULT = Path("/Volumes/SSD/drone-vault")
PIPE = Path(__file__).resolve().parent
SPLAT_BIN = PIPE.parent / "splat" / "OpenSplat" / "build" / "opensplat"
DOCKER = "/usr/local/bin/docker"
POLL_S = 3


def rebuild_index():
    subprocess.run(["python3", str(PIPE / "build_index.py")], check=True)


def _cancelled(jid: str) -> bool:
    return (jobstore.get(jid) or {}).get("status") in jobstore.CANCEL_STATES


# presets de calidad ODM: mismo pipeline completo (dense+mesh+DSM), distinto trade-off
PRESETS = {
    "rapido":   {"eta": "~25-40 min", "timeout": 2 * 3600,
                 "args": ["--pc-quality", "low", "--feature-quality", "medium",
                          "--orthophoto-resolution", "8", "--dem-resolution", "15"]},
    "estandar": {"eta": "~45-75 min", "timeout": 3 * 3600,
                 "args": ["--pc-quality", "medium", "--feature-quality", "medium",
                          "--orthophoto-resolution", "5", "--dem-resolution", "10"]},
    "alta":     {"eta": "~2-4 h", "timeout": 6 * 3600,
                 "args": ["--pc-quality", "high", "--feature-quality", "high",
                          "--orthophoto-resolution", "3", "--dem-resolution", "5"]},
}


def run_3d(j: dict):
    cid = j["spec"]["clip_id"]
    preset = PRESETS.get(j["spec"].get("preset", "estandar"), PRESETS["estandar"])
    proj = VAULT / "odm" / f"proj_{cid}"
    container = f"odm-{j['id']}"
    jobstore.update(j["id"], container=container)

    jobstore.update(j["id"], detail="1/3 frames + geotag", stage="frames", progress=0.05)
    if jobstore.run_tracked(j["id"], ["python3", str(PIPE / "odm_prep.py"), cid],
                            timeout=1800) != 0:
        raise RuntimeError("odm_prep falló")

    jobstore.update(j["id"], detail=f"2/3 fotogrametría ODM ({preset['eta']})",
                    stage="odm", progress=0.15)
    if jobstore.run_tracked(j["id"],
            [DOCKER, "run", "--rm", "--name", container,
             "-m", "7g", "-v", f"{proj}:/datasets/code", "opendronemap/odm",
             "--project-path", "/datasets", "--max-concurrency", "4",
             "--dsm", "--dtm", "--skip-report", *preset["args"]],
            timeout=preset["timeout"]) != 0:
        raise RuntimeError("ODM falló")

    jobstore.update(j["id"], detail="3/3 publicando assets web", stage="publish", progress=0.9)
    if jobstore.run_tracked(j["id"],
            ["python3", str(PIPE / "tresd_publish.py"), cid, str(proj)],
            timeout=1800) != 0:
        raise RuntimeError("publicación falló")

    rebuild_index()
    jobstore.update(j["id"], progress=1.0)
    jobstore.end(j["id"], "done", f"modelo 3D de {cid} listo — míralo en el tab 3D",
                 artifact=f"models/{cid}/meta.json")


def run_splat(j: dict):
    # import tardío: reutiliza el quality gate del server sin duplicarlo
    from aerobrain_server import splat_quality
    cid = j["spec"]["clip_id"]
    proj = VAULT / "odm" / ("proj0104" if cid.endswith("0104_D") else f"proj_{cid}")
    il = proj / "opensfm" / "image_list.txt"
    il.write_text(il.read_text().replace("/datasets/code", str(proj)))
    n_cams = len([ln for ln in il.read_text().splitlines() if ln.strip()])
    (VAULT / "splats").mkdir(exist_ok=True)
    out = VAULT / "splats" / f"{cid}.splat"
    ITERS = int(j["spec"].get("iters", 2000))
    jobstore.update(j["id"], detail=f"entrenando {ITERS} iters sobre {n_cams} cámaras (CPU)",
                    stage="train", progress=0.1)
    rc = jobstore.run_tracked(j["id"],
        [str(SPLAT_BIN), str(proj), "--cpu", "-n", str(ITERS), "-o", str(out)],
        timeout=4 * 3600,
        env={**os.environ, "DYLD_LIBRARY_PATH": str(SPLAT_BIN.parent.parent.parent.parent / "libtorch" / "lib")})
    if rc != 0:
        raise RuntimeError(f"opensplat salió con código {rc}")
    quality = splat_quality(out, (jobstore.get(j["id"]) or {}).get("log", ""), n_cams, ITERS)
    (VAULT / "splats" / f"{cid}.meta.json").write_text(json.dumps(quality, indent=1))
    if not quality["passed"]:
        raise RuntimeError(quality["reason"])
    rebuild_index()
    jobstore.update(j["id"], progress=1.0)
    jobstore.end(j["id"], "done",
                 f"{out.name} · loss {quality['final_loss']} · {n_cams} cámaras",
                 artifact=f"splats/{out.name}")


RUNNERS = {"3d": run_3d, "splat": run_splat}


def main():
    # al arrancar, SOLO los heavy jobs (de este dueño) que quedaron running son huérfanos
    jobstore.init(orphan_kinds=jobstore.HEAVY_KINDS)
    print(f"worker listo · poll {POLL_S}s · kinds {jobstore.HEAVY_KINDS}", flush=True)
    while True:
        j = jobstore.claim(jobstore.HEAVY_KINDS)
        if not j:
            time.sleep(POLL_S)
            continue
        print(f"→ {j['id']} ({j['kind']}) {j['label']}", flush=True)
        try:
            RUNNERS[j["kind"]](j)
            print(f"✓ {j['id']} done", flush=True)
        except Exception as e:
            if not _cancelled(j["id"]):
                jobstore.end(j["id"], "error", str(e)[-250:])
            print(f"✗ {j['id']}: {e}", flush=True)


if __name__ == "__main__":
    main()
