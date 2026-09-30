"""Browser gate for published 3D assets.

Runs Chrome headless through the Chrome DevTools Protocol using only Python's
stdlib. This keeps the worker independent from Playwright/npm while still
verifying the real browser surface before a 3D/splat job is marked done.

Usage:
  python3 browser_gate.py model <clip_id>
  python3 browser_gate.py splat <clip_id>
"""
from __future__ import annotations

import argparse
import atexit
import base64
import hashlib
import json
import os
import queue
import re
import shutil
import signal
import socket
import struct
import threading
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from paths import VAULT


CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
QA_DIR = VAULT / "qa"
DEFAULT_BASE_URL = "http://127.0.0.1:8790"
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WS:
    def __init__(self, url: str):
        u = urllib.parse.urlparse(url)
        self.host = u.hostname or "127.0.0.1"
        self.port = u.port or 80
        path = (u.path or "/") + (("?" + u.query) if u.query else "")
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        res = b""
        while b"\r\n\r\n" not in res:
            res += self.sock.recv(4096)
        if b" 101 " not in res.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"websocket handshake failed: {res[:120]!r}")
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        if expected.lower().encode() not in res.lower():
            raise RuntimeError("websocket accept mismatch")

    def send_json(self, msg: dict):
        data = json.dumps(msg, separators=(",", ":")).encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head += struct.pack("!BH", 0x80 | 126, n)
        else:
            head += struct.pack("!BQ", 0x80 | 127, n)
        mask = os.urandom(4)
        head += mask
        self.sock.sendall(bytes(head) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read_exact(self, n: int) -> bytes:
        # recv() puede devolver menos bytes de los pedidos: leer exacto o fallar claro
        data = bytearray()
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise RuntimeError("websocket cerrado a mitad de frame")
            data.extend(chunk)
        return bytes(data)

    def recv_json(self, timeout=10) -> dict:
        self.sock.settimeout(timeout)
        b1, b2 = self._read_exact(2)
        opcode = b1 & 0x0F
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._read_exact(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._read_exact(8))[0]
        masked = b2 & 0x80
        mask = self._read_exact(4) if masked else b""
        data = bytearray(self._read_exact(n))
        if masked:
            data = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
        if opcode == 8:
            raise RuntimeError("websocket closed")
        return json.loads(data.decode())

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class CDP:
    def __init__(self, ws_url: str):
        self.ws = WS(ws_url)
        self.next_id = 1
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def send(self, method: str, params: dict | None = None) -> dict:
        mid = self.next_id
        self.next_id += 1
        self.ws.send_json({"id": mid, "method": method, "params": params or {}})
        while True:
            msg = self.ws.recv_json()
            self._event(msg)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def _event(self, msg: dict):
        method = msg.get("method")
        params = msg.get("params") or {}
        if method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails", {})
            self.errors.append(details.get("text") or json.dumps(details)[:300])
        elif method == "Runtime.consoleAPICalled" and params.get("type") == "error":
            args = params.get("args") or []
            self.errors.append("console.error: " + " ".join(str(a.get("value", a.get("description", ""))) for a in args))
        elif method == "Runtime.consoleAPICalled" and params.get("type") == "warning":
            args = params.get("args") or []
            self.warnings.append("console.warning: " + " ".join(
                str(a.get("value", a.get("description", ""))) for a in args))
        elif method == "Log.entryAdded" and (params.get("entry") or {}).get("level") == "error":
            entry = params["entry"]
            where = entry.get("url") or entry.get("source") or ""
            message = entry.get("text") or ""
            self.errors.append((f"{message} · {where}" if where else message)[:500])
        elif method == "Log.entryAdded" and (params.get("entry") or {}).get("level") == "warning":
            entry = params["entry"]
            where = entry.get("url") or entry.get("source") or ""
            message = entry.get("text") or ""
            self.warnings.append((f"{message} · {where}" if where else message)[:500])

    def pump(self, seconds: float):
        end = time.time() + seconds
        while time.time() < end:
            try:
                self._event(self.ws.recv_json(timeout=min(0.5, max(0.05, end - time.time()))))
            except socket.timeout:
                pass

    def eval(self, expression: str):
        res = self.send("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": True,
            "returnByValue": True,
        })
        if res.get("exceptionDetails"):
            raise RuntimeError(res["exceptionDetails"].get("text", "Runtime.evaluate failed"))
        return (res.get("result") or {}).get("value")

    def close(self):
        self.ws.close()


PROFILE_PREFIX = "aerobrain-chrome-"
STARTUP_DEADLINE_S = 12


class _Profile:
    """Perfil temporal de Chrome. cleanup() es idempotente y NUNCA falla (la limpieza jamás
    decide el estado de un job — el rmtree corre en race con Chrome escribiendo el perfil)."""

    def __init__(self):
        self.name = tempfile.mkdtemp(prefix=PROFILE_PREFIX)

    def cleanup(self):
        for _ in range(2):
            shutil.rmtree(self.name, ignore_errors=True)
            if not os.path.exists(self.name):
                break
            time.sleep(0.3)


