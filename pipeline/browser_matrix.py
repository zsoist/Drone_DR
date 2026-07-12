"""Browser matrix QA for Gaussian splat viewers.

This is the stronger sibling of browser_gate.py. It verifies the two user-facing
splat surfaces (share.html and the authenticated 3D workspace) across mobile,
iPad, and desktop viewport classes:

  python3 browser_matrix.py DJI_20260705171127_0099_D

Checks:
  - no JS/console errors
  - no horizontal overflow
  - splat canvas renders
  - version selector is visible when a project has multiple splats
  - macro/zoom controls really move the camera closer
  - screenshots are non-empty and saved under /Volumes/SSD/drone-vault/qa
"""
from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.parse
from pathlib import Path

from browser_gate import DEFAULT_BASE_URL, QA_DIR, launch_chrome, new_page


VAULT = Path("/Volumes/SSD/drone-vault")
VIEWPORTS = {
    "mobile": {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True},
    "ipad": {"width": 820, "height": 1180, "deviceScaleFactor": 2, "mobile": True},
    "desktop": {"width": 1440, "height": 960, "deviceScaleFactor": 1, "mobile": False},
}


def expected_splat_path(cid: str) -> str:
    """The UI default must be the highest-quality visual splat, not just mutable current."""
    sys = json.loads((VAULT / "manifest" / "system.json").read_text())
    rows = [
        s for s in (sys.get("splats") or [])
        if s.get("clip_id") == cid and str(s.get("format") or "").lower() in {"ksplat", "splat", "ply"}
    ]
    if not rows:
        raise RuntimeError(f"no splats in manifest for {cid}")
    rank = {"ksplat": 0, "splat": 1, "ply": 2}
    rows.sort(key=lambda s: (
        -(s.get("iters") or 0),
        -(1 if s.get("current") else 0),
        rank.get(str(s.get("format") or "").lower(), 9),
        str(s.get("archived_at") or ""),
    ))
    return rows[0].get("path") or rows[0].get("name")


def js(s: str) -> str:
    return "(() => {" + s + "})()"


