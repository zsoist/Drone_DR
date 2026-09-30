"""Auditoría de layout del HUD v2 (?fv=2) en Chrome real (CDP vía browser_gate).

Comprueba, por viewport (430x932 táctil, 932x430 apaisado con notch, 1440x900) y escena (vuelo FPV, cámara
cercana, pausa, selector de modo):
  * ningún texto de HUD < 12 px,
  * ningún elemento interactivo/placa a < 96 px del centro (solo la retícula, que va en canvas),
  * nada recortado horizontalmente,
  * botones y hojas dentro del viewport (sin desbordes en 430 px).
Uso: python3 pipeline/fv2_layout_audit.py [--base http://localhost:8790] [--cid recon_...]
Sale con código != 0 si hay incumplimientos. test_fv2_hud_contract.py lo ejecuta si el servidor responde."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_gate as bg  # noqa: E402
import browser_matrix as bm  # noqa: E402

VIEWPORTS = {
    "phone_portrait": dict(width=430, height=932, dsf=3, mobile=True, insets=dict(top=47, bottom=34, left=0, right=0)),
    "phone_landscape": dict(width=932, height=430, dsf=3, mobile=True, insets=dict(top=0, bottom=21, left=47, right=47)),
    "desktop": dict(width=1440, height=900, dsf=1, mobile=False, insets=None),
}
DEFAULT_CID = "recon_4e4245a1f4_aoi130"
AUDIT_JS = r"""
(() => {
  const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, Z = 96;
  const out = { small: [], centre: [], clipped: [], overflow: [] };
  const root = document.getElementById('vl-hud');
  const shown = el => { for (let p = el; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || p.hidden) return false; } return true; };
  const inSheet = el => !!el.closest('.hx-sheet,.hx-start,.vl-boot,.hx-director');
  for (const el of root.querySelectorAll('*')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const label = el.id || String(el.className).split(' ')[0] || el.tagName;
    if (own && parseFloat(getComputedStyle(el).fontSize) < 12) out.small.push([label, parseFloat(getComputedStyle(el).fontSize)]);
    if (r.left < -1 || r.right > W + 1) out.clipped.push([label, Math.round(r.left), Math.round(r.right)]);
    const chrome = el.matches('.hx-plate,.hx-chip,.hx-ibtn,.hx-fire,.hx-wchip,.hx-read,.hx-gauge,.hx-minimap,.hx-banner,.hx-warn,.hx-gimbal,.hx-slot,.hx-heat,.hx-coach,.hx-count,.hx-compass,.hx-toast,.hx-tape');
    if (chrome && !inSheet(el) && !el.matches('.hx-tape') && r.left < cx + Z && r.right > cx - Z && r.top < cy + Z && r.bottom > cy - Z) out.centre.push([label, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
    if (inSheet(el) && el.matches('button,a,.hx-btn,.hx-row') && (r.right > W + 1 || r.left < -1)) out.overflow.push([label, Math.round(r.left), Math.round(r.right)]);
  }
  return JSON.stringify(out);
})()
"""


def _session(port: int, name: str):
    v = VIEWPORTS[name]
    c = bg.new_page(port)
    c.send("Network.enable")
    c.send("Network.setExtraHTTPHeaders", {"headers": {"Accept-Encoding": "identity"}})
    land = v["width"] > v["height"]
    c.send("Emulation.setDeviceMetricsOverride", dict(
        width=v["width"], height=v["height"], deviceScaleFactor=v["dsf"], mobile=v["mobile"],
        screenWidth=v["width"], screenHeight=v["height"],
        screenOrientation=dict(type="landscapePrimary" if land else "portraitPrimary", angle=90 if land else 0)))
    if v["mobile"]:
        c.send("Emulation.setTouchEmulationEnabled", dict(enabled=True, maxTouchPoints=5))
    if v["insets"]:
        try:
            c.send("Emulation.setSafeAreaInsetsOverride", dict(insets=v["insets"]))
        except RuntimeError:
            pass
    c.send("Page.addScriptToEvaluateOnNewDocument", dict(source="localStorage.setItem('ab_fv_onboarded','1')"))
    return c


def audit(base: str, cid: str) -> dict[str, list]:
    failures: dict[str, list] = {}
    proc, prof, port = bg.launch_chrome()
    try:
        for name in VIEWPORTS:
            scenes = {
                "fpv": "&autotest=1&qa=1&fv=2&nostart=1",
                "chase": "&autotest=1&qa=1&fv=2&nostart=1&rig=cerca",
                "pause": "&qa=1&fv=2&nostart=1",
                "modes": "&qa=1&fv=2&nostart=1",
            }
            for scene, q in scenes.items():
                c = _session(port, name)
                try:
                    c.send("Page.navigate", dict(url=f"{base}/volar.html?m={cid}{q}"))
                    bm.wait_for(c, "window.__volar && window.__volar.ready ? true : null", timeout=90, label="ready")
                    c.pump(5 if scene in ("fpv", "chase") else 2.5)
                    if scene == "pause":
                        c.eval("document.getElementById('hx-pause').click()")
                        c.pump(0.8)
                    elif scene == "modes":
                        c.eval("window.__volar.ctx.ui.menu.openModes()")
                        c.pump(0.8)
                    res = json.loads(c.eval(AUDIT_JS))
                    for kind, rows in res.items():
                        if rows:
                            failures.setdefault(f"{name}/{scene}/{kind}", []).extend(rows)
                    if c.errors and any("volar" in e.lower() or "TypeError" in e for e in c.errors):
                        failures.setdefault(f"{name}/{scene}/console", []).extend(c.errors[:3])
                finally:
                    c.close()
    finally:
        bg.teardown_chrome(proc, prof)
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8790")
    ap.add_argument("--cid", default=DEFAULT_CID)
    a = ap.parse_args()
    fails = audit(a.base, a.cid)
    if fails:
        print(json.dumps(fails, indent=1, ensure_ascii=False))
        return 1
    print("fv2 layout audit: ok")
    return 0


def server_up(base: str = "http://localhost:8790") -> bool:
    try:
        with urllib.request.urlopen(base + "/volar.html", timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


if __name__ == "__main__":
    sys.exit(main())
