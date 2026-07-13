"""Job + session store en SQLite: sobrevive reinicios del server, cancel real.

Tabla jobs: id, kind, label, status(running|done|error|cancelled), detail,
started, finished, pid, container, artifact, log.
Tabla sessions: id, expiry — cookies HttpOnly que persisten reinicios.
"""
import json
import os
import signal
import sqlite3
import re
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path

DB = Path("/Volumes/SSD/drone-vault/manifest/jobs.db")
JOB_LOG_DIR = Path("/Volumes/SSD/drone-vault/ops/job_logs")
_LOCK = threading.Lock()


@contextmanager
def _conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


HEAVY_KINDS = ("3d", "splat")          # los ejecuta el worker desacoplado
LIGHT_KINDS = ("upload", "edit", "analyze", "foto4k", "ingest", "error_report")  # threads del server web


def recon_id_for(sources: list, photos: list | None = None) -> str:
    """Identidad de primera clase para un modelo COMBINADO (entity U0).

    Determinista: mismas fuentes+fotos → mismo id (re-procesar NO duplica
    identidades por accidente; un set distinto SÍ es otra reconstrucción).
    DECISIÓN (no accidente): re-correr el mismo set ACTUALIZA la reconstruction
    (nuevo odm_report/preset) — semántica replace-con-historial idéntica a la
    de single-source en todo el sistema; splat_runs[] SE PRESERVA entre re-runs
    (build_3d_assets lo hereda) y los splats archivan a history/ como siempre.
    El "never overwrite" del spec v3 §8.1 queda superado por consistencia.
    Los single-source conservan su clip_id como identidad — el alias
    clip_id→reconstruction es un no-op permanente para ellos, y los share
    links viejos (?m=<cid>) son contrato público intacto. Como todos los
    namespaces del vault (proj_<id>, models/<id>, splats/<id>) llavean por
    string, un recon_<hash> fluye por el plumbing existente sin tocarlo."""
    import hashlib
    key = "|".join(sorted(sources)) + "||" + "|".join(sorted(photos or []))
    return "recon_" + hashlib.sha1(key.encode()).hexdigest()[:10]


def init(orphan_kinds: tuple = ()):
    """Crea/migra el schema. orphan_kinds: SOLO el proceso dueño de esos kinds debe
    marcarlos huérfanos en su arranque (server → light, worker → heavy). Así un
    restart del server web YA NO mata jobs 3D del worker."""
    DB.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, _conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, kind TEXT, label TEXT, status TEXT, detail TEXT,
            started REAL, finished REAL, pid INTEGER, container TEXT, artifact TEXT, log TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expiry REAL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS job_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL, ts REAL NOT NULL, level TEXT NOT NULL,
            event TEXT NOT NULL, message TEXT, data TEXT)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_job_events_job_ts ON job_events(job_id, ts, id)")
        # migraciones aditivas (SQLite no soporta ADD COLUMN IF NOT EXISTS)
        have = {r[1] for r in c.execute("PRAGMA table_info(jobs)").fetchall()}
        for col, typ in (("log", "TEXT"), ("spec", "TEXT"), ("stage", "TEXT"),
                         ("progress", "REAL")):
            if col not in have:
                c.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")
        if orphan_kinds:
            ph = ",".join("?" * len(orphan_kinds))
            orphans = c.execute(f"SELECT id, pid, container FROM jobs "
                                f"WHERE status='running' AND kind IN ({ph})",
                                orphan_kinds).fetchall()
            for o in orphans:
                pid = o["pid"]
                if pid and _proc_ours(pid):          # solo si el pid sigue siendo un job NUESTRO
                    _kill_pg(pid, signal.SIGTERM)
                    time.sleep(0.2)
                    if not _proc_gone(pid):
                        _kill_pg(pid, signal.SIGKILL)
                if o["container"]:
                    try:
                        subprocess.run(["/usr/local/bin/docker", "kill", o["container"]],
                                       capture_output=True, timeout=30)
                    except (subprocess.TimeoutExpired, OSError):
                        pass
            c.execute(f"UPDATE jobs SET status='error', detail='proceso dueño reiniciado "
                      f"durante el job', finished=?, pid=NULL "
                      f"WHERE status='running' AND kind IN ({ph})",
                      (time.time(), *orphan_kinds))
        c.execute("UPDATE jobs SET pid=NULL WHERE status != 'running' AND pid IS NOT NULL")
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
    return bool(r and r["expiry"] is not None and r["expiry"] > time.time())


