"""Load every app page in headless Chrome and fail on any JS exception or console error.

A missing ES module export blanks a page with no server error (Ventas, 2026-10-13).
This gate catches that class of defect before a deploy.

Usage:
  python3 pipeline/page_load_gate.py [--base-url URL] [--viewport desktop|phone]
"""
from __future__ import annotations

import argparse
import json
import sys

import browser_gate as bg

PAGES = [
    "home.html", "index.html", "trips.html", "index.html?v=map",   # map.html only redirects here
    "flight.html", "drone.html",
    "studio.html", "subir.html", "tresd.html", "mundo.html", "splatlab.html",
    "scene-improve.html", "system.html", "guia.html", "ventas.html", "p.html", "share.html",
]
VIEWPORTS = {"desktop": (1440, 900, 1, False), "phone": (430, 932, 3, True)}
SETTLE_S = 3.0


def run(base_url: str, viewport: str = "desktop") -> dict:
    width, height, scale, mobile = VIEWPORTS[viewport]
    proc, profile, port = bg.launch_chrome()
    failures = {}
    try:
        cdp = bg.new_page(port)
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": scale, "mobile": mobile})
        for page in PAGES:
            cdp.errors.clear()
            cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/{page}"})
            cdp.pump(SETTLE_S)
            try:
                empty = cdp.eval("!(document.body && document.body.innerText.trim().length > 20)")
            except RuntimeError:
                empty = False          # navigation in flight: the error list still decides
            if cdp.errors or empty:
                failures[page] = {"errors": cdp.errors[:4], "blank": bool(empty)}
    finally:
        bg.teardown_chrome(proc, profile)
    return {"ok": not failures, "viewport": viewport, "pages": len(PAGES), "failures": failures}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=bg.DEFAULT_BASE_URL)
    ap.add_argument("--viewport", choices=sorted(VIEWPORTS), default="desktop")
    args = ap.parse_args()
    report = run(args.base_url, args.viewport)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
