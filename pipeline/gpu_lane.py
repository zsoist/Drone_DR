#!/usr/bin/env python3
"""Lane CUDA remoto (F3): entrena un gaussian splat en el PC (RTX 4060 Ti) via SSH.

Flujo completo, cada paso verificado:
  1. despierta el PC (WoL) si hace falta y espera SSH
  2. rsync del dataset COLMAP al camino caliente del PC (SSD, ~/gpu-jobs/data)
  3. splatfacto (nerfstudio + gsplat CUDA) en sesion SSH SOSTENIDA — la VM de WSL
     en Win10 se auto-termina ~15s despues de cerrar la ultima sesion, aunque haya
     units systemd corriendo; fire-and-forget = job muerto
  4. ns-export gaussian-splat -> .ply 3DGS
  5. el artefacto viaja WSL -> /mnt/c (NTFS) -> scp al Mac (wsl.exe no es
     binario-seguro por stdout; scp del OpenSSH de Windows si lo es)

Honesto por diseno: cualquier fallo -> exit != 0 con el error real en stderr.
El caller (worker lane gpu, o splat_eval F4) decide el fallback a Metal/MPS.

Gotchas encapsulados aqui (sangrados en la comision de jul-13):
  - `yes | ns-train` + pipefail = SIGPIPE 141 al terminar ns-train -> el rc real
    se lee de PIPESTATUS[1] con pipefail suspendido en esa linea
  - el venv es uv (sin pip de fabrica); env definitivo: py3.10 + torch 2.4.1+cu124
    + gsplat 1.4.0+pt24cu124 (wheel binario, pin exacto o PyPI lo pisa)
  - dataset SIEMPRE se entrena desde el SSD (C:); D: es HDD = solo almacen frio

Uso:
  python3 gpu_lane.py <dataset_dir> <out_dir> [--iters 4000] [--name smoke]
  python3 gpu_lane.py --probe          # solo verifica nodo + env, exit 0/1
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

SSH_HOST = "pc"                      # ~/.ssh/config: 192.168.1.5, user reyes, key pc_gpu
PC_WAKE = Path.home() / ".local/scripts/pc-wake"
REMOTE_JOBS = "/root/gpu-jobs"
REMOTE_DATA = f"{REMOTE_JOBS}/data"
REMOTE_RUNS = f"{REMOTE_JOBS}/runs"
NTFS_TRANSFER = "C:/Users/reyes/gpu-transfer"    # puente binario-seguro WSL->Mac
WSL_TRANSFER = "/mnt/c/Users/reyes/gpu-transfer"

REMOTE_PRELUDE = (
    "export HOME=/root; export PATH=\"$HOME/.local/bin:$PATH\"; "
    "set -eo pipefail; cd ~/gpu-jobs && source splat-env/bin/activate"
)


def _run(cmd: list[str], timeout: int, label: str) -> subprocess.CompletedProcess:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"{label} fallo (rc={p.returncode}): "
                           f"{(p.stderr or p.stdout)[-800:]}")
    return p


def _wsl(script: str, timeout: int, label: str) -> str:
    """Ejecuta un script bash dentro de WSL en UNA sesion ssh sostenida."""
    p = subprocess.run(["ssh", SSH_HOST, "wsl", "-d", "Ubuntu", "--", "bash", "-s"],
                       input=script, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"{label} fallo (rc={p.returncode}):\n"
                           f"stderr: {p.stderr[-700:]}\nstdout: {p.stdout[-700:]}")
    return p.stdout


def node_awake(timeout_s: int = 6) -> bool:
    return subprocess.run(["ssh", "-o", f"ConnectTimeout={timeout_s}", SSH_HOST, "exit"],
                          capture_output=True, timeout=timeout_s + 8).returncode == 0


def ensure_awake(max_wait_s: int = 90) -> None:
    if node_awake():
        return
    if PC_WAKE.exists():
        subprocess.run([str(PC_WAKE)], capture_output=True, timeout=15)
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        if node_awake():
            return
        time.sleep(5)
    raise RuntimeError(f"el PC no desperto en {max_wait_s}s (¿BIOS WoL habilitado?)")


def probe() -> dict:
    """Verifica nodo + env CUDA real (importa _C, no imprime versiones)."""
    ensure_awake()
    out = _wsl(REMOTE_PRELUDE + """