def session_delete(sid: str):
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM sessions WHERE id=?", (sid,))


def enqueue(kind: str, label: str, spec: dict | None = None) -> dict:
    """Encola un job pesado; el worker lo reclama. NO arranca nada aquí."""
    j = {"id": f"{kind}-{int(time.time() * 1000)}", "kind": kind, "label": label,
         "status": "queued"}
    with _LOCK, _conn() as c:
        c.execute("INSERT INTO jobs (id, kind, label, status, detail, started, spec) "
                  "VALUES (?,?,?,?,?,?,?)",
                  (j["id"], kind, label, "queued", "en cola", time.time(),
                   json.dumps(spec or {})))
    event(j["id"], "queued", "Trabajo en cola", data={"kind": kind, "spec": spec or {}})
    return j


def claim(kinds: tuple = HEAVY_KINDS) -> dict | None:
    """El worker reclama atómicamente el job encolado más antiguo (BEGIN IMMEDIATE
    serializa: dos claims concurrentes nunca toman el mismo job)."""
    ph = ",".join("?" * len(kinds))
    with _LOCK, _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        r = c.execute(f"SELECT * FROM jobs WHERE status='queued' AND kind IN ({ph}) "
                      "ORDER BY started ASC LIMIT 1", kinds).fetchone()
        if not r:
            c.execute("COMMIT")
            return None
        c.execute("UPDATE jobs SET status='running', detail='iniciando', started=? "
                  "WHERE id=?", (time.time(), r["id"]))
        c.execute("COMMIT")
        d = dict(r)
        d["status"] = "running"
        d["spec"] = json.loads(d.get("spec") or "{}")
        return d


def pending(kind: str, label: str) -> bool:
    """¿Ya hay un job queued/running para este kind+label? (dedupe de doble tap)"""
    with _LOCK, _conn() as c:
        r = c.execute("SELECT 1 FROM jobs WHERE kind=? AND label=? "
                      "AND status IN ('queued','running') LIMIT 1", (kind, label)).fetchone()
        return bool(r)


def add(kind: str, label: str, container: str = "") -> dict:
    j = {"id": f"{kind}-{int(time.time() * 1000)}", "kind": kind, "label": label,
         "status": "running", "detail": "", "container": container}
    with _LOCK, _conn() as c:
        c.execute("INSERT INTO jobs (id, kind, label, status, detail, started, container) "
                  "VALUES (?,?,?,?,?,?,?)",
                  (j["id"], kind, label, "running", "", time.time(), container))
    event(j["id"], "started", "Trabajo iniciado", data={"kind": kind})
    return j


def update(jid: str, **kw):
    sets = ", ".join(f"{k}=?" for k in kw)
    with _LOCK, _conn() as c:
        # cronología de fases sin columna nueva: cada cambio real de stage queda como
        # evento 'stage' — la UI deriva de ahí cuánto duró cada fase (dato, no estimación)
        if kw.get("stage"):
            row = c.execute("SELECT stage FROM jobs WHERE id=?", (jid,)).fetchone()
            if row and row[0] != kw["stage"]:
                c.execute("INSERT INTO job_events (job_id, ts, level, event, message, data) "
                          "VALUES (?,?,?,?,?,?)",
                          (jid, time.time(), "debug", "stage", str(kw["stage"])[:80], "{}"))
        c.execute(f"UPDATE jobs SET {sets} WHERE id=?", (*kw.values(), jid))


