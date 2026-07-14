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
import base64
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

SSH_HOST = "pc"                      # ~/.ssh/config: 192.168.1.5, user reyes, key pc_gpu
PC_WAKE = Path.home() / ".local/scripts/pc-wake"
REMOTE_JOBS = "/root/gpu-jobs"
REMOTE_DATA = f"{REMOTE_JOBS}/data"
REMOTE_RUNS = f"{REMOTE_JOBS}/runs"
REMOTE_CHECKPOINTS = f"{REMOTE_JOBS}/checkpoints"
NERFSTUDIO_FULL_IMAGE_MANAGER = (
    f"{REMOTE_JOBS}/splat-env/lib/python3.10/site-packages/nerfstudio/"
    "data/datamanagers/full_images_datamanager.py"
)
NERFSTUDIO_SPLATFACTO_MODEL = (
    f"{REMOTE_JOBS}/splat-env/lib/python3.10/site-packages/nerfstudio/"
    "models/splatfacto.py"
)
NTFS_TRANSFER = "C:/Users/reyes/gpu-transfer"    # puente binario-seguro WSL->Mac
WSL_TRANSFER = "/mnt/c/Users/reyes/gpu-transfer"

REMOTE_PRELUDE = (
    "export HOME=/root; export PATH=\"$HOME/.local/bin:$PATH\"; "
    "set -eo pipefail; cd ~/gpu-jobs && source splat-env/bin/activate"
)

_SAFE_NAME = re.compile(r"[A-Za-z0-9._-]+")


class CudaLaneError(RuntimeError):
    def __init__(self, kind: str, message: str, *, rc: int | None = None,
                 checkpoint: dict | None = None):
        super().__init__(message)
        self.kind = kind
        self.rc = rc
        self.checkpoint = checkpoint


def classify_cuda_failure(returncode: int | None, output: str) -> str:
    """Classify a failed remote stage without inventing a fallback."""
    text = str(output or "").lower()
    if ("outofmemory" in text or "out of memory" in text
            or "cuda_error_out_of_memory" in text):
        return "oom"
    if returncode in (-15, 130, 143) or "cancelled by user" in text or "canceled by user" in text:
        return "cancelled"
    if (returncode == 255 or "connection timed out" in text or "connect to host" in text
            or "connection reset" in text or "broken pipe" in text):
        return "connectivity"
    if "no space left on device" in text or "disk quota exceeded" in text:
        return "disk"
    if "ns-export" in text or "splat.ply" in text or "export failed" in text:
        return "export"
    return "trainer"


def should_retry_cuda(failure: str, resolution: str, downscale: int) -> bool:
    return failure == "oom" and resolution == "auto" and int(downscale) == 1


