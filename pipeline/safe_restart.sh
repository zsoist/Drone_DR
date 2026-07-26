#!/bin/bash
# Reinicia servicios de AeroBrain sin matar trabajos pesados.
# uso: safe_restart.sh [web|server|worker|tunnel|both]
T="${1:-web}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# sidecars gzip frescos antes de servir; no se puede reiniciar sobre assets viejos.
"$(dirname "$0")/gzip_assets.sh" >/dev/null 2>&1 || {
  echo "ABORTADO: no se pudieron preparar los sidecars gzip" >&2
  exit 1
}
[[ "$T" == "server" ]] && T="web"
if [[ "$T" == "worker" || "$T" == "both" ]]; then
  BUSY=$(python3 - <<'PY'
import sqlite3, sys
db = "/Volumes/SSD/drone-vault/manifest/jobs.db"
try:
    con = sqlite3.connect(db, timeout=5)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "select id, kind, label, progress from jobs "
        "where status='running' and kind in ('splat','3d') "
        "order by started desc").fetchall()
except Exception as e:
    print("1")
    print(f" - no se pudo leer {db}: {e}", file=sys.stderr)
    sys.exit(0)
print(len(rows))
for j in rows:
    pct = round(float(j["progress"] or 0) * 100)
    print(f" - {j['kind']} {j['label']} {j['id']} {pct}%", file=sys.stderr)
PY
)
  if [[ "${BUSY%%$'\n'*}" != "0" ]]; then
    echo "ABORTADO: hay trabajos pesados corriendo (splat/3d). Espera o cancélalos primero." >&2
    exit 1
  fi
  launchctl kickstart -k gui/501/com.aerobrain.worker && echo "worker reiniciado"
fi
preflight_world() {
  python3 "$ROOT/pipeline/audit_world.py" >/tmp/aerobrain-world-audit-deploy.json || {
    echo "ABORTADO: audit_world rojo antes del reinicio" >&2
    tail -20 /tmp/aerobrain-world-audit-deploy.json >&2
    return 1
  }
  python3 "$ROOT/pipeline/world_runtime_sweep.py" \
    >/tmp/aerobrain-world-runtime-deploy.json || {
    echo "ABORTADO: sweep runtime multi-mapa rojo antes del reinicio" >&2
    tail -40 /tmp/aerobrain-world-runtime-deploy.json >&2
    return 1
  }
  echo "world runtime sweep preflight: todos los mapas activos verdes"
  ACTIVE_WORLD=$(python3 - <<'PY'
import json
from pathlib import Path
vault = Path("/Volumes/SSD/drone-vault")
system = json.loads((vault / "manifest/system.json").read_text())
for scene in system.get("scenes") or []:
    cid = scene.get("active_version")
    path = vault / "models" / str(cid or "") / "scene.v2.json"
    if not path.exists():
        continue
    manifest = json.loads(path.read_text())
    caps = manifest.get("capabilities") or {}
    if caps.get("terrain") and caps.get("collision"):
        print(cid)
        break
PY
)
  if [[ -z "$ACTIVE_WORLD" ]]; then
    echo "ABORTADO: no hay mundo activo collision-ready" >&2
    return 1
  fi
  python3 "$ROOT/pipeline/flightverse_collision_gate.py" "$ACTIVE_WORLD" --stress 100 \
    >/tmp/aerobrain-world-stress-deploy.json || {
    echo "ABORTADO: gate FLIGHTVERSE 100x rojo ($ACTIVE_WORLD) antes del reinicio" >&2
    tail -30 /tmp/aerobrain-world-stress-deploy.json >&2
    return 1
  }
  echo "world gate preflight: $ACTIVE_WORLD · 100/100 verde"
}

wait_for_web_health() {
  for _ in {1..20}; do
    curl -fsS http://127.0.0.1:8790/api/healthz >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  echo "FALLO DE PRODUCCIÓN: web no pasó health tras reinicio" >&2
  return 1
}

if [[ "$T" == "web" || "$T" == "both" ]]; then
  if [[ -z "$AEROBRAIN_SKIP_WORLD_GATE" ]]; then
    preflight_world || exit 1
  else
    echo "⚠️ world gate SALTADO por AEROBRAIN_SKIP_WORLD_GATE=1" >&2
  fi
  launchctl kickstart -k gui/501/com.aerobrain.web || {
    echo "FALLO DE PRODUCCIÓN: no se pudo reiniciar web" >&2
    exit 1
  }
  echo "web reiniciado"
  wait_for_web_health || exit 1
  if [[ -z "$AEROBRAIN_SKIP_WORLD_GATE" ]]; then
    echo "world deployment preflight conservó los mapas activos verdes"
  fi
fi
if [[ "$T" == "tunnel" ]]; then
  launchctl kickstart -k gui/501/com.metislab.tunnel && echo "tunnel reiniciado"
fi