def stage_history(jid: str) -> list:
    """[{stage, ts}] de los eventos 'stage' — la cronología real de fases del job."""
    with _LOCK, _conn() as c:
        rows = c.execute("SELECT ts, message FROM job_events WHERE job_id=? AND event='stage' "
                         "ORDER BY ts LIMIT 40", (jid,)).fetchall()
    return [{"ts": r[0], "stage": r[1]} for r in rows]


def event(jid: str, event: str, message: str = "", level: str = "info",
          data: dict | None = None):
    """Append an immutable structured transition or diagnosis to a job."""
    if not re.fullmatch(r"[\w.-]+", str(jid)):
        raise ValueError("invalid job id")
    level = level if level in ("debug", "info", "warning", "error") else "info"
    with _LOCK, _conn() as c:
        c.execute("INSERT INTO job_events (job_id, ts, level, event, message, data) "
                  "VALUES (?,?,?,?,?,?)",
                  (jid, time.time(), level, str(event)[:80], str(message)[:1000],
                   json.dumps(data or {}, ensure_ascii=False, default=str)))


def events(jid: str, limit: int = 500) -> list[dict]:
    if not re.fullmatch(r"[\w.-]+", str(jid)):
        raise ValueError("invalid job id")
    limit = max(1, min(1000, int(limit)))
    with _LOCK, _conn() as c:
        rows = c.execute("SELECT ts, level, event, message, data FROM job_events "
                         "WHERE job_id=? ORDER BY ts, id LIMIT ?", (jid, limit)).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        try:
            item["data"] = json.loads(item.get("data") or "{}")
        except ValueError:
            item["data"] = {}
        out.append(item)
    return out


def log_path(jid: str) -> Path:
    """Return the confined append-only log path for a valid job id."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", str(jid)):
        raise ValueError("invalid job id")
    JOB_LOG_DIR.mkdir(parents=True, exist_ok=True)
    return JOB_LOG_DIR / f"{jid}.log"


def log_chunk(jid: str, after: int = 0, limit: int = 500) -> dict:
    """Read a bounded line range without loading an unbounded log into the API."""
    after = max(0, int(after))
    limit = max(1, min(1000, int(limit)))
    path = log_path(jid)
    if not path.exists():
        return {"lines": [], "next": after, "eof": True}
    rows = []
    with path.open(errors="replace") as fh:
        for index, line in enumerate(fh):
            if index < after:
                continue
            rows.append(line.rstrip("\n"))
            if len(rows) > limit:
                break
    visible = rows[:limit]
    return {"lines": visible, "next": after + len(visible), "eof": len(rows) <= limit}


def end(jid: str, status: str, detail: str = "", artifact: str = ""):
    # un job terminado nunca conserva pid (evita pids fantasma en la tabla)
    update(jid, status=status, detail=detail[:400], artifact=artifact,
           finished=time.time(), pid=None)
    event(jid, "completed" if status == "done" else status, detail,
          level="error" if status == "error" else "warning" if status.startswith("cancel") else "info",
          data={"artifact": artifact} if artifact else {})
    if status == "error":
        # registro central de errores (ops/errors.jsonl) — lo consume error_report.py/DeepSeek
        try:
            from perf import log_error
            j = get(jid) or {}
            log_error(f"job:{j.get('kind', '?')}", detail or "error sin detalle",
                      {"job": jid, "label": j.get("label", ""), "stage": j.get("stage", "")})
        except Exception:
            pass


def clear_artifacts(cid: str):
    """Al borrar un modelo, los jobs done que apuntaban a el pierden el link
    (el audit encontro tarjetas 'Abrir' hacia assets muertos)."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE jobs SET artifact='', detail=detail || ' · modelo eliminado' "
                  "WHERE label=? AND status='done' AND artifact != ''", (cid,))


