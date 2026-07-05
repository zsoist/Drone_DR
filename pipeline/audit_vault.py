"""Auditoría de integridad del vault: manifest vs archivos reales vs jobs DB.

Detecta (y con --fix repara):
  - dirs de modelo sin meta.json (huérfanos de un delete/publish fallido)
  - temporales publicados por error (.DS_Store, .*.tif, *.aux.xml)
  - jobs 'done' cuyo artifact ya no existe (modelo borrado) → limpia el link
  - splats sospechosamente chicos (<200 KB = escena insuficiente)
  - modelos en system.json cuyo dir desapareció → rebuild del índice

Usage: python3 audit_vault.py [--fix]
"""
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
PIPE = Path(__file__).resolve().parent
FIX = "--fix" in sys.argv


def main() -> int:
    problems = []
    fixed = []

    # 1) dirs de modelo sin meta.json
    models_dir = VAULT / "models"
    for d in sorted(models_dir.iterdir()) if models_dir.exists() else []:
        if not d.is_dir():
            continue
        if not (d / "meta.json").exists():
            problems.append(f"modelo huérfano sin meta.json: models/{d.name}")
            if FIX:
                shutil.rmtree(d)
                fixed.append(f"eliminado models/{d.name}")

    # 2) temporales publicados
    junk = []
    if models_dir.exists():
        junk = [*models_dir.rglob(".DS_Store"),
                *[p for p in models_dir.rglob(".*.tif")],
                *models_dir.rglob("*.aux.xml")]
    for p in junk:
        problems.append(f"temporal publicado: {p.relative_to(VAULT)}")
        if FIX:
            p.unlink(missing_ok=True)
            fixed.append(f"eliminado {p.relative_to(VAULT)}")

    # 3) jobs done con artifact muerto
    db = VAULT / "manifest" / "jobs.db"
    if db.exists():
        with sqlite3.connect(db) as c:
            c.row_factory = sqlite3.Row
            rows = c.execute("SELECT id, artifact FROM jobs "
                             "WHERE status='done' AND artifact != ''").fetchall()
            for r in rows:
                if not (VAULT / r["artifact"]).exists():
                    problems.append(f"job {r['id']}: artifact muerto → {r['artifact']}")
                    if FIX:
                        c.execute("UPDATE jobs SET artifact='', "
                                  "detail=detail || ' · artifact eliminado' WHERE id=?",
                                  (r["id"],))
                        fixed.append(f"job {r['id']}: link limpiado")

    # 4) splats diminutos
    splats = VAULT / "splats"
    for sp in sorted(splats.glob("*.splat")) if splats.exists() else []:
        if sp.stat().st_size < 200_000:
            problems.append(f"splat sospechosamente chico ({sp.stat().st_size} B): splats/{sp.name}")

    # 5) system.json desincronizado del filesystem
    sysf = VAULT / "manifest" / "system.json"
    if sysf.exists():
        listed = {m["clip_id"] for m in json.loads(sysf.read_text()).get("models", [])}
        real = {d.name for d in models_dir.iterdir()
                if d.is_dir() and (d / "meta.json").exists()} if models_dir.exists() else set()
        if listed != real:
            problems.append(f"índice desincronizado: manifest={sorted(listed)} vs disco={sorted(real)}")
            if FIX:
                subprocess.run(["python3", str(PIPE / "build_index.py")], check=True)
                fixed.append("índice regenerado")

    print(f"{'=' * 52}\nAUDIT VAULT — {len(problems)} hallazgo(s)")
    for p in problems:
        print(f"  ✗ {p}")
    if FIX:
        print(f"--fix aplicó {len(fixed)} reparación(es):")
        for f in fixed:
            print(f"  ✓ {f}")
    elif problems:
        print("corre con --fix para reparar")
    if not problems:
        print("  ✓ vault íntegro")
    return 1 if (problems and not FIX) else 0


if __name__ == "__main__":
    sys.exit(main())
