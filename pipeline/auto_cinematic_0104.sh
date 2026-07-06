#!/bin/bash
# Orquestador one-shot: cuando el 3D alta de 0104 termine y el Metal Toolchain esté
# instalado, compila OpenSplat MPS, recarga el worker (código nuevo de run_splat) y
# encola el splat CINEMÁTICO de 0104. Corre detached (nohup) — sobrevive a la sesión.
# Log: /Volumes/SSD/drone-vault/qa/auto_cinematic_0104.log
set -u
ROOT="/Volumes/SSD/work/forge-projects/aerobrain"
DB="/Volumes/SSD/drone-vault/manifest/jobs.db"
LOG="/Volumes/SSD/drone-vault/qa/auto_cinematic_0104.log"
CID="DJI_20260704160358_0104_D"
DEADLINE=$(( $(date +%s) + 12*3600 ))   # 12h máximo de espera total

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
busy() { sqlite3 "$DB" "select count(*) from jobs where status in ('queued','running') and kind in ('3d','splat');" 2>/dev/null || echo 1; }
metal_ok() { xcodebuild -showComponent MetalToolchain 2>/dev/null | grep -qi "Status: installed"; }

log "=== auto-cinematic 0104: esperando (3D alta corriendo + Metal descargando) ==="

# 1) espera a que no haya heavy jobs (el 3D alta de 0104 debe terminar)
while [ "$(busy)" != "0" ]; do
  [ "$(date +%s)" -gt "$DEADLINE" ] && { log "DEADLINE esperando jobs — abortado"; exit 1; }
  sleep 120
done
log "cola heavy libre (3D alta terminó)"

# 2) espera al Metal Toolchain (la descarga sigue su curso); si no llega, seguimos en CPU
ITERS=7000; DEVICE="CPU (7k probado)"
WAIT_METAL=$(( $(date +%s) + 2*3600 ))
while ! metal_ok; do
  if [ "$(date +%s)" -gt "$WAIT_METAL" ]; then log "Metal no llegó en 2h post-3D — seguimos en CPU 7k"; break; fi
  sleep 120
done

# 3) si Metal está, compila MPS (el guard interno re-verifica que no haya jobs)
if metal_ok; then
  log "Metal instalado — compilando OpenSplat MPS"
  if "$ROOT/pipeline/build_opensplat_mps.sh" >> "$LOG" 2>&1; then
    ITERS=15000; DEVICE="Metal/MPS 15k (loss plateau 15k-30k)"
    log "build MPS OK"
  else
    log "build MPS FALLÓ — fallback CPU 7k (revisar log arriba)"
  fi
fi

# 4) recarga el worker para que corra el run_splat nuevo (prefiere reconstrucción alta)
"$ROOT/pipeline/safe_restart.sh" worker >> "$LOG" 2>&1
sleep 3

# 5) encola el splat cinemático
python3 - <<PY >> "$LOG" 2>&1
import sys; sys.path.insert(0, "$ROOT/pipeline")
import jobs as jobstore
if jobstore.pending("splat", "$CID"):
    print("ya hay splat pendiente para $CID")
else:
    # label = cid pelado: pending() dedupea por label exacto (la UI usa el cid)
    j = jobstore.enqueue("splat", "$CID",
                         {"clip_id": "$CID", "iters": $ITERS})
    print("splat cinemático encolado:", j["id"], "· $DEVICE")
PY
log "=== hecho: splat cinemático de 0104 en cola ($DEVICE) ==="
