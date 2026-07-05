"""AeroBrain server — static con HTTP Range (iOS lo exige) + upload + edit API.

Endpoints:
  GET  /...                       estáticos de web/ y /data/ (vault) con 206 Range
  POST /upload?name=f.mp4&token=  sube video (cualquier formato) → procesa solo
  POST /api/edit   (token)        {clip_id, segments:[[in,out]...], vertical} → ffmpeg
  GET  /api/jobs                  estado de uploads/edits
  POST /api/rescan (token)        regenera índices

Token: /Volumes/SSD/drone-vault/.token (se genera solo la primera vez).
"""
import json
import mimetypes
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

WEB = Path("/Volumes/SSD/work/forge-projects/aerobrain/web")
VAULT = Path("/Volumes/SSD/drone-vault")
PIPE = Path("/Volumes/SSD/work/forge-projects/aerobrain/pipeline")
TOKEN_FILE = VAULT / ".token"
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(24))
    TOKEN_FILE.chmod(0o600)
TOKEN = TOKEN_FILE.read_text().strip()

JOBS: list[dict] = []          # [{id, kind, label, status, detail, ts}]
JLOCK = threading.Lock()


def job_add(kind, label):
    with JLOCK:
        j = {"id": f"{kind}-{int(time.time() * 1000)}", "kind": kind, "label": label,
             "status": "running", "detail": "", "ts": time.strftime("%H:%M:%S")}
        JOBS.append(j)
        del JOBS[:-30]
        return j


def job_end(j, status, detail=""):
    with JLOCK:
        j["status"], j["detail"] = status, detail


def rebuild_index():
    subprocess.run(["python3", str(PIPE / "build_index.py")], check=True)


def process_upload(path: Path, j):
    try:
        subprocess.run(["python3", str(PIPE / "process.py"), str(path)],
                       check=True, cwd=PIPE, capture_output=True, text=True)
        rebuild_index()
        job_end(j, "done", path.stem)
    except subprocess.CalledProcessError as e:
        job_end(j, "error", (e.stderr or str(e))[-300:])


def run_edit(spec: dict, j):
    try:
        cid = re.sub(r"[^\w-]", "", spec["clip_id"])
        src = VAULT / "proxies" / f"{cid}.mp4"
        if not src.exists():
            raise FileNotFoundError("clip sin proxy (tier full requerido)")
        vf = "crop=ih*9/16:ih,scale=1080:1920" if spec.get("vertical") else "scale=-2:1080"
        tmp = VAULT / "reels" / ".tmp"
        tmp.mkdir(parents=True, exist_ok=True)
        segs = []
        for i, (a, b) in enumerate(spec["segments"][:20]):
            a, b = float(a), float(b)
            if b <= a:
                continue
            seg = tmp / f"e{i}.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(a), "-i", str(src),
                            "-t", str(min(b - a, 120)), "-vf", vf,
                            "-c:v", "h264_videotoolbox", "-b:v", "8M",
                            "-c:a", "aac", "-b:a", "128k", str(seg)], check=True)
            segs.append(seg)
        if not segs:
            raise ValueError("sin segmentos válidos")
        lst = tmp / "l.txt"
        lst.write_text("".join(f"file '{s}'\n" for s in segs))
        out = VAULT / "reels" / f"edit-{time.strftime('%Y%m%d-%H%M%S')}{'-v' if spec.get('vertical') else ''}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                        "-i", str(lst), "-c", "copy", str(out)], check=True)
        for s in [*segs, lst]:
            s.unlink()
        rebuild_index()
        job_end(j, "done", out.name)
    except Exception as e:
        job_end(j, "error", str(e)[-300:])


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # ---------- static with Range ----------
    def resolve(self):
        p = urllib.parse.urlparse(self.path).path
        p = urllib.parse.unquote(p)
        if p == "/":
            p = "/index.html"
        base = VAULT if p.startswith("/data/") else WEB
        rel = p[6:] if p.startswith("/data/") else p.lstrip("/")
        f = (base / rel).resolve()
        if not str(f).startswith(str(base)) or not f.is_file():
            return None
        return f

    def do_GET(self):
        if self.path.startswith("/api/jobs"):
            return self.send_json({"jobs": list(reversed(JOBS))})
        f = self.resolve()
        if not f:
            return self.send_error(404)
        size = f.stat().st_size
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        self.send_response(206 if rng else 200)
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-cache" if f.suffix == ".json" else "public, max-age=3600")
        self.end_headers()
        with open(f, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = fh.read(min(1024 * 512, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def do_HEAD(self):
        f = self.resolve()
        if not f:
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(f.stat().st_size))
        self.send_header("Content-Type", mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        self.end_headers()

    # ---------- API ----------
    def auth(self, q):
        tok = q.get("token", [""])[0] or self.headers.get("X-Token", "")
        if tok != TOKEN:
            self.send_json({"error": "token inválido"}, 403)
            return False
        return True

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/upload":
            if not self.auth(q):
                return
            name = re.sub(r"[^\w.\-]", "_", Path(q.get("name", ["video.mp4"])[0]).name)
            ext = Path(name).suffix.lower() or ".mp4"
            if ext not in (".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".webm"):
                return self.send_json({"error": f"formato {ext} no soportado"}, 400)
            length = int(self.headers.get("Content-Length", 0))
            if not length:
                return self.send_json({"error": "body vacío"}, 400)
            cid = f"UP_{time.strftime('%Y%m%d%H%M%S')}_{Path(name).stem[:40]}"
            dest = VAULT / "raw" / "uploads"
            dest.mkdir(parents=True, exist_ok=True)
            path = dest / f"{cid}{ext}"
            read = 0
            with open(path, "wb") as f:
                while read < length:
                    chunk = self.rfile.read(min(1024 * 512, length - read))
                    if not chunk:
                        break
                    f.write(chunk)
                    read += len(chunk)
            j = job_add("upload", name)
            threading.Thread(target=process_upload, args=(path, j), daemon=True).start()
            return self.send_json({"ok": True, "clip_id": cid, "bytes": read, "job": j["id"]})
        if u.path == "/api/edit":
            if not self.auth(q):
                return
            spec = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            j = job_add("edit", spec.get("clip_id", "?"))
            threading.Thread(target=run_edit, args=(spec, j), daemon=True).start()
            return self.send_json({"ok": True, "job": j["id"]})
        if u.path == "/api/rescan":
            if not self.auth(q):
                return
            rebuild_index()
            return self.send_json({"ok": True})
        self.send_error(404)


if __name__ == "__main__":
    print(f"AeroBrain server :8790 · token en {TOKEN_FILE}")
    ThreadingHTTPServer(("127.0.0.1", 8790), H).serve_forever()
