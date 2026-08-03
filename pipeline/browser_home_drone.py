#!/usr/bin/env python3
"""Browser regression gate for the centered, compositor-safe Home drone."""
import json
import sys
import time

from browser_gate import launch_chrome, new_page


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"


def inspect(cdp, width, height):
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": width < 640,
    })
    cdp.send("Page.navigate", {"url": f"{BASE}/home.html?browser-home-drone={width}"})
    deadline = time.time() + 20
    while time.time() < deadline:
        cdp.pump(0.2)
        if cdp.eval("Boolean(document.querySelector('#home-drone-stage canvas'))"):
            break
    else:
        raise RuntimeError(f"Home drone canvas did not load at {width}x{height}")
    return cdp.eval(
        """(() => {
          const hero = document.querySelector('.hv2-hero').getBoundingClientRect();
          const stage = document.querySelector('#home-drone-stage').getBoundingClientRect();
          const canvas = document.querySelector('#home-drone-stage canvas');
          const frame = canvas.getBoundingClientRect();
          return {
            heroCenterX: hero.left + hero.width / 2,
            stageCenterX: stage.left + stage.width / 2,
            stageCenterY: stage.top + stage.height / 2,
            canvasCenterX: frame.left + frame.width / 2,
            canvasCenterY: frame.top + frame.height / 2,
            filter: getComputedStyle(canvas).filter,
            overflow: document.documentElement.scrollWidth - innerWidth,
            ready: document.querySelector('#home-drone-stage').classList.contains('is-3d'),
          };
        })()"""
    )


proc, profile, port = launch_chrome()
cdp = new_page(port)
try:
    desktop = inspect(cdp, 1024, 609)
    mobile = inspect(cdp, 390, 844)
    errors = list(cdp.errors)
finally:
    cdp.close()
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    profile.cleanup()

if desktop["filter"] != "none" or mobile["filter"] != "none":
    raise RuntimeError(f"WebGL canvas still uses a compositor filter: {desktop}, {mobile}")
if not desktop["ready"] or not mobile["ready"]:
    raise RuntimeError(f"Home drone did not become ready: {desktop}, {mobile}")
if errors:
    raise RuntimeError(f"Home drone browser errors: {errors}")
if desktop["overflow"] > 0 or mobile["overflow"] > 0:
    raise RuntimeError(f"Home drone introduced horizontal overflow: {desktop}, {mobile}")
if abs(desktop["stageCenterX"] - desktop["canvasCenterX"]) > 0.5:
    raise RuntimeError(f"Desktop drone canvas is not centered in its stage: {desktop}")
if abs(desktop["stageCenterY"] - desktop["canvasCenterY"]) > 0.5:
    raise RuntimeError(f"Desktop drone canvas is not centered vertically: {desktop}")
if abs(mobile["heroCenterX"] - mobile["stageCenterX"]) > 1:
    raise RuntimeError(f"Mobile drone stage is clipped off-center: {mobile}")

print(json.dumps({"ok": True, "desktop": desktop, "mobile": mobile}, indent=2))
