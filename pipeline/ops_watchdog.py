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
import urllib.request
from pathlib import Path

WEB_LABEL = "com.aerobrain.web"
WORKER_LABEL = "com.aerobrain.worker"
TUNNEL_LABEL = "com.metislab.tunnel"
LOCAL_URL = "http://127.0.0.1:8790/api/healthz"
PUBLIC_URL = "https://vuelos.metislab.work/api/healthz"
STATE = Path("/tmp/aerobrain-watchdog-state.json")
LOG = Path("/tmp/aerobrain-watchdog.log")
PUBLIC_INTERVAL_S = 300


def log(event: str, **fields):
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


def probe(url: str, timeout: int) -> tuple[bool, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "AeroBrainWatchdog/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            detail = r.read(512).decode("utf-8", "replace")
            return 200 <= r.status < 400, f"{r.status} {detail[:180]}"
    except urllib.error.HTTPError as e:
        detail = e.read(512).decode("utf-8", "replace")
        return 200 <= e.code < 400, f"{e.code} {detail[:180]}"
    except Exception as e:
        return False, type(e).__name__


def main():
    state = load_state()
    now = time.time()

    for label in (WEB_LABEL, WORKER_LABEL, TUNNEL_LABEL):
        st = launch_state(label)
        if st != "running":
            kick(label, f"launchd state {st}")

    ok, detail = probe(LOCAL_URL, 4)
    if not ok:
        kick(WEB_LABEL, f"local probe failed: {detail}")
        time.sleep(2)
        ok2, detail2 = probe(LOCAL_URL, 4)
        log("local_probe", ok=ok2, detail=detail2)
    else:
        log("local_probe", ok=True, detail=detail)

    if now - float(state.get("last_public_probe", 0)) >= PUBLIC_INTERVAL_S:
        state["last_public_probe"] = now
        ok, detail = probe(PUBLIC_URL, 12)
        if not ok:
            # The local origin was checked first. A public-only failure points at
            # cloudflared, DNS, or Cloudflare edge state, so restart only tunnel.
            kick(TUNNEL_LABEL, f"public probe failed: {detail}")
            time.sleep(4)
            ok2, detail2 = probe(PUBLIC_URL, 12)
            log("public_probe", ok=ok2, detail=detail2)
        else:
            log("public_probe", ok=True, detail=detail)

    save_state(state)


if __name__ == "__main__":
    main()
