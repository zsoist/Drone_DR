#!/usr/bin/env python3
"""Lane ODM sobre nodo CUDA (F5): la fotogrametria completa corre en el PC
(RTX 4060 Ti) dentro del contenedor oficial opendronemap/odm:gpu.

Que acelera la GPU con honestidad: la extraccion de features (SIFT) y los
depthmaps — las fases mas caras de un preset alto. SfM/meshing/texturing siguen
siendo CPU (8 cores del cap .wslconfig vs 10 del M4): la ganancia neta viene de
los depthmaps y de LIBERAR el Mac, no de magia.

Division del trabajo con worker.py:
  - ship_images()      imagenes del proyecto -> SSD del PC (staging NTFS -> ext4)
  - remote_run_argv()  argv ssh para jobstore.run_tracked — el ssh ES el proceso
                       trackeado, asi el log/progreso/timeout/cancel existentes
                       aplican sin codigo nuevo; matar el ssh tumba la VM WSL
                       (muere ~15s tras la ultima sesion) y con ella el contenedor
  - fetch_outputs()    odm_*/opensfm de vuelta al proj del Mac (tar -> NTFS -> scp)
  - cleanup()          mata contenedor remoto huerfano + borra el workdir

El caller (build_3d_assets) decide el fallback local si cualquier paso falla.
"""
from __future__ import annotations

import subprocess
import tarfile
import tempfile
from pathlib import Path

from gpu_lane import SSH_HOST, NTFS_TRANSFER, ensure_awake, _run, _wsl

REMOTE_ODM = "/root/gpu-jobs/odm"
WSL_TRANSFER = "/mnt/c/Users/reyes/gpu-transfer"
# dirs que el publish del Mac consume — images/ NO viaja de vuelta (ya vive alla)
OUTPUT_DIRS = ("opensfm", "odm_report", "odm_georeferencing", "odm_filterpoints",
               "odm_meshing", "odm_texturing", "odm_texturing_25d", "odm_dem",
               "odm_orthophoto", "cameras.json", "images.json", "log.json",
               "benchmark.txt")


def probe() -> None:
    """Nodo despierto + imagen odm:gpu presente + GPU visible para docker."""
    ensure_awake()
    out = _wsl("""
docker images opendronemap/odm:gpu --format ok | head -1
docker info --format '{{range .Runtimes}}{{println .}}{{end}}' 2>/dev/null | grep -c nvidia || true
""", timeout=60, label="probe odm gpu")
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    if not lines or lines[0] != "ok":
        raise RuntimeError("imagen opendronemap/odm:gpu no esta en el PC (docker pull pendiente)")


def ship_images(proj: Path, name: str) -> int:
    """Imagenes al camino caliente del PC. Devuelve el numero enviado."""
    images = proj / "images"
    n = len(list(images.iterdir()))
    if not n:
        raise RuntimeError(f"proyecto sin imagenes: {images}")
    staging = f"{NTFS_TRANSFER}/odm-{name}"
    win = staging.replace("/", "\\")
    _run(["ssh", SSH_HOST, "cmd", "/c",
          f"(if exist {win} rmdir /s /q {win}) & mkdir {win}"], 60, "staging limpio")
    _run(["scp", "-q", "-r", str(images), f"{SSH_HOST}:{staging}/images"],
         3600, "scp imagenes")
    _wsl(f"""
rm -rf {REMOTE_ODM}/{name}
mkdir -p {REMOTE_ODM}/{name}
cp -r {WSL_TRANSFER}/odm-{name}/images {REMOTE_ODM}/{name}/images
echo IMAGES_OK $(ls {REMOTE_ODM}/{name}/images | wc -l)
""", timeout=900, label="staging a ext4")
    return n


def remote_run_argv(name: str, container: str, preset_args: list[str],
                    rerun_from: str | None = None, stable_dense: bool = False) -> list[str]:
    """argv para run_tracked: ssh -> wsl -> docker run --gpus all odm:gpu.

    -t fuerza tty: sin el, algunos hops ssh->wsl bufferean el stdout de docker
    y el progreso del job se congela aunque ODM avance."""
    cmd = ["docker", "run", "--rm", "--name", container, "--gpus", "all",
           "-m", "20g", "-v", f"{REMOTE_ODM}/{name}:/datasets/code",
           "opendronemap/odm:gpu", "--project-path", "/datasets",
           "--max-concurrency", "8", "--dsm", "--dtm", "--skip-report",
           *preset_args]
    if stable_dense and "--pc-skip-geometric" not in cmd:
        cmd.append("--pc-skip-geometric")
    if rerun_from:
        cmd += ["--rerun-from", rerun_from]
    return ["ssh", "-t", SSH_HOST, "wsl", "-d", "Ubuntu", "--", *cmd]


def fetch_outputs(proj: Path, name: str) -> list[str]:
    """Trae los outputs ODM al proj del Mac y devuelve la lista recuperada."""
    tar_remote = f"{WSL_TRANSFER}/odm-{name}-out.tgz"
    _wsl(f"""
cd {REMOTE_ODM}/{name}
tar czf {tar_remote} $(for d in {' '.join(OUTPUT_DIRS)}; do [ -e "$d" ] && echo "$d"; done)
echo TAR_OK $(stat -c%s {tar_remote})
""", timeout=1800, label="empacar outputs")
    with tempfile.TemporaryDirectory(prefix="odm-cuda-") as td:
        local_tar = Path(td) / "out.tgz"
        _run(["scp", "-q", f"{SSH_HOST}:{NTFS_TRANSFER}/odm-{name}-out.tgz",
              str(local_tar)], 3600, "scp outputs")
        with tarfile.open(local_tar) as tf:
            tf.extractall(proj, filter="data")
            got = sorted({m.name.split("/")[0] for m in tf.getmembers()})
    if "opensfm" not in got or "odm_orthophoto" not in got:
        raise RuntimeError(f"outputs incompletos del nodo CUDA: {got}")
    return got


def cleanup(name: str, container: str) -> None:
    """Best-effort: contenedor huerfano fuera + workdir y staging borrados."""
    try:
        _wsl(f"""
docker rm -f {container} >/dev/null 2>&1 || true
rm -rf {REMOTE_ODM}/{name} {WSL_TRANSFER}/odm-{name} {WSL_TRANSFER}/odm-{name}-out.tgz
echo CLEAN_OK
""", timeout=120, label="cleanup")
    except (RuntimeError, subprocess.TimeoutExpired, OSError):
        pass                                     # limpiar jamas decide el estado del job
