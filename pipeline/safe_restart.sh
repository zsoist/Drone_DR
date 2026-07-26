#!/bin/bash
# Reinicia servicios de AeroBrain sin matar trabajos pesados.
# uso: safe_restart.sh [web|server|worker|tunnel|both]
T="${1:-web}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# sidecars gzip frescos antes de servir (barato; solo re-comprime lo cambiado)
"$(dirname "$0")/gzip_assets.sh" >/dev/null 2>&1 || true
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
if [[ "$T" == "web" || "$T" == "both" ]]; then
  launchctl kickstart -k gui/501/com.aerobrain.web && echo "web reiniciado"
  if [[ -z "$AEROBRAIN_SKIP_WORLD_GATE" ]]; then
    for _ in {1..20}; do
      curl -fsS http://127.0.0.1:8790/api/health >/dev/null 2>&1 && break
      sleep 0.25
    done
    python3 "$ROOT/pipeline/audit_world.py" >/tmp/aerobrain-world-audit-deploy.json || {
      echo "ABORTADO: audit_world rojo tras reinicio" >&2
      tail -20 /tmp/aerobrain-world-audit-deploy.json >&2
      exit 1
    }
    python3 "$ROOT/pipeline/world_runtime_sweep.py" \
      >/tmp/aerobrain-world-runtime-deploy.json || {
      echo "ABORTADO: sweep runtime multi-mapa rojo tras reinicio" >&2
      tail -40 /tmp/aerobrain-world-runtime-deploy.json >&2
      exit 1
    }
    echo "world runtime sweep: todos los mapas activos verdes"
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
      exit 1
    fi
    python3 "$ROOT/pipeline/flightverse_collision_gate.py" "$ACTIVE_WORLD" --stress 100 \
      >/tmp/aerobrain-world-stress-deploy.json || {
      echo "ABORTADO: gate FLIGHTVERSE 100x rojo ($ACTIVE_WORLD)" >&2
      tail -30 /tmp/aerobrain-world-stress-deploy.json >&2
      exit 1
    }
    echo "world gate: $ACTIVE_WORLD · 100/100 verde"
  else
    echo "⚠️ world gate SALTADO por AEROBRAIN_SKIP_WORLD_GATE=1" >&2
  fi
fi
if [[ "$T" == "tunnel" ]]; then
  launchctl kickstart -k gui/501/com.metislab.tunnel && echo "tunnel reiniciado"
fi
