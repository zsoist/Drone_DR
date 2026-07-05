"""Job store en SQLite: sobrevive reinicios del server, soporta cancel.

Tabla jobs: id, kind, label, status(running|done|error|cancelled), detail,
started, finished, pid, container, artifact.
"""
import json
import os
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

DB = Path("/Volumes/SSD/drone-vault/manifest/jobs.db")
_LOCK = threading.Lock()


def _conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, _conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, kind TEXT, label TEXT, status TEXT, detail TEXT,
            started REAL, finished REAL, pid INTEGER, container TEXT, artifact TEXT)""")
        # jobs que quedaron "running" de una sesión anterior = huérfanos
        c.execute("UPDATE jobs SET status='error', detail='servidor reiniciado durante el job', "
                  "finished=? WHERE status='running'", (time.time(),))


def add(kind: str, label: str, container: str = "") -> dict:
    j = {"id": f"{kind}-{int(time.time() * 1000)}", "kind": kind, "label": label,
         "status": "running", "detail": "", "container": container}
    with _LOCK, _conn() as c:
        c.execute("INSERT INTO jobs (id, kind, label, status, detail, started, container) "
                  "VALUES (?,?,?,?,?,?,?)",
                  (j["id"], kind, label, "running", "", time.time(), container))
    return j


def update(jid: str, **kw):
    sets = ", ".join(f"{k}=?" for k in kw)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE jobs SET {sets} WHERE id=?", (*kw.values(), jid))


def end(jid: str, status: str, detail: str = "", artifact: str = ""):
    update(jid, status=status, detail=detail[:400], artifact=artifact, finished=time.time())


def get(jid: str) -> dict | None:
    with _LOCK, _conn() as c:
        r = c.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
        return dict(r) if r else None


def recent(n: int = 30) -> list[dict]:
    with _LOCK, _conn() as c:
        rows = c.execute("SELECT * FROM jobs ORDER BY started DESC LIMIT ?", (n,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["ts"] = time.strftime("%H:%M:%S", time.localtime(d["started"]))
        if d["status"] == "running" and d["started"]:
            d["mins"] = round((time.time() - d["started"]) / 60, 1)
        out.append(d)
    return out


def running(kinds: tuple = ("3d", "splat")) -> dict | None:
    with _LOCK, _conn() as c:
        r = c.execute("SELECT * FROM jobs WHERE status='running' AND kind IN (%s) "
                      "ORDER BY started DESC LIMIT 1" % ",".join("?" * len(kinds)), kinds).fetchone()
        return dict(r) if r else None


def cancel(jid: str) -> bool:
    j = get(jid)
    if not j or j["status"] != "running":
        return False
    ok = False
    if j["container"]:
        r = subprocess.run(["/usr/local/bin/docker", "kill", j["container"]],
                           capture_output=True, timeout=30)
        ok = r.returncode == 0
    if j["pid"]:
        try:
            os.kill(j["pid"], 15)
            ok = True
        except ProcessLookupError:
            pass
    end(jid, "cancelled", "cancelado por el operador")
    return ok
