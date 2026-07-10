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
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path


CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
QA_DIR = Path("/Volumes/SSD/drone-vault/qa")
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
        elif method == "Log.entryAdded" and (params.get("entry") or {}).get("level") == "error":
            self.errors.append((params["entry"].get("text") or "")[:300])

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


def launch_chrome():
    if not CHROME.exists():
        raise RuntimeError(f"Chrome no encontrado: {CHROME}")
    profile = tempfile.TemporaryDirectory(prefix="aerobrain-chrome-")
    proc = subprocess.Popen([
        str(CHROME), "--headless=new", "--remote-debugging-port=0",
        f"--user-data-dir={profile.name}", "--no-first-run", "--no-default-browser-check",
        "--window-size=1280,900",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    ws_url = None
    deadline = time.time() + 12
    while time.time() < deadline:
        line = proc.stderr.readline() if proc.stderr else ""
        if "DevTools listening on " in line:
            ws_url = line.split("DevTools listening on ", 1)[1].strip()
            break
        if proc.poll() is not None:
            raise RuntimeError("Chrome terminó antes de abrir DevTools")
    if not ws_url:
        proc.terminate()
        raise RuntimeError("Chrome no abrió DevTools a tiempo")
    # DRENAR stderr en background: dejarlo sin leer llena el buffer de 64KB del PIPE con
    # warnings de GPU/GL (habitual en headless) → Chrome se bloquea escribiendo → gate cuelga
    # → timeout → job en error con el asset YA publicado
    threading.Thread(target=lambda: [None for _ in iter(proc.stderr.readline, "")],
                     daemon=True).start()
    port = urllib.parse.urlparse(ws_url).port
    return proc, profile, port


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
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        profile.cleanup()


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
