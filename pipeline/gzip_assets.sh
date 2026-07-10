#!/bin/bash
# Genera sidecars .gz para los assets de texto de web/ (el server los sirve con
# Content-Encoding: gzip si existen y son más nuevos que el fuente).
# style.css 171KB→36KB · tresd.js 96KB→~20KB · ovi-drone.svg 1.16MB→293KB — todo móvil, cada visita fría.
cd "$(dirname "$0")/../web" || exit 1
find . -type f \( -name '*.css' -o -name '*.js' -o -name '*.svg' -o -name '*.json' -o -name '*.html' \) \
    ! -path './node_modules/*' ! -name '*.gz' | while read -r f; do
  gz="$f.gz"
  if [ ! -f "$gz" ] || [ "$f" -nt "$gz" ]; then
    gzip -9 -k -f "$f"
  fi
done
echo "gz sidecars: $(find . -name '*.gz' | wc -l | tr -d ' ') archivos"
