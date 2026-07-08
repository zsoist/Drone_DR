#!/opt/homebrew/bin/python3
"""One-shot AeroBrain operations audit.

Read-only status check for the 24/7 Mac Mini setup. The watchdog heals common
failures; this script proves current state for humans and agents.
"""
import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
REPO = Path("/Volumes/SSD/work/forge-projects/aerobrain")
TUNNEL_CONFIG = Path("/Users/daniel_serverm4/.cloudflared/metislab-work.yml")
LOGS = (
    Path("/tmp/aerobrain-web.log"),
    Path("/tmp/aerobrain-worker.log"),
    Path("/tmp/metislab-tunnel.log"),
    Path("/tmp/aerobrain-watchdog.log"),
    Path("/tmp/aerobrain-watchdog.launchd.log"),
)
LABELS = ("com.aerobrain.web", "com.aerobrain.worker", "com.metislab.tunnel", "com.aerobrain.watchdog")


def launch_state(label: str) -> dict:
    try:
        out = subprocess.check_output(
            ["launchctl", "print", f"gui/501/{label}"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
        )
    except Exception as e:
        return {"state": "missing", "error": type(e).__name__}
    state = "unknown"
    pid = None
    runs = None
    last_exit = None
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("state ="):
            state = s.partition("=")[2].strip()
        elif s.startswith("pid ="):
            try:
                pid = int(s.partition("=")[2].strip())
            except ValueError:
                pass
        elif s.startswith("runs ="):
            try:
                runs = int(s.partition("=")[2].strip())
            except ValueError:
                pass
        elif s.startswith("last exit code ="):
            try:
                last_exit = int(s.partition("=")[2].strip())
            except ValueError:
                pass
    ok = bool(state in ("running", "active") and pid) if label != "com.aerobrain.watchdog" else (last_exit == 0)
    return {"state": state, "pid": pid, "runs": runs, "last_exit": last_exit, "ok": ok}


def fetch_json(url: str, timeout: int) -> tuple[bool, dict | str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AeroBrainOpsStatus/1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 400, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = str(e)
        return False, f"{e.code} {detail}"
    except Exception as e:
        return False, type(e).__name__


def latest_proxy_url() -> str | None:
    try:
        flights = json.loads((VAULT / "manifest" / "flights.json").read_text()).get("flights", [])
    except Exception:
        return None
    for f in flights:
        cid = f.get("clip_id")
        if cid and f.get("has_proxy") and (VAULT / "proxies" / f"{cid}.mp4").is_file():
            return "https://vuelos.metislab.work/data/proxies/" + urllib.parse.quote(f"{cid}.mp4")
    return None


def range_probe(url: str | None) -> dict:
    if not url:
        return {"ok": False, "detail": "no proxy video found"}
    req = urllib.request.Request(url, headers={
        "User-Agent": "AeroBrainOpsStatus/1",
        "Range": "bytes=0-0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read(1)
            cr = r.headers.get("Content-Range", "")
            cache = r.headers.get("cf-cache-status", "")
            ok = r.status == 206 and cr.startswith("bytes 0-0/")
            return {"ok": ok, "status": r.status, "content_range": cr, "cache": cache,
                    "file": url.rsplit("/", 1)[-1]}
    except Exception as e:
        return {"ok": False, "detail": type(e).__name__, "file": url.rsplit("/", 1)[-1]}


def jobs_status() -> dict:
    db = VAULT / "manifest" / "jobs.db"
    try:
        with sqlite3.connect(db, timeout=5) as c:
            c.row_factory = sqlite3.Row
            active = [dict(r) for r in c.execute(
                "SELECT id,kind,label,status,progress,started FROM jobs "
                "WHERE status IN ('queued','running') ORDER BY started DESC LIMIT 10")]
            stale = [dict(r) for r in c.execute(
                "SELECT id,kind,label,status,started FROM jobs "
                "WHERE status='running' AND started < ? ORDER BY started ASC LIMIT 10",
                (time.time() - 8 * 3600,))]
        return {"ok": not stale, "active": active, "stale_running": stale}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


def resource_status() -> dict:
    try:
        out = subprocess.check_output(["ps", "-axo", "pid,pcpu,pmem,rss,command"], text=True, timeout=5)
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}
    rows = []
    total_cpu = 0.0
    total_rss = 0
    pat = re.compile(r"(aerobrain_server|worker\.py|cloudflared)")
    for line in out.splitlines()[1:]:
        if not pat.search(line):
            continue
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        pid, cpu, mem, rss, cmd = parts
        cpu_f = float(cpu)
        rss_i = int(rss)
        total_cpu += cpu_f
        total_rss += rss_i
        rows.append({"pid": int(pid), "cpu": cpu_f, "mem": float(mem), "rss_mb": round(rss_i / 1024, 1),
                     "cmd": cmd[:90]})
    return {"ok": total_cpu < 15 and total_rss < 500_000,
            "total_cpu": round(total_cpu, 1),
            "total_rss_mb": round(total_rss / 1024, 1),
            "processes": rows}


def logs_status() -> dict:
    items = []
    ok = True
    for p in LOGS:
        size = p.stat().st_size if p.exists() else 0
        if size > 6 * 1024 * 1024:
            ok = False
        items.append({"path": str(p), "mb": round(size / 1024**2, 2)})
    return {"ok": ok, "logs": items}


def tunnel_config_status() -> dict:
    try:
        txt = TUNNEL_CONFIG.read_text()
    except OSError as e:
        return {"ok": False, "error": type(e).__name__}
    ok = "hostname: vuelos.metislab.work" in txt and "service: http://127.0.0.1:8790" in txt
    return {"ok": ok, "config": str(TUNNEL_CONFIG)}


def manifest_status() -> dict:
    out = {}
    ok = True
    for name in ("flights.json", "system.json"):
        p = VAULT / "manifest" / name
        try:
            data = json.loads(p.read_text())
            out[name] = {"ok": True, "bytes": p.stat().st_size}
            if name == "flights.json":
                out[name]["flights"] = len(data.get("flights", []))
        except Exception as e:
            ok = False
            out[name] = {"ok": False, "error": type(e).__name__}
    return {"ok": ok, **out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = ap.parse_args()

    local_ok, local = fetch_json("http://127.0.0.1:8790/api/healthz", 8)
    public_ok, public = fetch_json("https://vuelos.metislab.work/api/healthz", 15)
    report = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "services": {label: launch_state(label) for label in LABELS},
        "health": {"local": {"ok": local_ok, "detail": local}, "public": {"ok": public_ok, "detail": public}},
        "stream": range_probe(latest_proxy_url()),
        "jobs": jobs_status(),
        "resources": resource_status(),
        "logs": logs_status(),
        "tunnel_config": tunnel_config_status(),
        "manifests": manifest_status(),
    }
    checks = []
    checks.extend(v.get("ok", False) for v in report["services"].values())
    checks.extend((local_ok, public_ok, report["stream"]["ok"], report["jobs"]["ok"],
                   report["resources"]["ok"], report["logs"]["ok"],
                   report["tunnel_config"]["ok"], report["manifests"]["ok"]))
    report["ok"] = all(checks)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"AeroBrain ops: {'PASS' if report['ok'] else 'FAIL'} · {report['ts']}")
        print(f"  health: local={local_ok} public={public_ok}")
        print(f"  stream: ok={report['stream']['ok']} {report['stream'].get('content_range', report['stream'].get('detail', ''))} cache={report['stream'].get('cache', '')}")
        print(f"  resources: cpu={report['resources'].get('total_cpu')}% rss={report['resources'].get('total_rss_mb')}MB")
        print(f"  jobs: active={len(report['jobs'].get('active', []))} stale={len(report['jobs'].get('stale_running', []))}")
        for label, st in report["services"].items():
            print(f"  {label}: {st.get('state')} pid={st.get('pid')} runs={st.get('runs')} ok={st.get('ok')}")
        if not report["ok"]:
            print(json.dumps(report, indent=2), file=sys.stderr)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
