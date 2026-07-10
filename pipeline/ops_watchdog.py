#!/opt/homebrew/bin/python3
"""AeroBrain ops watchdog.

Keeps the public site reachable while the Mac is on, without touching heavy
ODM/OpenSplat work. launchd already restarts crashed processes; this script
catches the common operational failures: a wedged local web server, a tunnel
that is running but no longer reaches the origin, or a worker process missing.
"""
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

WEB_LABEL = "com.aerobrain.web"
WORKER_LABEL = "com.aerobrain.worker"
TUNNEL_LABEL = "com.metislab.tunnel"
LOCAL_URL = "http://127.0.0.1:8790/api/healthz"
PUBLIC_URL = "https://vuelos.metislab.work/api/healthz"
PUBLIC_WWW_URL = "https://www.metislab.work/"
STATE = Path("/tmp/aerobrain-watchdog-state.json")
LOG = Path("/tmp/aerobrain-watchdog.log")
VAULT = Path("/Volumes/SSD/drone-vault")
PUBLIC_INTERVAL_S = 300
STREAM_INTERVAL_S = 900
MAX_LOG_BYTES = 5 * 1024 * 1024
LOGS_TO_ROTATE = (
    LOG,
    Path("/tmp/aerobrain-watchdog.launchd.log"),
    Path("/tmp/aerobrain-web.log"),
    Path("/tmp/aerobrain-worker.log"),
    Path("/tmp/metislab-tunnel.log"),
)


def rotate_logs():
    for path in LOGS_TO_ROTATE:
        try:
            if path.is_file() and path.stat().st_size > MAX_LOG_BYTES:
                prev = path.with_name(path.name + ".1")
                prev.unlink(missing_ok=True)
                prev.write_bytes(path.read_bytes())
                with path.open("r+b") as fh:
                    fh.truncate(0)
        except OSError:
            pass


def log(event: str, **fields):
    rotate_logs()
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "event": event, **fields}
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as fh:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict):
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, separators=(",", ":")))
    tmp.replace(STATE)


def launch_state(label: str) -> str:
    try:
        out = subprocess.check_output(
            ["launchctl", "print", f"gui/501/{label}"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
        )
    except subprocess.CalledProcessError:
        return "missing"
    except subprocess.TimeoutExpired:
        return "timeout"
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("state ="):
            return line.partition("=")[2].strip()
    return "unknown"


def kick(label: str, why: str):
    log("kickstart", label=label, why=why)
    subprocess.run(["launchctl", "kickstart", "-k", f"gui/501/{label}"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)


def _alive(status: int, body: str) -> bool:
    """Vivo-a-efectos-de-reinicio. Un 503 cuyo body es el JSON de NUESTRO healthz significa
    server vivo pero DEGRADADO (disco <10GB, manifest roto): kickstart -k no arregla nada y
    mata uploads/edits en curso — sin esto, tormenta de reinicios cada 60s hasta que el disco
    se libere. Un 502/530 de Cloudflare trae HTML (no parsea como JSON) → sí se cura."""
    if 200 <= status < 400:
        return True
    try:
        return isinstance(json.loads(body), dict)
    except ValueError:
        return False


def probe(url: str, timeout: int) -> tuple[bool, str, int]:
    req = urllib.request.Request(url, headers={"User-Agent": "AeroBrainWatchdog/1"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            detail = r.read(2048).decode("utf-8", "replace")
            return _alive(r.status, detail), f"{r.status} {detail[:180]}", round((time.monotonic() - t0) * 1000)
    except urllib.error.HTTPError as e:
        detail = e.read(2048).decode("utf-8", "replace")
        return _alive(e.code, detail), f"{e.code} {detail[:180]}", round((time.monotonic() - t0) * 1000)
    except Exception as e:
        return False, type(e).__name__, round((time.monotonic() - t0) * 1000)


def latest_proxy_url() -> str | None:
    try:
        flights = json.loads((VAULT / "manifest" / "flights.json").read_text()).get("flights", [])
    except (OSError, ValueError):
        return None
    for f in flights:
        cid = f.get("clip_id")
        if cid and f.get("has_proxy") and (VAULT / "proxies" / f"{cid}.mp4").is_file():
            return "https://vuelos.metislab.work/data/proxies/" + urllib.parse.quote(f"{cid}.mp4")
    return None


def range_probe(url: str, timeout: int) -> tuple[bool, str, int]:
    req = urllib.request.Request(url, headers={
        "User-Agent": "AeroBrainWatchdog/1",
        "Range": "bytes=0-0",
    })
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read(1)
            cr = r.headers.get("Content-Range", "")
            return r.status == 206 and cr.startswith("bytes 0-0/"), f"{r.status} {cr}", round((time.monotonic() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return False, f"{e.code} {e.headers.get('Content-Range', '')}", round((time.monotonic() - t0) * 1000)
    except Exception as e:
        return False, type(e).__name__, round((time.monotonic() - t0) * 1000)


def probe_and_heal(event: str, label: str, probe_fn, why: str,
                   retry_delay: float = 2, restart_delay: float = 4,
                   **fields) -> bool:
    """Retry a failed probe before restarting its service.

    A single network or disk scheduling hiccup must not kill a healthy service.
    This matters most for the web process because light ingest/edit jobs still
    run there. A process that launchd reports dead is restarted separately and
    immediately at the top of ``main``.
    """
    ok, detail, ms = probe_fn()
    if ok:
        log(event, ok=True, detail=detail, ms=ms, **fields)
        return True

    time.sleep(retry_delay)
    ok, detail, ms = probe_fn()
    if ok:
        log(event, ok=True, detail=detail, ms=ms, recovered="retry", **fields)
        return True

    kick(label, f"{why} failed twice: {detail}")
    time.sleep(restart_delay)
    ok, detail, ms = probe_fn()
    log(event, ok=ok, detail=detail, ms=ms,
        recovered="restart" if ok else "failed", **fields)
    return ok


def main():
    state = load_state()
    now = time.time()

    for label in (WEB_LABEL, WORKER_LABEL, TUNNEL_LABEL):
        st = launch_state(label)
        if st != "running":
            kick(label, f"launchd state {st}")

    probe_and_heal("local_probe", WEB_LABEL, lambda: probe(LOCAL_URL, 4),
                   "local probe")

    if now - float(state.get("last_public_probe", 0)) >= PUBLIC_INTERVAL_S:
        state["last_public_probe"] = now
        # The local origin was checked first. A repeated public-only failure
        # points at cloudflared, DNS, or Cloudflare edge state.
        probe_and_heal("public_probe", TUNNEL_LABEL,
                       lambda: probe(PUBLIC_URL, 12), "public probe")
        probe_and_heal("public_www_probe", TUNNEL_LABEL,
                       lambda: probe(PUBLIC_WWW_URL, 12), "public www probe")

    if now - float(state.get("last_stream_probe", 0)) >= STREAM_INTERVAL_S:
        state["last_stream_probe"] = now
        video_url = latest_proxy_url()
        if not video_url:
            log("stream_probe", ok=False, detail="no proxy video found")
        else:
            probe_and_heal("stream_probe", TUNNEL_LABEL,
                           lambda: range_probe(video_url, 15),
                           "stream range probe",
                           url=video_url.rsplit("/", 1)[-1])

    save_state(state)


if __name__ == "__main__":
    main()
