#!/usr/bin/env python3
"""Browser regression gate for the Home light theme and balanced module grid."""
from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

from browser_gate import launch_chrome, new_page


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
QA_DIR = Path("/Volumes/SSD/drone-vault/qa")


def inspect(cdp, width: int, height: int) -> dict:
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": width < 640,
    })
    cdp.send("Page.navigate", {"url": f"{BASE}/home.html?browser-home-light={width}"})
    deadline = time.time() + 20
    while time.time() < deadline:
        cdp.pump(0.2)
        if cdp.eval("document.readyState === 'complete' && Boolean(document.querySelector('.hv2-card'))"):
            break
    else:
        raise RuntimeError(f"Home cards did not load at {width}x{height}")

    cdp.eval("localStorage.setItem('ab_theme', 'light'); location.reload()")
    deadline = time.time() + 20
    while time.time() < deadline:
        cdp.pump(0.2)
        if cdp.eval("document.documentElement.dataset.theme === 'light' && document.querySelectorAll('.hv2-card').length === 9"):
            break
    else:
        raise RuntimeError(f"Home light theme did not become ready at {width}x{height}")
    cdp.pump(1)

    state = cdp.eval(
        """(() => {
          const rect = element => {
            const r = element.getBoundingClientRect();
            return {left:r.left, right:r.right, top:r.top, bottom:r.bottom,
                    width:r.width, height:r.height};
          };
          const rgb = element => (getComputedStyle(element).color.match(/[\\d.]+/g) || [])
            .slice(0, 3).map(Number);
          const background = element => (getComputedStyle(element).backgroundColor.match(/[\\d.]+/g) || [])
            .slice(0, 3).map(Number);
          const luminance = values => {
            const linear = values.map(value => {
              const channel = value / 255;
              return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            });
            return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
          };
          const contrast = (a, b) => {
            const bright = Math.max(luminance(a), luminance(b));
            const dark = Math.min(luminance(a), luminance(b));
            return (bright + .05) / (dark + .05);
          };
          const cards = [...document.querySelectorAll('.hv2-card')];
          const grid = document.querySelector('.hv2-grid');
          const latest = document.querySelector('.hv2-latest');
          const lower = document.querySelector('.hv2-lower');
          const lowerBg = background(latest);
          const lowerText = rgb(latest.querySelector('strong'));
          const firstLastRow = cards.at(-2).getBoundingClientRect();
          const lastLastRow = cards.at(-1).getBoundingClientRect();
          const gridRect = grid.getBoundingClientRect();
          return {
            theme: document.documentElement.dataset.theme,
            cardCount: cards.length,
            cardTitle: rgb(cards[0].querySelector('strong')),
            heroTitle: rgb(document.querySelector('.hv2-hero h1')),
            sectionTitle: rgb(document.querySelector('.hv2-section-head h2')),
            lowerBackground: lowerBg,
            lowerText,
            lowerContrast: contrast(lowerBg, lowerText),
            firstCard: rect(cards[0]),
            lastRowCoverage: (lastLastRow.right - firstLastRow.left) / gridRect.width,
            lastRowSameLine: Math.abs(firstLastRow.top - lastLastRow.top),
            grid: rect(grid),
            lower: rect(lower),
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        })()"""
    )

    QA_DIR.mkdir(parents=True, exist_ok=True)
    shot = cdp.send("Page.captureScreenshot", {
        "format": "png",
        "captureBeyondViewport": False,
    })
    out = QA_DIR / f"home-light-{width}x{height}.png"
    out.write_bytes(base64.b64decode(shot["data"]))
    state["screenshot"] = str(out)
    return state


proc, profile, port = launch_chrome()
cdp = new_page(port)
try:
    wide = inspect(cdp, 2048, 1218)
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

states = {"wide": wide, "desktop": desktop, "mobile": mobile}
for name, state in states.items():
    if state["theme"] != "light" or state["cardCount"] != 9:
        raise RuntimeError(f"{name}: Home light content is incomplete: {state}")
    if state["overflow"] > 0:
        raise RuntimeError(f"{name}: Home light theme overflows horizontally: {state}")
    if min(state["cardTitle"]) < 225:
        raise RuntimeError(f"{name}: photo-card title is not readable in light mode: {state}")
    if min(state["heroTitle"]) < 225:
        raise RuntimeError(f"{name}: hero title is not readable in light mode: {state}")
    if max(state["sectionTitle"]) > 90:
        raise RuntimeError(f"{name}: section title is not dark on the light canvas: {state}")
    if state["lowerContrast"] < 4.5:
        raise RuntimeError(f"{name}: lower card text lacks WCAG AA contrast: {state}")
    if state["lower"]["top"] - state["grid"]["bottom"] > 24:
        raise RuntimeError(f"{name}: dead vertical space remains below the module grid: {state}")

if wide["firstCard"]["height"] > 460:
    raise RuntimeError(f"wide: viewport-relative rows still create giant cards: {wide}")
if wide["lastRowSameLine"] > 1 or wide["lastRowCoverage"] < .98:
    raise RuntimeError(f"wide: final module row still leaves dead horizontal space: {wide}")

print(json.dumps({"ok": True, **states, "errors": errors}, indent=2))