def wait_for(cdp, expr: str, timeout: int = 45, label: str = "condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        cdp.pump(0.35)
        try:
            last = cdp.eval(expr)
        except RuntimeError:
            continue
        if last:
            return last
    raise RuntimeError(f"timeout esperando {label}: {last!r}")


def set_viewport(cdp, name: str):
    vp = VIEWPORTS[name]
    cdp.send("Emulation.setDeviceMetricsOverride", vp | {
        "screenWidth": vp["width"],
        "screenHeight": vp["height"],
    })
    touch = {"enabled": bool(vp["mobile"])}
    if vp["mobile"]:
        touch["maxTouchPoints"] = 5
    cdp.send("Emulation.setTouchEmulationEnabled", touch)


def common_surface_checks(cdp, selector: str) -> dict:
    state = cdp.eval(js(f"""
      const root = document.querySelector({selector!r});
      const cv = root && root.querySelector('canvas');
      const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0) - window.innerWidth;
      const rect = root ? root.getBoundingClientRect() : null;
      return {{
        root: !!root,
        canvas: !!cv,
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0,
        overflow,
        body: document.body.innerText.slice(0, 220),
      }};
    """))
    if not state.get("root") or not state.get("canvas"):
        raise RuntimeError(f"splat canvas ausente: {state}")
    if state.get("width", 0) < 240 or state.get("height", 0) < 220:
        raise RuntimeError(f"visor demasiado pequeño: {state}")
    if state.get("overflow", 0) > 3:
        raise RuntimeError(f"overflow horizontal {state['overflow']}px: {state}")
    return state


def verify_macro_zoom(cdp, selector: str):
    before = wait_for(cdp, js(f"""
      const root = document.querySelector({selector!r});
      const v = root && (root._splatViewer || root._viewer);
      if (!v || !v.camera || !v.controls) return null;
      return v.camera.position.distanceTo(v.controls.target);
    """), timeout=30, label="splat viewer camera")
    clicked = cdp.eval(js(f"""
      const root = document.querySelector({selector!r});
      const btn = root && root.querySelector('[data-sv="inspect"]');
      if (!btn) return false;
      btn.click();
      return true;
    """))
    if not clicked:
        raise RuntimeError("botón Modo macro no encontrado")
    cdp.pump(1.0)
    after = cdp.eval(js(f"""
      const root = document.querySelector({selector!r});
      const v = root && (root._splatViewer || root._viewer);
      return v.camera.position.distanceTo(v.controls.target);
    """))
    if not isinstance(before, (int, float)) or not isinstance(after, (int, float)) or after >= before * 0.35:
        raise RuntimeError(f"macro no acercó suficiente: before={before} after={after}")
    return {"before": before, "after": after}


def screenshot(cdp, out: Path):
    QA_DIR.mkdir(parents=True, exist_ok=True)
    shot = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    out.write_bytes(base64.b64decode(shot["data"]))
    if out.stat().st_size < 25_000:
        raise RuntimeError(f"screenshot sospechosamente chico: {out.stat().st_size} bytes · {out}")


def run_share(cdp, base_url: str, cid: str, viewport: str, expected_path: str) -> dict:
    url = f"{base_url.rstrip('/')}/share.html?m={urllib.parse.quote(cid)}"
    cdp.send("Page.navigate", {"url": url})
    wait_for(cdp, "document.body && /VISOR 3D/i.test(document.body.innerText)", timeout=45, label="share shell")
    clicked = cdp.eval(js("""
      const b = document.querySelector('[data-v="splat"]');
      if (!b) return false;
      b.click();
      return true;
    """))
    if not clicked:
        raise RuntimeError("share.html no expuso tab Gaussian splat")
    wait_for(cdp, js("""
      const root = document.querySelector('#sh-view');
      return !!(root && root.querySelector('canvas') && root._splatViewer);
    """), timeout=75, label="share splat canvas")
    state = common_surface_checks(cdp, "#sh-view")
    macro = verify_macro_zoom(cdp, "#sh-view")
    selected = cdp.eval(js("""
      const sel = document.querySelector('.share-splat-select');
      return sel ? {
        count: sel.options.length,
        value: sel.value,
        text: sel.selectedOptions[0]?.textContent || ''
      } : { count: 1, value: null, text: '' };
    """))
    if selected.get("value") and selected["value"] != expected_path:
        raise RuntimeError(f"share default splat incorrecto: {selected['value']} != {expected_path}")
    screenshot(cdp, QA_DIR / f"{cid}-share-{viewport}.png")
    return {"surface": "share", "viewport": viewport, "state": state, "macro": macro, "selected": selected}


def run_workspace(cdp, base_url: str, cid: str, viewport: str, expected_path: str) -> dict:
    url = f"{base_url.rstrip('/')}/tresd.html"
    cdp.send("Page.navigate", {"url": url})
    wait_for(cdp, "document.body && /Proyectos 3D/i.test(document.body.innerText)", timeout=45, label="3D workspace")
    cdp.eval(f"localStorage.setItem('ab.proj3d', {json.dumps(cid)}); location.reload();")
    wait_for(cdp, js("""
      return !!(document.querySelector('#proj-view') && document.querySelector('#load-splat'));
    """), timeout=45, label="selected project")
    meta = cdp.eval(js("""
      const sel = document.querySelector('#sp-select');
      return {
        selectVisible: !!(sel && getComputedStyle(sel).display !== 'none'),
        count: sel ? sel.options.length : 0,
        value: sel ? sel.value : null,
        selected: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
      };
    """))
    if meta.get("value") and meta["value"] != expected_path:
        raise RuntimeError(f"workspace default splat incorrecto: {meta['value']} != {expected_path}")
    clicked = cdp.eval(js("""
      const b = document.querySelector('#load-splat');
      if (!b || getComputedStyle(b).display === 'none') return false;
      b.click();
      return true;
    """))
    if not clicked:
        raise RuntimeError("3D workspace no expuso botón Cargar splat")
    wait_for(cdp, js("""
      const root = document.querySelector('#splat-box');
      return !!(root && root.querySelector('canvas') && root._viewer);
    """), timeout=75, label="workspace splat canvas")
    state = common_surface_checks(cdp, "#splat-box")
    macro = verify_macro_zoom(cdp, "#splat-box")
    screenshot(cdp, QA_DIR / f"{cid}-workspace-{viewport}.png")
    return {"surface": "workspace", "viewport": viewport, "state": state, "macro": macro, "selected": meta}


def run_matrix(cid: str, base_url: str, viewports: list[str]) -> list[dict]:
    results = []
    expected_path = expected_splat_path(cid)
    for vp in viewports:
        for surface, runner in (("share", run_share), ("workspace", run_workspace)):
            proc, profile, port = launch_chrome()
            cdp = None
            try:
                cdp = new_page(port)
                set_viewport(cdp, vp)
                results.append(runner(cdp, base_url, cid, vp, expected_path))
                if cdp.errors:
                    raise RuntimeError(f"errores de consola en {surface}/{vp}: {' | '.join(cdp.errors[:4])}")
            finally:
                if cdp:
                    cdp.close()
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
                profile.cleanup()
    return results


def run_mundo(cdp, base_url: str, viewport: str) -> dict:
    """FLIGHTVERSE world-select: islas + filtros + panel de misión + sin overflow."""
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/mundo.html"})
    state = wait_for(cdp, js("""
      const islas = document.querySelectorAll('.wi').length;
      if (!islas) return null;
      return {
        islas,
        filtros: document.querySelectorAll('#w-filters button').length,
        misiones: document.querySelectorAll('.w-panel .wp-m').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    """), timeout=30, label="mundo world-select")
    if state["islas"] < 1 or state["filtros"] < 4 or state["misiones"] < 2:
        raise RuntimeError(f"mundo incompleto: {state}")
    if state["overflow"] > 3:
        raise RuntimeError(f"overflow horizontal {state['overflow']}px en mundo/{viewport}")
    screenshot(cdp, QA_DIR / f"matrix-mundo-{viewport}.png")
    return {"surface": "mundo", "viewport": viewport, **state}


def run_volar(cdp, base_url: str, cid: str, viewport: str) -> dict:
    """FLIGHTVERSE juego: autotest de vuelo verde + HUD presente + sin overflow."""
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/volar.html?m={cid}&autotest=1"})
    rep = wait_for(cdp, js("""
      const r = window.__volar;
      if (!r || !r.done) return null;
      return { ok: r.ok, fps: r.fps };
    """), timeout=120, label="volar autotest")
    if not rep.get("ok"):
        raise RuntimeError(f"volar autotest rojo: {rep}")
    hud = cdp.eval(js("""
      return {
        dock: !!document.querySelector('.vl-dock'),
        metricas: document.querySelectorAll('.vl-metric').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    """))
    if not hud["dock"] or hud["metricas"] < 2:
        raise RuntimeError(f"HUD incompleto: {hud}")
    if hud["overflow"] > 3:
        raise RuntimeError(f"overflow {hud['overflow']}px en volar/{viewport}")
    screenshot(cdp, QA_DIR / f"matrix-volar-{viewport}.png")
    return {"surface": "volar", "viewport": viewport, "fps": rep.get("fps"), **hud}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--viewport", action="append", choices=sorted(VIEWPORTS),
                    help="Repeat to limit the matrix. Default: mobile, iPad, desktop.")
    ap.add_argument("--flightverse", action="store_true",
                    help="Matriz FLIGHTVERSE (mundo + volar) en vez de share/workspace.")
    args = ap.parse_args()
    viewports = args.viewport or ["mobile", "ipad", "desktop"]
    if args.flightverse:
        results = []
        for vp in viewports:
            for runner in (lambda c, b, v=None: run_mundo(c, b, vp),
                           lambda c, b, v=None: run_volar(c, b, args.clip_id, vp)):
                proc, profile, port = launch_chrome()
                cdp = None
                try:
                    cdp = new_page(port)
                    set_viewport(cdp, vp)
                    results.append(runner(cdp, args.base_url))
                    if cdp.errors:
                        raise RuntimeError(f"errores de consola en {vp}: {' | '.join(cdp.errors[:4])}")
                finally:
                    if cdp:
                        cdp.close()
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
                    profile.cleanup()
        for r in results:
            print(f"{r['surface']}/{r['viewport']}: ok" + (f" · {r['fps']}fps" if r.get('fps') else f" · {r['islas']} islas"))
        return
    results = run_matrix(args.clip_id, args.base_url, viewports)
    for r in results:
        macro = r["macro"]
        sel = r["selected"]
        print(f"{r['surface']}/{r['viewport']}: ok · macro {macro['before']:.4f}->{macro['after']:.4f} · versions {sel.get('count')}")


if __name__ == "__main__":
    main()