python - <<'PY'
import json, torch, gsplat
from gsplat.cuda._backend import _C
print(json.dumps({"torch": torch.__version__, "cuda": torch.cuda.is_available(),
                  "gsplat": gsplat.__version__, "kernels": _C is not None}))
PY
""", timeout=120, label="probe env")
    info = json.loads(out.strip().splitlines()[-1])
    if not (info["cuda"] and info["kernels"]):
        raise RuntimeError(f"env CUDA degradado: {info}")
    return info


def ship_dataset(dataset: Path, name: str) -> None:
    """Envia el dataset al SSD del PC. scp -r y no rsync: Windows no trae rsync
    y rsync-sobre-ssh lo exige en AMBOS extremos. El staging es NTFS y un cp
    dentro de WSL lo lleva a ext4 (el entrenamiento jamas lee de /mnt/* — el
    I/O 9p es un ancla)."""
    staging = f"{NTFS_TRANSFER}/in-{name}"
    win_transfer = NTFS_TRANSFER.replace("/", "\\")
    win_staging = staging.replace("/", "\\")
    _run(["ssh", SSH_HOST, "cmd", "/c",
          f"(if not exist {win_transfer} mkdir {win_transfer}) & "
          f"(if exist {win_staging} rmdir /s /q {win_staging})"], 60, "staging limpio")
    _run(["scp", "-q", "-r", str(dataset), f"{SSH_HOST}:{staging}"],
         1800, "scp dataset")
    _wsl(REMOTE_PRELUDE + f"""
rm -rf {REMOTE_DATA}/{name}
mkdir -p {REMOTE_DATA}
cp -r /mnt/c/Users/reyes/gpu-transfer/in-{name} {REMOTE_DATA}/{name}
echo DATASET_OK
""", timeout=900, label="staging a ext4")


def prep_dataset(name: str, downscale: int) -> None:
    """Prepara el dataset en el PC para nerfstudio:
    - FULL_OPENCV -> OPENCV en cameras.txt (nerfstudio no soporta FULL_OPENCV;
      se descartan k3..k6 — para el smoke es ruido, para F4 riguroso hay que
      undistort antes o exportar OPENCV desde el origen)
    - pre-genera images_N con PIL: ns-train pregunta interactivo si falta y
      un EOF en sesion no-tty mata el run"""
    _wsl(REMOTE_PRELUDE + f"""
cd {REMOTE_DATA}/{name}
if grep -q FULL_OPENCV sparse/0/cameras.txt; then
  python - <<'PY'
lines = open('sparse/0/cameras.txt').read().splitlines()
out = []
for ln in lines:
    parts = ln.split()
    if len(parts) > 4 and parts[1] == 'FULL_OPENCV':
        parts[1] = 'OPENCV'
        parts = parts[:12]              # OPENCV: fx fy cx cy k1 k2 p1 p2
        ln = ' '.join(parts)
    out.append(ln)
open('sparse/0/cameras.txt', 'w').write('\\n'.join(out) + '\\n')
print('cameras.txt: FULL_OPENCV -> OPENCV (k3.. descartados)')
PY
fi
if [ "{downscale}" -gt 1 ] && [ ! -d images_{downscale} ]; then
  python - <<'PY'
from PIL import Image
import os
os.makedirs('images_{downscale}', exist_ok=True)
for f in sorted(os.listdir('images')):
    im = Image.open(f'images/{{f}}')
    im.resize((im.width // {downscale}, im.height // {downscale}), Image.LANCZOS).save(f'images_{downscale}/{{f}}')
print('images_{downscale}: generadas')
PY
fi
echo PREP_OK
""", timeout=600, label="prep dataset")


def train(name: str, iters: int, downscale: int, timeout_s: int) -> dict:
    """splatfacto + export .ply, todo en una sesion sostenida. Devuelve metricas."""
    run_id = f"gpu-{int(time.time())}"
    script = REMOTE_PRELUDE + f"""
rm -rf {REMOTE_RUNS}/{name}
T0=$(date +%s)
set +o pipefail
yes | ns-train splatfacto \\
  --data {REMOTE_DATA}/{name} \\
  --output-dir {REMOTE_RUNS} --experiment-name {name} --timestamp {run_id} \\
  --viewer.quit-on-train-completion True \\
  --max-num-iterations {iters} \\
  colmap --colmap-path sparse/0 --images-path images --downscale-factor {downscale} \\
  2>&1 | tail -3
rc=${{PIPESTATUS[1]}}
set -o pipefail
[ "$rc" = 0 ] || {{ echo "ns-train rc=$rc" >&2; exit "$rc"; }}
T1=$(date +%s)
CFG={REMOTE_RUNS}/{name}/splatfacto/{run_id}/config.yml
ns-export gaussian-splat --load-config "$CFG" --output-dir {REMOTE_RUNS}/{name}/export >/dev/null 2>&1
T2=$(date +%s)
mkdir -p {WSL_TRANSFER}
cp {REMOTE_RUNS}/{name}/export/splat.ply {WSL_TRANSFER}/out-{name}.ply
echo "TRAIN_S=$((T1-T0)) EXPORT_S=$((T2-T1)) BYTES=$(stat -c%s {REMOTE_RUNS}/{name}/export/splat.ply)"
"""
    out = _wsl(script, timeout=timeout_s, label="entrenamiento CUDA")
    last = [ln for ln in out.splitlines() if ln.startswith("TRAIN_S=")][-1]
    parts = dict(kv.split("=") for kv in last.split())
    return {"run_id": run_id, "train_s": int(parts["TRAIN_S"]),
            "export_s": int(parts["EXPORT_S"]), "ply_bytes": int(parts["BYTES"])}


def fetch(name: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{name}.ply"
    _run(["scp", "-q", f"{SSH_HOST}:{NTFS_TRANSFER}/out-{name}.ply", str(dest)],
         900, "scp artefacto")
    head = dest.read_bytes()[:400]
    if not head.startswith(b"ply"):
        raise RuntimeError("el artefacto no es un PLY valido (transferencia corrupta)")
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("dataset", nargs="?", help="dir COLMAP local (images/ + sparse/0)")
    ap.add_argument("out", nargs="?", help="dir local para el artefacto")
    ap.add_argument("--iters", type=int, default=4000)
    ap.add_argument("--downscale", type=int, default=2)
    ap.add_argument("--name", default="lane")
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--probe", action="store_true", help="solo verificar nodo + env")
    a = ap.parse_args()

    t0 = time.time()
    info = probe()
    print(f"nodo OK: torch {info['torch']} · gsplat {info['gsplat']} · kernels reales", flush=True)
    if a.probe:
        return 0
    if not (a.dataset and a.out):
        ap.error("dataset y out son obligatorios sin --probe")
    dataset = Path(a.dataset).resolve()
    if not (dataset / "sparse" / "0").is_dir():
        raise SystemExit(f"dataset sin sparse/0: {dataset}")

    print("enviando dataset…", flush=True)
    ship_dataset(dataset, a.name)
    prep_dataset(a.name, a.downscale)
    print(f"entrenando {a.iters} iters en CUDA…", flush=True)
    m = train(a.name, a.iters, a.downscale, a.timeout)
    dest = fetch(a.name, Path(a.out).resolve())
    m.update({"backend": "NVIDIA CUDA", "iters": a.iters, "downscale": a.downscale,
              "artifact": str(dest), "total_s": round(time.time() - t0, 1)})
    (dest.with_suffix(".json")).write_text(json.dumps(m, indent=1))
    print(json.dumps(m, indent=1), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.TimeoutExpired) as e:
        print(f"gpu_lane: {e}", file=sys.stderr)
        sys.exit(1)
