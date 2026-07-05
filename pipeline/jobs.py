"""Job + session store en SQLite: sobrevive reinicios del server, cancel real.

Tabla jobs: id, kind, label, status(running|done|error|cancelled), detail,
started, finished, pid, container, artifact, log.
Tabla sessions: id, expiry — cookies HttpOnly que persisten reinicios.
"""
import json
import os
import signal
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
            started REAL, finished REAL, pid INTEGER, container TEXT, artifact TEXT, log TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expiry REAL)""")
        # jobs que quedaron "running" de una sesión anterior = huérfanos
        c.execute("UPDATE jobs SET status='error', detail='servidor reiniciado durante el job', "
                  "finished=? WHERE status='running'", (time.time(),))
        c.execute("DELETE FROM sessions WHERE expiry < ?", (time.time(),))


# ---------------- sessions (cookies HttpOnly, persistentes) ----------------
def session_create(days: int = 30) -> str:
    import secrets
    sid = secrets.token_urlsafe(24)
    with _LOCK, _conn() as c:
        c.execute("INSERT INTO sessions (id, expiry) VALUES (?, ?)",
                  (sid, time.time() + days * 86400))
        c.execute("DELETE FROM sessions WHERE expiry < ?", (time.time(),))
    return sid


def session_valid(sid: str) -> bool:
    if not sid:
        return False
    with _LOCK, _conn() as c:
        r = c.execute("SELECT expiry FROM sessions WHERE id=?", (sid,)).fetchone()
    return bool(r and r["expiry"] > time.time())


def session_delete(sid: str):
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM sessions WHERE id=?", (sid,))


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


def _kill_pg(pid: int, sig=signal.SIGTERM) -> bool:
    """Mata el grupo de procesos; True si algo fue señalizado."""
    if not pid:
        return False
    try:
        os.killpg(os.getpgid(pid), sig)
        return True
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, sig)
            return True
        except ProcessLookupError:
            return False


def _proc_gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return False
    except (ProcessLookupError, TypeError):
        return True


def cancel(jid: str) -> bool:
    """Cancela un job. Sólo marca 'cancelled' si el kill se CONFIRMA (o no había
    proceso vivo); si el kill falla, deja el estado con la advertencia explícita."""
    j = get(jid)
    if not j or j["status"] != "running":
        return False
    notes = []
    # 1) matar el proceso (grupo) — SIGTERM y, si sobrevive, SIGKILL
    pid = j["pid"]
    if pid and not _proc_gone(pid):
        _kill_pg(pid, signal.SIGTERM)
        for _ in range(15):
            if _proc_gone(pid):
                break
            time.sleep(0.2)
        if not _proc_gone(pid):
            _kill_pg(pid, signal.SIGKILL)
            time.sleep(0.5)
        notes.append("pid vivo" if not _proc_gone(pid) else "pid terminado")
    # 2) matar el contenedor docker si lo hay (los procesos python-cli no lo tumban)
    if j["container"]:
        r = subprocess.run(["/usr/local/bin/docker", "kill", j["container"]],
                           capture_output=True, text=True, timeout=30)
        notes.append("docker killed" if r.returncode == 0 else
                     f"docker kill falló: {(r.stderr or '').strip()[:60]}")
    # marca 'cancelled' para que el watcher de run_tracked corte la secuencia
    confirmed = (not pid or _proc_gone(pid))
    end(jid, "cancelled", "cancelado · " + (" · ".join(notes) or "sin proceso activo"))
    return confirmed


def run_tracked(jid: str, cmd: list, timeout: int, env: dict | None = None,
                tail: int = 12) -> int:
    """Popen con PID registrado + watcher de cancelación INDEPENDIENTE del stdout
    (un proceso silencioso también se puede matar) + tail de log en vivo."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1, env=env, start_new_session=True)
    update(jid, pid=proc.pid)
    stop = threading.Event()

    def watcher():  # mata el proceso apenas el job pase a 'cancelled', sin esperar stdout
        while not stop.wait(1.5):
            cur = get(jid)
            if not cur or cur["status"] != "running":
                _kill_pg(proc.pid, signal.SIGTERM)
                time.sleep(2)
                if not _proc_gone(proc.pid):
                    _kill_pg(proc.pid, signal.SIGKILL)
                return
    threading.Thread(target=watcher, daemon=True).start()

    lines: list[str] = []
    deadline = time.time() + timeout
    try:
        for line in proc.stdout:  # streaming
            lines.append(line.rstrip())
            del lines[:-200]
            update(jid, log="\n".join(lines[-tail:]))
            if time.time() > deadline:
                _kill_pg(proc.pid, signal.SIGKILL)
                raise TimeoutError(f"timeout tras {timeout}s")
    finally:
        stop.set()
    proc.wait()
    update(jid, pid=None)
    if (get(jid) or {}).get("status") == "cancelled":
        raise RuntimeError("cancelado por el operador")
    return proc.returncode