def retarget_splat_artifacts(cid: str, archived_splat: str | None,
                             archived_viewer: str | None = None):
    """When a newer splat becomes current, previous done jobs must keep pointing to
    their archived version instead of the mutable viewer path.
    Los paths mutables apuntan al mejor archivado (SOG/ksplat > splat).
    Los jobs nuevos terminan con artifact optimizado: si solo se matchea .splat, la tarjeta
    del job viejo abriria silenciosamente el modelo NUEVO (regresion de 221903f)."""
    target = archived_viewer or archived_splat
    if not target:
        return
    tname = Path(target).name
    with _LOCK, _conn() as c:
        for mutable in (f"splats/{cid}.splat", f"splats/{cid}.ksplat",
                        f"splats/{cid}.clean.sog"):
            c.execute("UPDATE jobs SET artifact=?, detail=replace(detail, ?, ?) "
                      "WHERE kind='splat' AND label=? "
                      "AND status='done' AND artifact=?",
                      (target, Path(mutable).name, tname, cid, mutable))


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
        elif d.get("finished") and d.get("started"):
            d["mins"] = round((d["finished"] - d["started"]) / 60, 1)
        out.append(d)
    return out


def latest_done_ids(kinds: tuple = ("3d",)) -> dict[tuple[str, str], str]:
    """Latest immutable producer for each mutable label/artifact namespace."""
    if not kinds:
        return {}
    ph = ",".join("?" * len(kinds))
    with _LOCK, _conn() as c:
        rows = c.execute(f"SELECT id,kind,label FROM jobs WHERE status='done' "
                         f"AND kind IN ({ph}) ORDER BY finished DESC", kinds).fetchall()
    out = {}
    for row in rows:
        out.setdefault((row["kind"], row["label"]), row["id"])
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
        except (ProcessLookupError, PermissionError):
            return False


def _proc_ours(pid: int) -> bool:
    """El pid huérfano en la BD PERTENECE a un job nuestro (python3/docker/opensplat/ffmpeg)?
    Tras un reboot ese pid casi siempre lo reusa un proceso INOCENTE del sistema — matarlo a
    ciegas (SIGKILL al process-group) podía tumbar dockerd, el server o cualquier cosa."""
    try:
        out = subprocess.run(["ps", "-o", "command=", "-p", str(pid)],
                             capture_output=True, text=True, timeout=3).stdout.lower()
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return False
    # "python3" solo existe en el argv durante ~10-50ms: el python3 de Homebrew se
    # RE-EJECUTA en .../Python.app/Contents/MacOS/Python y ps deja de mostrarlo
    # (P2 resuelto 11-jul: el flake del smoke era ESTA carrera — verde si init
    # corría dentro de la ventana, rojo bajo carga). El término del framework
    # cubre el post-re-exec sin ampliar a cualquier "python" inocente.
    return any(t in out for t in ("python3", "python.app/contents/macos/python",
                                  "opensplat", "docker", "ffmpeg", "odm_prep", "tresd_publish"))


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
    if not j:
        return False
    if j["status"] == "queued":
        end(jid, "cancelled", "cancelado en cola (no llegó a ejecutar)")
        return True
    if j["status"] != "running":
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
        try:
            r = subprocess.run(["/usr/local/bin/docker", "kill", j["container"]],
                               capture_output=True, text=True, timeout=30)
            notes.append("docker killed" if r.returncode == 0 else
                         f"docker kill falló: {(r.stderr or '').strip()[:60]}")
        except (subprocess.TimeoutExpired, OSError) as e:
            notes.append(f"docker kill error: {type(e).__name__}")
    # marca 'cancelled' para que el watcher de run_tracked corte la secuencia
    confirmed = (not pid or _proc_gone(pid))
    # estado honesto: 'cancelled' sólo si el kill se confirmó; si no, 'cancel_failed'
    status = "cancelled" if confirmed else "cancel_failed"
    end(jid, status, "cancelado · " + (" · ".join(notes) or "sin proceso activo"))
    return confirmed


CANCEL_STATES = ("cancelled", "cancel_failed")


