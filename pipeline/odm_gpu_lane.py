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
  - cleanup()          mata contenedor remoto huerfano + borra el workdir exitoso

El caller aplica preflight de memoria y mantiene Alta/Extra/Ultra estrictamente
remoto. Un fallo conserva el workdir como evidencia; solo una corrida completa
se limpia automaticamente.
"""
from __future__ import annotations

import subprocess
import tarfile
import tempfile
import re
from pathlib import Path

from gpu_lane import SSH_HOST, NTFS_TRANSFER, ensure_awake, _run, _wsl

REMOTE_ODM = "/root/gpu-jobs/odm"
WSL_TRANSFER = "/mnt/c/Users/reyes/gpu-transfer"
LOCAL_TRANSFER_TMP = Path("/Volumes/SSD/drone-vault/ops/transfer")
# dirs que el publish del Mac consume — images/ NO viaja de vuelta (ya vive alla)
OUTPUT_DIRS = ("opensfm", "odm_report", "odm_georeferencing", "odm_filterpoints",
               "odm_meshing", "odm_texturing", "odm_texturing_25d", "odm_dem",
               "odm_orthophoto", "cameras.json", "images.json", "log.json",
               "benchmark.txt")


def validate_remote_name(name: str) -> str:
    """Confine every retained/resumed dataset to one direct ODM workdir."""
    value = str(name or "")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
        raise ValueError(f"nombre ODM remoto inválido: {name!r}")
    return value


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
    """argv para run_tracked: ssh -> wsl -> bash -c 'docker run ...'.

    El docker corre DENTRO de un bash de WSL, jamas via argv de wsl.exe: el hop
    por cmd.exe de Windows es la unica diferencia entre el run de produccion que
    segfaulteo (139 en detect_features a los 2s) y el repro identico que paso —
    la ruta probada es esta. Sin -t: el tty no hace falta (run_tracked lee el
    stdout por hilo) y ssh solo emitia el warning de pseudo-terminal."""
    cmd = ["docker", "run", "--rm", "--name", container, "--gpus", "all",
           "-m", "20g", "-v", f"{REMOTE_ODM}/{name}:/datasets/code",
           "opendronemap/odm:gpu", "--project-path", "/datasets",
           "--max-concurrency", "8", "--dsm", "--dtm", "--skip-report",
           *preset_args]
    if stable_dense and "--pc-skip-geometric" not in cmd:
        cmd.append("--pc-skip-geometric")
    if rerun_from:
        cmd += ["--rerun-from", rerun_from]
    inner = " ".join(cmd)                        # args controlados: sin espacios internos
    return ["ssh", SSH_HOST, "wsl", "-d", "Ubuntu", "--", "bash", "-lc",
            f'"{inner} 2>&1"']


def feature_artifact_count(name: str) -> int:
    """Count completed OpenSfM feature files independently of buffered stdout."""
    name = validate_remote_name(name)
    out = _wsl(
        f"find {REMOTE_ODM}/{name}/opensfm/features -type f "
        "-name '*.features.npz' 2>/dev/null | wc -l",
        timeout=30, label="contar features ODM")
    return max(0, int((out or "0").strip() or 0))


def match_artifact_count(name: str) -> int:
    """Count per-image OpenSfM match files during the serialization tail."""
    name = validate_remote_name(name)
    out = _wsl(
        f"find {REMOTE_ODM}/{name}/opensfm/matches -type f "
        "-name '*_matches.pkl.gz' 2>/dev/null | wc -l",
        timeout=30, label="contar coincidencias ODM")
    return max(0, int((out or "0").strip() or 0))


def mesh_artifact_count(name: str) -> int:
    """Count durable dem2mesh fragments instead of duplicate progress lines."""
    name = validate_remote_name(name)
    out = _wsl(
        f"find {REMOTE_ODM}/{name}/odm_meshing -maxdepth 1 -type f "
        "-name 'odm_25dmesh.dirty.ply.*.bin' 2>/dev/null | wc -l",
        timeout=30, label="contar fragmentos de malla ODM")
    return max(0, int((out or "0").strip() or 0))


def resume_artifacts(name: str) -> dict[str, int]:
    """Measure the immutable inputs required to resume at OpenSfM."""
    name = validate_remote_name(name)
    base = f"{REMOTE_ODM}/{name}"
    out = _wsl(f"""