def _signal_group(pgid: int, sig: int) -> bool:
    try:
        os.killpg(pgid, sig)
        return True
    except (ProcessLookupError, PermissionError):
        return False


class ChromeProc(subprocess.Popen):
    """Chrome headless como líder de su PROPIO grupo de procesos (start_new_session):
    terminate()/kill() alcanzan a todo el árbol (GPU, renderers, network, crashpad), no solo
    al proceso superior — antes quedaban árboles huérfanos reparentados a launchd."""

    def terminate(self):
        _signal_group(self.pid, signal.SIGTERM)

    def kill(self):
        _signal_group(self.pid, signal.SIGKILL)


def teardown_chrome(proc, profile=None, grace: float = 5.0):
    """SIGTERM al grupo → espera `grace` → SIGKILL al grupo (incluso si el líder ya salió pero
    quedaron hijos) → borra el perfil temporal. Idempotente."""
    try:
        if proc is not None:
            _signal_group(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                pass
            _signal_group(proc.pid, signal.SIGKILL)     # ESRCH si el grupo ya no existe
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
    finally:
        if profile is not None:
            profile.cleanup()


_LIVE: dict[int, tuple] = {}     # pid → (proc, profile) de Chromes lanzados por ESTE proceso
_HOOKS_INSTALLED = False


def _cleanup_all():
    for pid, (proc, profile) in list(_LIVE.items()):
        try:
            teardown_chrome(proc, profile, grace=2.0)
        finally:
            _LIVE.pop(pid, None)


def _install_exit_hooks():
    """atexit + SIGTERM: si el gate muere por SIGTERM (timeout del worker) el `finally` no corre."""
    global _HOOKS_INSTALLED
    if _HOOKS_INSTALLED:
        return
    _HOOKS_INSTALLED = True
    atexit.register(_cleanup_all)
    if threading.current_thread() is not threading.main_thread():
        return
    prev = signal.getsignal(signal.SIGTERM)

    def _on_term(signum, frame):
        _cleanup_all()
        if callable(prev):
            prev(signum, frame)
            return
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        os.kill(os.getpid(), signal.SIGTERM)

    signal.signal(signal.SIGTERM, _on_term)


def _ps_table() -> list[tuple[int, int, int, str]]:
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,pgid=,command="],
                         capture_output=True, text=True, timeout=10).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4 and parts[0].isdigit() and parts[1].isdigit() and parts[2].isdigit():
            rows.append((int(parts[0]), int(parts[1]), int(parts[2]), parts[3]))
    return rows


def reap_stale_chrome(rows=None, tmp_root: str | None = None, kill: bool = True) -> list[int]:
    """Mata árboles de Chrome headless HUÉRFANOS (ppid 1) de gates anteriores cuyo
    --user-data-dir cuelga del prefijo temporal de este módulo. Jamás toca el Chrome real del
    usuario (perfil propio, no headless, o con padre vivo). Devuelve los pids raíz encontrados."""
    root = os.path.realpath(tmp_root or tempfile.gettempdir())
    markers = tuple(f"--user-data-dir={base}{os.sep}{PROFILE_PREFIX}"
                    for base in {root, tmp_root or tempfile.gettempdir()})
    try:
        rows = rows if rows is not None else _ps_table()
    except (OSError, subprocess.SubprocessError):
        return []
    children: dict[int, list[int]] = {}
    for pid, ppid, _pg, _cmd in rows:
        children.setdefault(ppid, []).append(pid)
    roots = [(pid, pgid, cmd) for pid, ppid, pgid, cmd in rows
             if ppid == 1 and "--headless" in cmd and any(m in cmd for m in markers)]
    for pid, pgid, cmd in roots:
        if kill:
            if pgid == pid:
                _signal_group(pgid, signal.SIGKILL)        # grupo propio (lanzado por esta versión)
            else:
                # versión vieja: compartía pgid con el gate/worker → NO matar el grupo, solo el árbol
                stack, tree = [pid], []
                while stack:
                    cur = stack.pop()
                    tree.append(cur)
                    stack.extend(children.get(cur, []))
                for victim in tree:
                    try:
                        os.kill(victim, signal.SIGKILL)
                    except (ProcessLookupError, PermissionError):
                        pass
        m = re.search(r"--user-data-dir=(\S+)", cmd)
        if kill and m and os.path.basename(m.group(1)).startswith(PROFILE_PREFIX):
            shutil.rmtree(m.group(1), ignore_errors=True)
    if kill:
        # perfiles temporales viejos que ningún proceso usa (fugas de corridas muertas)
        in_use = "\n".join(cmd for _p, _pp, _pg, cmd in rows)
        try:
            for d in Path(root).glob(PROFILE_PREFIX + "*"):
                if d.is_dir() and str(d) not in in_use and time.time() - d.stat().st_mtime > 3600:
                    shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass
    return [pid for pid, _pg, _cmd in roots]


