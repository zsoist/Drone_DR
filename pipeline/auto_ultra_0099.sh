#!/bin/bash
# Test end-to-end del pipeline ULTRA para Casa 4 Julio iso low (0099):
# espera a que la cola pesada drene (los splats en curso) → reinicia el worker para
# cargar los PRESETS extra/ultra nuevos → encola ODM 'ultra' (con fallback ultra→extra→alta
# incorporado en el worker) → al terminar, encola un cinemático fresco sobre la reconstrucción
# ultra. Detached; log en qa/auto_ultra_0099.log.
set -u
ROOT="/Volumes/SSD/work/forge-projects/aerobrain"
DB="/Volumes/SSD/drone-vault/manifest/jobs.db"
LOG="/Volumes/SSD/drone-vault/qa/auto_ultra_0099.log"
CID="DJI_20260705171127_0099_D"
DEADLINE=$(( $(date +%s) + 20*3600 ))

log(){ echo "[$(date '+%m-%d %H:%M:%S')] $*" >> "$LOG"; }
heavy(){ sqlite3 "$DB" "select count(*) from jobs where status in ('queued','running') and kind in ('3d','splat');" 2>/dev/null || echo 1; }
jstatus(){ sqlite3 "$DB" "select status from jobs where id='$1';" 2>/dev/null; }

log "=== auto-ultra 0099: esperando a que la cola pesada drene ==="
while [ "$(heavy)" != "0" ]; do
  [ "$(date +%s)" -gt "$DEADLINE" ] && { log "DEADLINE esperando cola — abortado"; exit 1; }
  sleep 120
done
log "cola pesada libre → reiniciando worker (carga PRESETS extra/ultra)"
"$ROOT/pipeline/safe_restart.sh" worker >> "$LOG" 2>&1
sleep 4

# 1) ODM ultra (el worker degrada solo a extra→alta si la VM no da la memoria)
JID=$(python3 - <<PY
import sys; sys.path.insert(0, "$ROOT/pipeline")
import jobs as jobstore
j = jobstore.enqueue("3d", "$CID", {"clip_id": "$CID", "preset": "ultra",
                                    "title": "Casa 4 Julio — ULTRA"})
print(j["id"])
PY
)
log "ODM ultra encolado: $JID"
# espera al 3D (ultra puede tardar 8-14h; el timeout del preset lo corta)
while :; do
  s=$(jstatus "$JID"); [ -z "$s" ] && s="?"
  case "$s" in done) log "ODM ultra DONE"; break;;
    error|cancelled|cancel_failed) log "ODM ultra terminó en $s — no encolo splat"; exit 1;; esac
  [ "$(date +%s)" -gt "$DEADLINE" ] && { log "DEADLINE en ODM — abortado"; exit 1; }
  sleep 180
done

# 2) cinemático sobre la reconstrucción ultra
SID=$(python3 - <<PY
import sys; sys.path.insert(0, "$ROOT/pipeline")
import jobs as jobstore
j = jobstore.enqueue("splat", "$CID", {"clip_id": "$CID", "iters": 7000})
print(j["id"])
PY
)
log "=== cinemático sobre ultra encolado: $SID — pipeline ultra completo en marcha ==="