echo images=$(find {base}/images -maxdepth 1 -type f 2>/dev/null | wc -l)
echo features=$(find {base}/opensfm/features -type f -name '*.features.npz' 2>/dev/null | wc -l)
echo matches=$(find {base}/opensfm/matches -type f -name '*_matches.pkl.gz' 2>/dev/null | wc -l)
echo tracks_bytes=$(stat -c%s {base}/opensfm/tracks.csv 2>/dev/null || echo 0)
""", timeout=60, label="auditar evidencia ODM reanudable")
    evidence = {"images": 0, "features": 0, "matches": 0, "tracks_bytes": 0}
    for line in (out or "").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key in evidence:
            evidence[key] = max(0, int(value or 0))
    return evidence


def filtered_cloud_artifacts(name: str) -> dict[str, int | str]:
    """Measure the completed OpenMVS filter output before a downstream resume.

    OpenMVS can write both final files and then segfault while destructing its
    large visibility graph.  A recovery may skip that expensive phase only
    when the binary PLY has a non-empty vertex declaration and the MVS archive
    carries its native magic header.
    """
    name = validate_remote_name(name)
    base = f"{REMOTE_ODM}/{name}/opensfm/undistorted/openmvs"
    out = _wsl(f"""
ply={base}/scene_dense_dense_filtered.ply
mvs={base}/scene_dense_dense_filtered.mvs
echo filtered_ply_bytes=$(stat -c%s "$ply" 2>/dev/null || echo 0)
echo filtered_mvs_bytes=$(stat -c%s "$mvs" 2>/dev/null || echo 0)
echo filtered_points=$(awk '/^element vertex [0-9]+$/ {{print $3; exit}}' "$ply" 2>/dev/null || true)
echo mvs_magic=$(LC_ALL=C head -c4 "$mvs" 2>/dev/null || true)
""", timeout=60, label="auditar nube OpenMVS filtrada")
    evidence: dict[str, int | str] = {
        "filtered_ply_bytes": 0,
        "filtered_mvs_bytes": 0,
        "filtered_points": 0,
        "mvs_magic": "",
    }
    for line in (out or "").splitlines():
        key, sep, value = line.strip().partition("=")
        if not sep or key not in evidence:
            continue
        if key == "mvs_magic":
            evidence[key] = value
        else:
            evidence[key] = max(0, int(value or 0))
    return evidence


def prepare_opensfm_resume(name: str) -> None:
    """Archive only the failed reconstruction so OpenSfM can rebuild it.

    Do not use ODM ``--rerun-from opensfm`` here: ODM implements that switch by
    deleting the entire OpenSfM directory, including the verified feature,
    match and track caches this recovery exists to preserve.
    """
    name = validate_remote_name(name)
    base = f"{REMOTE_ODM}/{name}/opensfm"
    out = _wsl(f"""
set -eu
test -s {base}/tracks.csv
test -d {base}/features
test -d {base}/matches
mkdir -p {base}/recovery_evidence
if [ -e {base}/reconstruction.json ]; then
  stamp=$(date +%s%N)
  mv {base}/reconstruction.json {base}/recovery_evidence/reconstruction.pre-resume-$stamp.json
fi
test ! -e {base}/reconstruction.json
echo RESUME_READY
""", timeout=60, label="preparar reanudación OpenSfM")
    if "RESUME_READY" not in out:
        raise RuntimeError("el nodo CUDA no confirmó la preparación OpenSfM")


def fetch_outputs(proj: Path, name: str) -> list[str]:
    """Trae los outputs ODM al proj del Mac y devuelve la lista recuperada."""
    tar_remote = f"{WSL_TRANSFER}/odm-{name}-out.tar"
    # tar SIN gzip: los outputs ODM ya vienen comprimidos (JPG/TIF/PLY) — gzip solo
    # quemaba CPU (medido: 20GB a ~13MB/s ≈ 25 min, rozando el timeout); plano es I/O puro
    _wsl(f"""
cd {REMOTE_ODM}/{name}
tar cf {tar_remote} $(for d in {' '.join(OUTPUT_DIRS)}; do [ -e "$d" ] && echo "$d"; done)
echo TAR_OK $(stat -c%s {tar_remote})
""", timeout=3600, label="empacar outputs")
    # ODM ultra can exceed the Mac system volume's free space (34+ GiB measured).
    # Stage the remote tar on the vault SSD, beside its final destination.
    LOCAL_TRANSFER_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="odm-cuda-", dir=LOCAL_TRANSFER_TMP) as td:
        local_tar = Path(td) / "out.tar"
        _run(["scp", "-q", f"{SSH_HOST}:{NTFS_TRANSFER}/odm-{name}-out.tar",
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
rm -rf {REMOTE_ODM}/{name} {WSL_TRANSFER}/odm-{name} {WSL_TRANSFER}/odm-{name}-out.t*
echo CLEAN_OK
""", timeout=120, label="cleanup")
    except (RuntimeError, subprocess.TimeoutExpired, OSError):
        pass                                     # limpiar jamas decide el estado del job
