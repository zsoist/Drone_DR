#!/bin/bash
# Reinicia servicios de AeroBrain sin matar trabajos pesados.
# uso: safe_restart.sh [web|server|worker|tunnel|both]
T="${1:-web}"
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
fi
if [[ "$T" == "tunnel" ]]; then
  launchctl kickstart -k gui/501/com.metislab.tunnel && echo "tunnel reiniciado"
fi
