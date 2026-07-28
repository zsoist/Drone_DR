#!/usr/bin/env python3
"""Sube ?v=N en TODO web/ (html + js + vendor con imports versionados) y
regenera los .gz. Regla nacida de un incidente real: editar módulos sin subir
la versión deja al edge/navegador mezclando módulos viejos y nuevos
(terrain.splatMask undefined en Safari, 2026-07-12).

Uso:  python3 bump_web_version.py [N]   (sin N: max encontrado + 1)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
PAT = re.compile(r"\?v=(\d+)")


def main():
    files = [p for p in WEB.rglob("*") if p.suffix in (".html", ".js")
             and ".gz" not in p.name and "node_modules" not in str(p)]
    # el barrido de gz stale cubre TAMBIÉN css (aprendido: style.css.gz llevaba
    # 12h viejo porque el sweep solo miraba html/js — los fixes no llegaban)
    gz_sweep = [
        p for p in WEB.rglob("*")
        if p.is_file()
        and p.suffix in (".css", ".html", ".js", ".json", ".svg")
        and ".gz" not in p.name
        and "node_modules" not in p.parts
    ]
    current = max((int(m) for p in files for m in PAT.findall(p.read_text(errors="ignore"))), default=0)
    new = int(sys.argv[1]) if len(sys.argv) > 1 else current + 1
    touched = []
    for p in files:
        s = p.read_text(errors="ignore")
        s2 = PAT.sub(f"?v={new}", s)
        if s2 != s:
            p.write_text(s2)
            touched.append(p)
    regz = set(touched)
    # gz stale = fuente más nueva que su .gz (aunque el archivo no tenga ?v=):
    # este agujero sirvió un tresd.js de ayer tras la migración de fase E
    for p in gz_sweep:
        gz = p.with_name(p.name + ".gz")
        if not gz.exists() or gz.stat().st_mtime < p.stat().st_mtime:
            regz.add(p)
    for p in regz:
        subprocess.run(["gzip", "-kf9", str(p)], check=True)
        source_stat = p.stat()
        os.utime(
            p.with_name(p.name + ".gz"),
            ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns),
        )
    print(f"v{current} -> v{new} en {len(touched)} archivos · {len(regz)} gz regenerados")


if __name__ == "__main__":
    main()
