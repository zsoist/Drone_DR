#!/bin/bash
# Genera sidecars .gz para los assets de texto de web/ (el server los sirve con
# Content-Encoding: gzip si existen y son más nuevos que el fuente).
# style.css 171KB→36KB · tresd.js 96KB→~20KB · ovi-drone.svg 1.16MB→293KB — todo móvil, cada visita fría.
cd "$(dirname "$0")/../web" || exit 1
FAIL=0
# process substitution (no pipe): el loop corre en el shell actual y FAIL sobrevive;
# -print0/read -d '' tolera espacios y saltos de línea en nombres.
while IFS= read -r -d '' f; do
  gz="$f.gz"
  if [ ! -f "$gz" ] || [ "$f" -nt "$gz" ] || ! gzip -cd "$gz" 2>/dev/null | cmp -s - "$f"; then
    if ! gzip -9 -k -f "$f"; then
      echo "gzip_assets: FALLÓ gzip de $f" >&2
      FAIL=1
    fi
  fi
done < <(find . -type f \( -name '*.css' -o -name '*.js' -o -name '*.svg' -o -name '*.json' -o -name '*.html' \) \
    ! -path './node_modules/*' ! -name '*.gz' -print0)
python3 - <<'PY' || { echo "gzip_assets: FALLÓ el paso de mtimes" >&2; FAIL=1; }
import os
from pathlib import Path

for sidecar in Path(".").rglob("*.gz"):
    source = sidecar.with_name(sidecar.name.removesuffix(".gz"))
    if not source.is_file():
        continue
    source_stat = source.stat()
    os.utime(
        sidecar,
        ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns),
    )
PY
echo "gz sidecars: $(find . -name '*.gz' | wc -l | tr -d ' ') archivos"
if [ "$FAIL" -ne 0 ]; then
  echo "gzip_assets: hubo fallos — sidecars posiblemente viejos" >&2
  exit 1
fi
