"""Auditoría de integridad del vault: manifest vs archivos reales vs jobs DB.

Detecta (y con --fix repara):
  - dirs de modelo sin meta.json (huérfanos de un delete/publish fallido)
  - temporales publicados por error (.DS_Store, .*.tif, *.aux.xml)
  - jobs 'done' cuyo artifact ya no existe (modelo borrado) → limpia el link
  - splats sospechosamente chicos (<200 KB = escena insuficiente)
  - modelos en system.json cuyo dir desapareció → rebuild del índice

--fix nunca borra un modelo huérfano: lo MUEVE a trash/audit-<fecha>/models/<id> (reversible)
y se salta dirs de menos de 30 min o con un job queued/running que los referencie (podrían
estar a mitad de publish). Sale != 0 si quedan problemas sin reparar.

Usage: python3 audit_vault.py [--fix]
"""
import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from paths import PIPE  # noqa: E402
from paths import VAULT  # noqa: E402

MIN_ORPHAN_AGE_S = 30 * 60


def _newest_mtime(d: Path) -> float:
    newest = d.stat().st_mtime
    for p in d.rglob("*"):
        try:
            newest = max(newest, p.stat().st_mtime)
        except OSError:
            pass
    return newest


def _active_job_for(vault: Path, cid: str) -> bool | None:
    """True/False if a queued/running job references this clip; None if unknowable."""
    db = vault / "manifest" / "jobs.db"
    if not db.exists():
        return False
    esc = cid.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    try:
        with sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5) as c:
            row = c.execute(
                "SELECT 1 FROM jobs WHERE status IN ('queued','running') AND "
                "(label=? OR artifact LIKE ? ESCAPE '\\' OR spec LIKE ? ESCAPE '\\') LIMIT 1",
                (cid, f"%{esc}%", f"%{esc}%")).fetchone()
        return row is not None
    except sqlite3.Error:
        return None


def _trash_dir(vault: Path, now: float) -> Path:
    return vault / "trash" / f"audit-{time.strftime('%Y%m%d', time.localtime(now))}"


def audit(vault: Path = VAULT, fix: bool = False, now: float | None = None,
          min_age_s: float = MIN_ORPHAN_AGE_S, rebuild_index=None) -> tuple[list[str], list[str], list[str]]:
    """Returns (problems, fixed, remaining). `remaining` are problems still present after
    the run (all of them without --fix)."""
    now = time.time() if now is None else now
    problems: list[str] = []
    fixed: list[str] = []
    remaining: list[str] = []

    def found(msg: str, repaired: bool = False):
        problems.append(msg)
        if not repaired:
            remaining.append(msg)

    # 1) dirs de modelo sin meta.json
    models_dir = vault / "models"
    for d in sorted(models_dir.iterdir()) if models_dir.exists() else []:
        if not d.is_dir() or (d / "meta.json").exists():
            continue
        msg = f"modelo huérfano sin meta.json: models/{d.name}"
        if not fix:
            found(msg)
            continue
        age = now - _newest_mtime(d)
        if age < min_age_s:
            found(f"{msg} (saltado: modificado hace {int(age)}s < {int(min_age_s)}s, puede estar publicándose)")
            continue
        active = _active_job_for(vault, d.name)
        if active is None:
            found(f"{msg} (saltado: jobs.db ilegible, no se puede descartar un job activo)")
            continue
        if active:
            found(f"{msg} (saltado: hay un job activo que lo referencia)")
            continue
        dest_root = _trash_dir(vault, now) / "models"
        dest_root.mkdir(parents=True, exist_ok=True)
        dest = dest_root / d.name
        if dest.exists():
            dest = dest_root / f"{d.name}.{int(now)}"
        shutil.move(str(d), str(dest))
        found(msg, repaired=True)
        fixed.append(f"models/{d.name} → {dest.relative_to(vault)}")

    # 2) temporales publicados
    junk = []
    if models_dir.exists():
        junk = [*models_dir.rglob(".DS_Store"),
                *[p for p in models_dir.rglob(".*.tif")],
                *models_dir.rglob("*.aux.xml")]
    for p in junk:
        msg = f"temporal publicado: {p.relative_to(vault)}"
        if fix:
            p.unlink(missing_ok=True)
            fixed.append(f"eliminado {p.relative_to(vault)}")
        found(msg, repaired=fix)

    # 3) jobs done con artifact muerto
    db = vault / "manifest" / "jobs.db"
    if db.exists():
        try:
            conn = sqlite3.connect(db) if fix else sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            with conn as c:
                c.row_factory = sqlite3.Row
                rows = c.execute("SELECT id, artifact FROM jobs "
                                 "WHERE status='done' AND artifact != ''").fetchall()
                for r in rows:
                    if (vault / r["artifact"]).exists():
                        continue
                    msg = f"job {r['id']}: artifact muerto → {r['artifact']}"
                    if fix:
                        c.execute("UPDATE jobs SET artifact='', "
                                  "detail=detail || ' · artifact eliminado' WHERE id=?",
                                  (r["id"],))
                        fixed.append(f"job {r['id']}: link limpiado")
                    found(msg, repaired=fix)
            conn.close()
        except sqlite3.Error as error:
            found(f"jobs.db ilegible: {error}")

    # 4) splats diminutos (informativo: no hay reparación automática)
    splats = vault / "splats"
    for sp in sorted(splats.glob("*.splat")) if splats.exists() else []:
        if sp.stat().st_size < 200_000:
            found(f"splat sospechosamente chico ({sp.stat().st_size} B): splats/{sp.name}")

    # 5) system.json desincronizado del filesystem
    sysf = vault / "manifest" / "system.json"
    if sysf.exists():
        listed = {m["clip_id"] for m in json.loads(sysf.read_text()).get("models", [])}
        real = {d.name for d in models_dir.iterdir()
                if d.is_dir() and (d / "meta.json").exists()} if models_dir.exists() else set()
        if listed != real:
            msg = f"índice desincronizado: manifest={sorted(listed)} vs disco={sorted(real)}"
            repaired = False
            if fix:
                try:
                    (rebuild_index or (lambda: subprocess.run(
                        [sys.executable, str(PIPE / "build_index.py")], check=True)))()
                    fixed.append("índice regenerado")
                    repaired = True
                except (subprocess.CalledProcessError, OSError) as error:
                    msg += f" (regenerar falló: {error})"
            found(msg, repaired=repaired)
    return problems, fixed, remaining


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--vault", type=Path, default=VAULT)
    args = ap.parse_args(argv)
    problems, fixed, remaining = audit(args.vault, args.fix)

    print(f"{'=' * 52}\nAUDIT VAULT — {len(problems)} hallazgo(s)")
    for p in problems:
        print(f"  ✗ {p}")
    if args.fix:
        print(f"--fix aplicó {len(fixed)} reparación(es):")
        for f in fixed:
            print(f"  ✓ {f}")
    elif problems:
        print("corre con --fix para reparar")
    if not problems:
        print("  ✓ vault íntegro")
    if remaining:
        print(f"{len(remaining)} problema(s) sin reparar")
    return 1 if remaining else 0


if __name__ == "__main__":
    sys.exit(main())