def launch_chrome():
    if not CHROME.exists():
        raise RuntimeError(f"Chrome no encontrado: {CHROME}")
    _install_exit_hooks()
    reap_stale_chrome()
    profile = _Profile()
    proc = None
    try:
        proc = ChromeProc([
            str(CHROME), "--headless=new", "--remote-debugging-port=0",
            f"--user-data-dir={profile.name}", "--no-first-run", "--no-default-browser-check",
            "--window-size=1280,900",
            # tests must never be heard: headless runs share the Mac's speakers with the owner
            "--mute-audio",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
            start_new_session=True)
        _LIVE[proc.pid] = (proc, profile)
        # stderr por hilo+cola: readline() directo bloquea para siempre si Chrome no imprime
        # nada y se salta el deadline. El hilo sigue drenando después (un PIPE sin leer se llena
        # con warnings GPU/GL, Chrome se bloquea y el gate cuelga con el asset ya publicado).
        lines: queue.Queue = queue.Queue()

        def _pump(stream):
            try:
                for line in iter(stream.readline, ""):
                    lines.put(line)
            except (OSError, ValueError):
                pass
            lines.put(None)

        threading.Thread(target=_pump, args=(proc.stderr,), daemon=True).start()
        ws_url = None
        deadline = time.time() + STARTUP_DEADLINE_S
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            try:
                line = lines.get(timeout=min(remaining, 0.5))
            except queue.Empty:
                if proc.poll() is not None:
                    raise RuntimeError("Chrome terminó antes de abrir DevTools")
                continue
            if line is None:
                raise RuntimeError("Chrome terminó antes de abrir DevTools")
            if "DevTools listening on " in line:
                ws_url = line.split("DevTools listening on ", 1)[1].strip()
                break
        if not ws_url:
            raise RuntimeError("Chrome no abrió DevTools a tiempo")
        port = urllib.parse.urlparse(ws_url).port
        return proc, profile, port
    except BaseException:
        if proc is not None:
            _LIVE.pop(proc.pid, None)
        teardown_chrome(proc, profile)
        raise


def new_page(port: int) -> CDP:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        info = json.loads(r.read())
    cdp = CDP(info["webSocketDebuggerUrl"])
    for method in ("Runtime.enable", "Log.enable", "Page.enable"):
        cdp.send(method)
    return cdp


def gate(kind: str, cid: str, base_url: str, timeout: int) -> Path:
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        url = f"{base_url.rstrip('/')}/share.html?m={urllib.parse.quote(cid)}"
        cdp.send("Page.navigate", {"url": url})
        body = ""
        deadline = time.time() + timeout
        while time.time() < deadline:
            cdp.pump(0.5)
            try:
                body = cdp.eval("document.body.innerText") or ""
            except RuntimeError:
                continue   # navegación en vuelo: "Execution context was destroyed" no es fallo
            body_l = body.lower()
            if "visor 3d" in body_l or "este modelo no existe" in body_l:
                break
        body_l = body.lower()
        if "este modelo no existe" in body_l or "visor 3d" not in body_l:
            raise RuntimeError(f"share.html no cargó el modelo 3D · body={body[:180]!r} · errors={cdp.errors[:3]}")
        if kind == "splat":
            clicked = cdp.eval("(() => { const b = document.querySelector('[data-v=\"splat\"]'); if (b) b.click(); return !!b; })()")
            if not clicked:
                raise RuntimeError("share.html no expuso botón de Gaussian splat")
            cdp.pump(min(timeout, 18))
            state = cdp.eval("""(() => {
              const v = document.querySelector('#sh-view');
              const text = v ? v.innerText : '';
              return { canvas: !!(v && v.querySelector('canvas')),
                       text, failed: /No se pudo cargar|timeout/i.test(text) };
            })()""")
            if state.get("failed") or not state.get("canvas"):
                raise RuntimeError(f"splat viewer no renderizó canvas: {state}")
        if cdp.errors:
            raise RuntimeError("errores de consola: " + " | ".join(cdp.errors[:4]))
        QA_DIR.mkdir(parents=True, exist_ok=True)
        shot = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        out = QA_DIR / f"{cid}-{kind}.png"
        out.write_bytes(base64.b64decode(shot["data"]))
        if out.stat().st_size < 20_000:
            raise RuntimeError(f"screenshot sospechosamente chico: {out.stat().st_size} bytes")
        return out
    finally:
        if cdp:
            cdp.close()
        _LIVE.pop(proc.pid, None)
        teardown_chrome(proc, profile)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=("model", "splat"))
    ap.add_argument("clip_id")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--timeout", type=int, default=45)
    args = ap.parse_args()
    out = gate(args.kind, args.clip_id, args.base_url, args.timeout)
    print(f"browser gate ok: {out}")


if __name__ == "__main__":
    main()
