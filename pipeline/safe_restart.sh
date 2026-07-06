#!/bin/bash
# Reinicia servicios de AeroBrain sin matar trabajos pesados.
# uso: safe_restart.sh [web|worker|both]
T="${1:-web}"
if [[ "$T" == "worker" || "$T" == "both" ]]; then
  BUSY=$(curl -s http://localhost:8790/api/jobs | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except: d={}
heavy=[j for j in d.get('jobs',[]) if j.get('status')=='running' and j.get('kind') in ('splat','3d')]
print(len(heavy))
for j in heavy: print(' -', j['id'], f\"{round(j.get('progress',0)*100)}%\", file=sys.stderr)
")
  if [[ "${BUSY%%$'\n'*}" != "0" ]]; then
    echo "ABORTADO: hay trabajos pesados corriendo (splat/3d). Espera o cancélalos primero." >&2
    exit 1
  fi
  launchctl kickstart -k gui/501/com.aerobrain.worker && echo "worker reiniciado"
fi
if [[ "$T" == "web" || "$T" == "both" ]]; then
  launchctl kickstart -k gui/501/com.aerobrain.web && echo "web reiniciado"
fi