def _safe_name(name: str) -> str:
    name = str(name)
    if not _SAFE_NAME.fullmatch(name):
        raise ValueError(f"nombre remoto inválido: {name}")
    return name


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
import json, shutil, subprocess, torch, gsplat
from gsplat.cuda._backend import _C
gpu = torch.cuda.get_device_properties(0) if torch.cuda.is_available() else None
driver = subprocess.run(["nvidia-smi", "--query-gpu=driver_version,memory.free,temperature.gpu",
                         "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout.strip().split(',')
wsl = shutil.disk_usage('/root/gpu-jobs')
bridge = shutil.disk_usage('/mnt/c/Users/reyes/gpu-transfer')
print(json.dumps({"torch": torch.__version__, "cuda_runtime": torch.version.cuda,
                  "cuda": torch.cuda.is_available(), "gsplat": gsplat.__version__,
                  "kernels": _C is not None, "gpu": gpu.name if gpu else None,
                  "vram_total_mb": round(gpu.total_memory / 1048576) if gpu else None,
                  "driver": driver[0].strip() if driver else None,
                  "vram_free_mb": int(float(driver[1])) if len(driver) > 1 else None,
                  "temp_c": int(float(driver[2])) if len(driver) > 2 else None,
                  "wsl_free_bytes": wsl.free, "bridge_free_bytes": bridge.free,
                  "environment_verified": bool(torch.cuda.is_available() and _C is not None)}))
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
    name = _safe_name(name)
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
test -d {REMOTE_DATA}/{name}/images && test -d {REMOTE_DATA}/{name}/sparse/0
rm -rf /mnt/c/Users/reyes/gpu-transfer/in-{name}
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


def image_cache_policy(project: Path, downscale: int, vram_total_mb: int | float) -> dict:
    """Choose where Nerfstudio keeps decoded source images.

    Splatfacto defaults to ``cache_images: gpu``. On the 8 GB lane a 422-frame
    full-resolution scene consumed roughly 6 GB merely holding uint8 images,
    leaving almost no room for Gaussian growth. Keeping a large cache on CPU
    preserves the requested input resolution; small datasets retain the faster
    GPU-cache path. This changes storage only, never pixels or optimizer steps.
    """
    from PIL import Image

    d = int(downscale)
    if d not in (1, 2):
        raise ValueError("downscale CUDA inválido para cache")
    total_bytes = 0
    count = 0
    image_dir = Path(project) / "images"
    for path in sorted(image_dir.iterdir()) if image_dir.is_dir() else ():
        if not path.is_file():
            continue
        try:
            with Image.open(path) as image:
                width, height = image.size
            total_bytes += max(1, width // d) * max(1, height // d) * 3
            count += 1
        except (OSError, ValueError):
            continue
    decoded_mib = total_bytes / 1048576
    # Reserve most of VRAM for rasterization, gradients and Adam state. The
    # floor keeps tiny smoke fixtures meaningful; the 1 GiB ceiling prevents a
    # large GPU from turning image storage into an unbounded hidden consumer.
    budget_mib = max(64.0, min(1024.0, float(vram_total_mb or 0) * 0.10))
    return {
        "device": "cpu" if decoded_mib > budget_mib else "gpu",
        "decoded_mib": round(decoded_mib, 1),
        "gpu_cache_budget_mib": round(budget_mib, 1),
        "images": count,
        "downscale": d,
    }


def with_image_cache_policy(train_args: list[str] | tuple[str, ...] | None,
                            policy: dict) -> list[str]:
    """Return trainer args with one explicit, auditable cache destination."""
    args = list(train_args or ())
    flag = "--pipeline.datamanager.cache-images"
    while flag in args:
        index = args.index(flag)
        del args[index:index + 2]
    device = str((policy or {}).get("device") or "gpu").lower()
    if device not in ("cpu", "gpu"):
        raise ValueError(f"cache Nerfstudio inválido: {device}")
    return [*args, flag, device]


def pageable_cpu_cache_guard(source_path: str | Path = NERFSTUDIO_FULL_IMAGE_MANAGER) -> str:
    """Return an idempotent remote guard for Nerfstudio's CPU image cache.

    Nerfstudio page-locks every cached CPU image through CUDA. A dense resumed
    checkpoint can already occupy nearly all VRAM before that lazy cache is
    materialized, making ``pin_memory`` fail even though the PC has ample RAM.
    Pageable tensors still transfer correctly through ``Tensor.to(device)``;
    they only trade asynchronous-copy speed for reliable full-resolution runs.
    """
    source = shlex.quote(str(source_path))
    return f"""python - {source} <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
marker = "AeroBrain: keep full-resolution CPU cache pageable"
replacements = (
    ('cache["image"] = cache["image"].pin_memory()',
     'cache["image"] = cache["image"].contiguous()  # ' + marker),
    ('cache["mask"] = cache["mask"].pin_memory()',
     'cache["mask"] = cache["mask"].contiguous()  # ' + marker),
)
changed = False
for old, new in replacements:
    if old in text:
        text = text.replace(old, new)
        changed = True
    elif new not in text:
        raise SystemExit(f"unsupported Nerfstudio CPU cache source: missing {{old}}")
if changed:
    path.write_text(text)
print(marker)
PY
"""


def stable_splat_resume_guard(source_path: str | Path = NERFSTUDIO_SPLATFACTO_MODEL) -> str:
    """Keep optimizer parameter references valid when a checkpoint resizes GSs.

    Nerfstudio's Splatfacto loader replaced each ``Parameter`` object while the
    optimizers still referenced the pre-checkpoint object. Normal iterations
    appeared to resume, but gsplat's first growth callback indexed the smaller
    stale parameter and triggered a device-side assertion. Resizing ``.data``
    preserves object identity so checkpoint optimizer state and model tensors
    remain attached to the same parameter.
    """
    source = shlex.quote(str(source_path))
    return f"""python - {source} <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
marker = "AeroBrain: preserve optimizer parameter identity"
old = "self.gauss_params[name] = torch.nn.Parameter(torch.zeros(new_shape, device=self.device))"
new = "param.data = torch.zeros(new_shape, device=self.device)  # " + marker
if old in text:
    text = text.replace(old, new)
    path.write_text(text)
elif new not in text:
    raise SystemExit("unsupported Nerfstudio Splatfacto checkpoint loader")
print(marker)
PY
"""


def validate_resume_checkpoint(path: str | None) -> str | None:
    """Confine trainer resume input to immutable checkpoint evidence on the PC."""
    if path is None:
        return None
    value = str(path)
    pattern = rf"{re.escape(REMOTE_CHECKPOINTS)}/[A-Za-z0-9._-]+/step-\d{{9}}\.ckpt"
    if not re.fullmatch(pattern, value):
        raise ValueError(f"checkpoint CUDA fuera del vault permitido: {value}")
    return value


def archive_latest_checkpoint(name: str, job_id: str) -> dict | None:
    """Copy the latest trainer checkpoint outside the disposable run directory."""
    name = _safe_name(name)
    job_id = _safe_name(job_id)
    out = _wsl(REMOTE_PRELUDE + f"""
SRC=$(find {REMOTE_RUNS}/{name} -type f -name 'step-*.ckpt' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
if [ -z "$SRC" ]; then echo NO_CHECKPOINT; exit 0; fi
BASE=$(basename "$SRC")
case "$BASE" in step-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].ckpt) ;; *) exit 3 ;; esac
DST={REMOTE_CHECKPOINTS}/{job_id}/$BASE
mkdir -p {REMOTE_CHECKPOINTS}/{job_id}
cp --reflink=auto "$SRC" "$DST"
SHA=$(sha256sum "$DST" | cut -d' ' -f1)
BYTES=$(stat -c%s "$DST")
STEP=${{BASE#step-}}; STEP=${{STEP%.ckpt}}; STEP=$((10#$STEP))
echo "CHECKPOINT step=$STEP bytes=$BYTES sha256=$SHA path=$DST"
""", timeout=300, label="preservar checkpoint CUDA")
    rows = [line for line in out.splitlines() if line.startswith("CHECKPOINT ")]
    if not rows:
        return None
    fields = dict(token.split("=", 1) for token in rows[-1].split()[1:])
    path = validate_resume_checkpoint(fields["path"])
    return {"step": int(fields["step"]), "bytes": int(fields["bytes"]),
            "sha256": fields["sha256"], "path": path}


def train_script_path(name: str) -> str:
    name = _safe_name(name)
    return f"{REMOTE_RUNS}/.scripts/train-{name}.sh"


def train_script(name: str, iters: int, downscale: int, run_id: str,
                 train_args: list[str] | tuple[str, ...] | None = None,
                 resume_checkpoint: str | None = None) -> str:
    """Script Bash ejecutado *dentro* de WSL para una corrida CUDA.

    No se incrusta en el argv de OpenSSH: Windows OpenSSH recompone el comando
    remoto con otra capa de shell y expandía ``$!``, ``$(date)`` y
    ``PIPESTATUS`` antes de que Bash recibiera el script. El resultado era un
    monitor huérfano y un falso ``ns-train: command not found``. El archivo
    remoto mantiene una frontera de quoting real y además queda auditable.
    """
    name = _safe_name(name)
    run_id = _safe_name(run_id)
    if int(iters) < 1 or int(downscale) not in (1, 2):
        raise ValueError("iters/downscale CUDA inválidos")
    extra = " ".join(shlex.quote(str(value)) for value in (train_args or ()))
    checkpoint = validate_resume_checkpoint(resume_checkpoint)
    resume = f"--load-checkpoint {shlex.quote(checkpoint)}" if checkpoint else ""
    telemetry = f"{REMOTE_RUNS}/telemetry-{name}.csv"
    return f"""#!/usr/bin/env bash
set -e
cd /root/gpu-jobs
source splat-env/bin/activate
test -x "$VIRTUAL_ENV/bin/ns-train"
{pageable_cpu_cache_guard()}
{stable_splat_resume_guard()}
rm -rf {REMOTE_RUNS}/{name}
rm -f {telemetry}
(
  while true; do
    printf '%s,' "$(date +%s)" >> {telemetry}
    nvidia-smi --query-gpu=memory.used,utilization.gpu,temperature.gpu \
      --format=csv,noheader,nounits >> {telemetry}
    sleep 2
  done
) &
MON=$!
cleanup_monitor() {{
  kill "$MON" 2>/dev/null || true
  wait "$MON" 2>/dev/null || true
}}
trap cleanup_monitor EXIT
set +e
yes | "$VIRTUAL_ENV/bin/ns-train" splatfacto \
  --data {REMOTE_DATA}/{name} --output-dir {REMOTE_RUNS} \
  --experiment-name {name} --timestamp {run_id} \
  --viewer.quit-on-train-completion True --max-num-iterations {iters} \
  {resume} \
  {extra} \
  colmap --colmap-path sparse/0 --images-path images \
  --downscale-factor {downscale} 2>&1
RC=${{PIPESTATUS[1]}}
set -e
exit "$RC"
"""


def install_train_script(name: str, iters: int, downscale: int, run_id: str,
                         train_args: list[str] | tuple[str, ...] | None = None,
                         resume_checkpoint: str | None = None) -> str:
    """Instala el script por stdin (sin shell intermedia de Windows)."""
    name = _safe_name(name)
    path = train_script_path(name)
    encoded = base64.b64encode(
        train_script(name, iters, downscale, run_id, train_args,
                     resume_checkpoint=resume_checkpoint).encode()
    ).decode()
    _wsl(
        f"mkdir -p {REMOTE_RUNS}/.scripts\n"
        f"printf %s {shlex.quote(encoded)} | base64 -d > {path}\n"
        f"chmod 700 {path}\n",
        timeout=60, label="instalar script CUDA",
    )
    return path


def train_argv(name: str, iters: int, downscale: int, run_id: str,
               train_args: list[str] | tuple[str, ...] | None = None) -> list[str]:
    """argv estable para run_tracked; todo el estado Bash vive en el script."""
    name = _safe_name(name)
    _safe_name(run_id)
    if int(iters) < 1 or int(downscale) not in (1, 2):
        raise ValueError("iters/downscale CUDA inválidos")
    return ["ssh", SSH_HOST, "wsl", "-d", "Ubuntu", "--", "bash",
            train_script_path(name)]


def cleanup_script(name: str, *, success: bool, active_names: set[str] | None = None,
                   now: int | None = None) -> str:
    """Return an exact-path cleanup script; never glob datasets/runs."""
    name = _safe_name(name)
    if name in (active_names or set()):
        raise ValueError(f"job remoto activo: {name}")
    bridge_in = f"{WSL_TRANSFER}/in-{name}"
    bridge_out = f"{WSL_TRANSFER}/out-{name}"
    if success:
        return (f"rm -rf {REMOTE_DATA}/{name} {REMOTE_RUNS}/{name} {bridge_in} "
                f"{bridge_out}.ply {bridge_out}.yml {bridge_out}.csv; "
                f"rm -f {REMOTE_RUNS}/telemetry-{name}.csv {train_script_path(name)}")
    retain_until = int(now if now is not None else time.time()) + 24 * 3600
    return (f"rm -rf {bridge_in}; rm -f {bridge_out}.ply {bridge_out}.yml {bridge_out}.csv; "
            f"for d in {REMOTE_DATA}/{name} {REMOTE_RUNS}/{name}; do "
            f"if [ -d \"$d\" ]; then echo {retain_until} > \"$d/retain-until\"; fi; done")


def cleanup(name: str, *, success: bool, active_names: set[str] | None = None) -> None:
    _wsl(REMOTE_PRELUDE + "; " + cleanup_script(
        name, success=success, active_names=active_names), timeout=120,
        label="cleanup remoto")


def finalize_train(name: str, run_id: str) -> dict:
    """Post-entrenamiento: export a PLY 3DGS + staging NTFS. Devuelve bytes."""
    name = _safe_name(name)
    run_id = _safe_name(run_id)
    out = _wsl(REMOTE_PRELUDE + f"""
CFG={REMOTE_RUNS}/{name}/splatfacto/{run_id}/config.yml
ns-export gaussian-splat --load-config "$CFG" --output-dir {REMOTE_RUNS}/{name}/export >/dev/null 2>&1
mkdir -p {WSL_TRANSFER}
cp {REMOTE_RUNS}/{name}/export/splat.ply {WSL_TRANSFER}/out-{name}.ply
cp "$CFG" {WSL_TRANSFER}/out-{name}.yml
if [ -f {REMOTE_RUNS}/telemetry-{name}.csv ]; then
  cp {REMOTE_RUNS}/telemetry-{name}.csv {WSL_TRANSFER}/out-{name}.csv
  PEAK=$(awk -F, '{{gsub(/ /,"",$2); if ($2+0>m) m=$2+0}} END {{print m+0}}' {REMOTE_RUNS}/telemetry-{name}.csv)
  SAMPLES=$(wc -l < {REMOTE_RUNS}/telemetry-{name}.csv)
else
  PEAK=0; SAMPLES=0
fi
echo "BYTES=$(stat -c%s {REMOTE_RUNS}/{name}/export/splat.ply) PEAK_MIB=$PEAK SAMPLES=$SAMPLES"
""", timeout=1200, label="export ply")
    last = [ln for ln in out.splitlines() if ln.startswith("BYTES=")][-1]
    parts = dict(token.split("=", 1) for token in last.split())
    return {"run_id": run_id, "ply_bytes": int(parts["BYTES"]),
            "remote_peak_vram_mib": int(float(parts["PEAK_MIB"])),
            "telemetry_samples": int(parts["SAMPLES"])}


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
    name = _safe_name(name)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{name}.ply"
    _run(["scp", "-q", f"{SSH_HOST}:{NTFS_TRANSFER}/out-{name}.ply", str(dest)],
         900, "scp artefacto")
    head = dest.read_bytes()[:400]
    if not head.startswith(b"ply"):
        raise RuntimeError("el artefacto no es un PLY valido (transferencia corrupta)")
    for suffix in ("yml", "csv"):
        subprocess.run(["scp", "-q", f"{SSH_HOST}:{NTFS_TRANSFER}/out-{name}.{suffix}",
                        str(out_dir / f"{name}.{suffix}")], capture_output=True, timeout=120)
    _wsl(REMOTE_PRELUDE + f"; rm -f {WSL_TRANSFER}/out-{name}.ply "
         f"{WSL_TRANSFER}/out-{name}.yml {WSL_TRANSFER}/out-{name}.csv",
         timeout=120, label="cleanup bridge salida")
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
