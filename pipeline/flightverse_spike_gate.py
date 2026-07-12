#!/usr/bin/env python3
"""Gate CDP del spike FLIGHTVERSE (P1, renderer decision).

Corre web/spike_flightverse.html en Chrome headless real (el pane embebido
congela rAF) y extrae window.__spike. Falla si el spike no termina, no marca
ok, o hay errores de consola. Screenshot a qa/ como evidencia.

Uso:  python3 flightverse_spike_gate.py [clip_id] [--timeout 180]
"""
from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.parse

from browser_gate import QA_DIR, launch_chrome, new_page


def run(cid: str, base_url: str, timeout: int, page: str = "spike_flightverse.html",
        gvar: str = "__spike", extra: str = "") -> dict:
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        url = f"{base_url.rstrip('/')}/{page}?m={urllib.parse.quote(cid)}{extra}"
        cdp.send("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        rep = None
        while time.time() < deadline:
            cdp.pump(1.0)
            try:
                rep = cdp.eval(f"window.{gvar} && window.{gvar}.done ? window.{gvar} : null")
            except RuntimeError:
                continue
            if rep:
                break
        if not rep:
            raise RuntimeError(f"spike no terminó en {timeout}s · console={cdp.errors[:4]}")
        QA_DIR.mkdir(parents=True, exist_ok=True)
        shot = cdp.send("Page.captureScreenshot", {"format": "png"})
        out = QA_DIR / f"{cid}-{page.split(chr(46))[0]}.png"
        out.write_bytes(base64.b64decode(shot["data"]))
        rep["screenshot"] = str(out)
        rep["console_errors"] = cdp.errors[:6]
        if cdp.errors:
            rep["ok"] = False
        return rep
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        profile.cleanup()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id", nargs="?", default="DJI_20260704160358_0104_D")
    ap.add_argument("--base-url", default="http://127.0.0.1:8790")
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--page", default="spike_flightverse.html")
    ap.add_argument("--global", dest="gvar", default="__spike")
    ap.add_argument("--extra", default="")
    args = ap.parse_args()
    rep = run(args.clip_id, args.base_url, args.timeout, args.page, args.gvar, args.extra)
    print(json.dumps(rep, indent=1))
    raise SystemExit(0 if rep.get("ok") else 1)


if __name__ == "__main__":
    main()