def run_tracked(jid: str, cmd: list, timeout: int, env: dict | None = None,
                tail: int = 12, abort_re: str | None = None,
                progress_re: str | None = None,
                progress_span: tuple = (0.05, 0.98),
                tick=None, tick_interval: float = 5.0) -> int:
    """Popen con PID registrado. El control (timeout Y cancelación) se hace con
    proc.wait(timeout=1) en un bucle — INDEPENDIENTE del stdout, así un proceso
    totalmente silencioso también respeta timeout y cancel. Un hilo lector sólo
    actualiza el tail del log."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1, env=env, start_new_session=True)
    update(jid, pid=proc.pid)

    lines: list[str] = []
    abort_hit = threading.Event()
    reader_done = threading.Event()
    full_log = log_path(jid)
    event(jid, "process_started", Path(str(cmd[0])).name,
          data={"program": Path(str(cmd[0])).name})

    def reader():  # espeja el log; abort/progreso se detectan aqui, el control vive afuera
        # throttle: ODM/OpenSplat escupen miles de líneas — un UPDATE por línea es
        # churn de disco + contención del lock con el server leyendo /api/jobs.
        # Escribimos si el % cambió o pasaron >=0.5s desde la última escritura.
        last_pct = -1
        last_write = 0.0
        try:
            with full_log.open("a", encoding="utf-8", buffering=1) as durable:
                for line in proc.stdout:
                    raw = line.rstrip("\n")
                    stamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                    durable.write(f"[{stamp}] {raw}\n")
                    lines.append(raw)
                    del lines[:-200]
                    fields = {}
                    if progress_re:
                        m = re.search(progress_re, line)
                        if m and int(m.group(1)) != last_pct:
                            last_pct = int(m.group(1))
                            lo, hi = progress_span
                            fields["progress"] = round(lo + (hi - lo) * last_pct / 100, 3)
                    now = time.time()
                    if fields or now - last_write >= 0.5:
                        last_write = now
                        fields["log"] = "\n".join(lines[-tail:])
                        update(jid, **fields)
                    if abort_re and re.search(abort_re, line):
                        abort_hit.set()
            update(jid, log="\n".join(lines[-tail:]))
        finally:
            reader_done.set()
    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

    deadline = time.time() + timeout
    reason = None
    last_tick = 0.0
    while True:
        try:
            proc.wait(timeout=1.0)  # avanza aunque no haya stdout
            break
        except subprocess.TimeoutExpired:
            pass
        now = time.time()
        if tick and now - last_tick >= tick_interval:
            last_tick = now
            try:
                tick(proc.pid)
            except Exception as e:
                # Resource policy is best-effort; never lose hours of valid ODM
                # or splat training because a priority adjustment raced exit.
                print(f"resource policy warning: {type(e).__name__}: {e}", flush=True)
        if time.time() > deadline:
            reason = "timeout"
        elif abort_hit.is_set():
            reason = "abort"
        elif (get(jid) or {}).get("status") in CANCEL_STATES:
            reason = "cancel"
        if reason:
            _kill_pg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                _kill_pg(proc.pid, signal.SIGKILL)
                proc.wait()
            # el contenedor no muere al matar la CLI de docker: tumbarlo explícito
            cont = (get(jid) or {}).get("container")
            if cont:
                try:
                    subprocess.run(["/usr/local/bin/docker", "kill", cont],
                                   capture_output=True, timeout=30)
                except (subprocess.TimeoutExpired, OSError):
                    pass
            break

    reader_done.wait(5)
    if proc.stdout:
        proc.stdout.close()
    update(jid, pid=None)
    if reason == "timeout":
        # primitiva auto-consistente: deja el row en 'error' antes de lanzar
        end(jid, "error", f"timeout tras {timeout}s")
        raise TimeoutError(f"timeout tras {timeout}s")
    if reason == "abort":
        raise RuntimeError(f"abortado: el log matcheó '{abort_re}'")
    if reason == "cancel" or (get(jid) or {}).get("status") in CANCEL_STATES:
        raise RuntimeError("cancelado por el operador")
    return proc.returncode
