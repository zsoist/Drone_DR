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
        if s.get("clip_id") == cid and str(s.get("format") or "").lower() in {"sog", "spz", "ksplat", "splat", "ply"}
    ]
    if not rows:
        raise RuntimeError(f"no splats in manifest for {cid}")
    rank = {"sog": 0, "spz": 1, "ksplat": 2, "splat": 3, "ply": 4}
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


def run_jobs(cdp, base_url: str, cid: str, viewport: str, _expected_path: str) -> dict:
    """Operational console: truthful quality, responsive layout and real full-log drawer."""
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/tresd.html"})
    wait_for(cdp, "document.body && /Proyectos 3D/i.test(document.body.innerText)",
             timeout=45, label="3D jobs shell")
    clicked = cdp.eval(js("""
      const tab = document.querySelector('[data-tab="jobs"]');
      if (!tab) return false;
      tab.click(); return true;
    """))
    if not clicked:
        raise RuntimeError("tab Trabajos ausente")
    state = wait_for(cdp, js(f"""
      const cards = [...document.querySelectorAll('#jobs3d .job-card')];
      const splats = cards.filter(x => x.dataset.kind === 'splat' && x.innerText.includes({cid!r}));
      const splat = splats[0];
      if (!splat) return null;
      const fallback = splats.find(x => /listo con fallback/i.test(x.innerText));
      const consoleRect = document.querySelector('#jobs3d').getBoundingClientRect();
      const cardRect = splat.getBoundingClientRect();
      const statusRect = splat.querySelector('.jc-status')?.getBoundingClientRect();
      const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0) - window.innerWidth;
      return {{
        cards: cards.length,
        summaries: document.querySelectorAll('#job-summary button').length,
        typeFilters: document.querySelectorAll('[data-job-kind]').length,
        text: splat.innerText,
        historyText: splats.map(x => x.innerText).join('\n---\n'),
        jid: splat.dataset.jid,
        logJid: (fallback || splat).dataset.jid,
        fallbackJid: fallback?.dataset.jid || '',
        consoleWidth: consoleRect.width,
        cardWidth: cardRect.width,
        statusVisible: !!statusRect && statusRect.left >= cardRect.left - 1 && statusRect.right <= cardRect.right + 1,
        cardInternalOverflow: splat.scrollWidth - splat.clientWidth,
        overflow,
      }};
    """), timeout=45, label="jobs console cards")
    if state["summaries"] < 4 or state["typeFilters"] < 4 or state["cards"] < 1:
        raise RuntimeError(f"consola de trabajos incompleta: {state}")
    for truth in ("Ultra", "15k iteraciones", "NVIDIA CUDA", "Listo", "238 cámaras"):
        if truth.lower() not in state["text"].lower():
            raise RuntimeError(f"último trabajo splat no muestra {truth!r}: {state['text'][:500]}")
    for truth in ("Medium", "Listo con fallback"):
        if truth.lower() not in state["historyText"].lower():
            raise RuntimeError(f"historial splat no muestra {truth!r}: {state['historyText'][:700]}")
    if state["overflow"] > 3:
        raise RuntimeError(f"overflow horizontal {state['overflow']}px en jobs/{viewport}")
    if state["cardWidth"] < state["consoleWidth"] - 3:
        raise RuntimeError(f"tarjeta no ocupa la consola en jobs/{viewport}: {state}")
    if not state["statusVisible"] or state["cardInternalOverflow"] > 3:
        raise RuntimeError(f"tarjeta recorta estado/contenido en jobs/{viewport}: {state}")
    cdp.pump(0.6)  # let the tab transition finish before composited screenshot capture
    screenshot(cdp, QA_DIR / f"{cid}-jobs-{viewport}.png")
    opened = cdp.eval(js(f"""
      const card = document.querySelector('[data-jid="{state['logJid']}"]');
      const button = card && card.querySelector('[data-job-log]');
      if (!button) return false;
      button.click(); return true;
    """))
    if not opened:
        raise RuntimeError("botón Logs completos ausente")
    drawer = wait_for(cdp, js("""
      const d = document.querySelector('#job-log-drawer');
      if (!d || !d.querySelector('.jl-pre')) return null;
      const r = d.getBoundingClientRect();
      return { text: d.innerText, width: r.width, right: r.right,
        viewport: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth };
    """), timeout=30, label="full log drawer")
    if state["fallbackJid"]:
        for contract in ("splat_attempt_failed", "Ultra -d 2", "Cinematic -d 2", "Medium -d 2"):
            if contract.lower() not in drawer["text"].lower():
                raise RuntimeError(f"drawer no muestra historial {contract!r}")
    if drawer["right"] > drawer["viewport"] + 3 or drawer["width"] > drawer["viewport"] + 3 or drawer["overflow"] > 3:
        raise RuntimeError(f"drawer fuera de viewport en {viewport}: {drawer}")
    cdp.pump(0.3)
    screenshot(cdp, QA_DIR / f"{cid}-jobs-log-{viewport}.png")
    return {"surface": "jobs", "viewport": viewport, "state": state,
            "drawer": {"width": drawer["width"], "viewport": drawer["viewport"]},
            "selected": {"count": 1}, "macro": {"before": 0.0, "after": 0.0}}


def run_matrix(cid: str, base_url: str, viewports: list[str], surfaces: list[str] | None = None) -> list[dict]:
    results = []
    expected_path = expected_splat_path(cid)
    runners = {"share": run_share, "workspace": run_workspace, "jobs": run_jobs}
    for vp in viewports:
        for surface in surfaces or ["share", "workspace", "jobs"]:
            runner = runners[surface]
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
    """FLIGHTVERSE: flight test plus measured touch-HUD collision checks."""
    cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/volar.html?m={cid}&autotest=1&rig=3"})
    rep = wait_for(cdp, js("""
      const r = window.__volar;
      if (!r || !r.done) return null;
      return { ok: r.ok, fps: r.fps };
    """), timeout=120, label="volar autotest")
    if not rep.get("ok"):
        raise RuntimeError(f"volar autotest rojo: {rep}")
    visual = wait_for(cdp, js("""
      const r = window.__volar;
      if (!r) return null;
      if (r.errors?.some(e => e.startsWith('malla visual:'))) return { error:r.errors };
      return r.visualMesh ? { loaded:true, orthoFull:!!r.orthoFull } : null;
    """), timeout=75, label="malla fotogramétrica visual")
    if not visual.get("loaded"):
        raise RuntimeError(f"malla visual ausente: {visual}")
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
    if VIEWPORTS[viewport]["mobile"]:
        layout = cdp.eval(js("""
          const visible = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length;
          const rect = el => {
            const r = el.getBoundingClientRect();
            return { left:r.left, top:r.top, right:r.right, bottom:r.bottom,
                     width:r.width, height:r.height };
          };
          const hit = (a,b) => a.left < b.right - 1 && a.right > b.left + 1 &&
                               a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const left = document.querySelector('.vl-stick.left');
          const right = document.querySelector('.vl-stick.right');
          const radar = document.querySelector('#vl-minimap');
          const menuFab = document.querySelector('#vl-fab');
          const combatFab = document.querySelector('#vl-combat-fab');
          const fpv = document.querySelector('#vl-fpv');
          const fpvHiddenGeneral = ['.vl-corner.tl','.vl-corner.tr','.vl-center-top',
            '.vl-compass','.vl-flight-status','#vl-goto']
            .every(s => !visible(document.querySelector(s)));
          if (![left,right,radar,menuFab,combatFab].every(visible)) {
            return { error:'faltan controles táctiles agrupados' };
          }
          const fixed = [radar,menuFab,combatFab].map(el => [el.id, rect(el)]);
          const sticks = [['stick-left',rect(left)],['stick-right',rect(right)]];
          const closedCollisions = [];
          for (const [an,a] of fixed) for (const [bn,b] of sticks)
            if (hit(a,b)) closedCollisions.push(`${an}:${bn}`);

          menuFab.click();
          const menu = document.querySelector('#vl-dock');
          const menuRect = visible(menu) ? rect(menu) : null;
          const menuButtons = menu ? [...menu.querySelectorAll('button')].filter(visible) : [];
          const smallMenuTargets = menuButtons.filter(b => {
            const r = rect(b); return r.width < 44 || r.height < 44;
          }).map(b => b.id || b.textContent.trim());
          const menuHorizontalOverflow = menu ? menu.scrollWidth - menu.clientWidth : 999;
          const menuStickCollisions = menuRect
            ? sticks.filter(([,s]) => hit(menuRect,s)).map(([n]) => n) : ['menu-ausente'];
          document.querySelector('#vl-mode')?.click();
          const menuPersistent = visible(menu);
          document.querySelector('#vl-dock-close')?.click();

          combatFab.click();
          const combat = document.querySelector('#vl-combat');
          const combatRect = visible(combat) ? rect(combat) : null;
          const combatButtons = combat ? [...combat.querySelectorAll('button')].filter(visible) : [];
          const smallCombatTargets = combatButtons.filter(b => {
            const r = rect(b); return r.width < 44 || r.height < 44;
          }).map(b => b.id || b.textContent.trim());
          const combatStickCollisions = combatRect
            ? sticks.filter(([,s]) => hit(combatRect,s)).map(([n]) => n) : ['combate-ausente'];
          document.querySelector('#vl-combat-close')?.click();
          menuFab.click();
          document.querySelector('#vl-ajustes')?.click();
          const grade = document.querySelector('#vl-grade');
          const imageOnly = visible(grade) && !visible(menu) && !visible(combat);
          menuFab.click();
          const menuOnly = visible(menu) && !visible(grade) && !visible(combat);
          combatFab.click();
          const combatOnly = visible(combat) && !visible(grade) && !visible(menu);
          document.querySelector('#vl-combat-close')?.click();
          return { closedCollisions, menuStickCollisions, combatStickCollisions,
                   smallMenuTargets, smallCombatTargets, menuHorizontalOverflow,
                   menuActions:menuButtons.length, combatActions:combatButtons.length,
                   exclusivePanels:imageOnly && menuOnly && combatOnly,
                   menuPersistent,
                   fpvActive:visible(fpv) && document.querySelector('#vl-hud').classList.contains('fpv-active'),
                   fpvHiddenGeneral };
        """))
        failures = []
        for key in ("closedCollisions", "menuStickCollisions", "combatStickCollisions",
                    "smallMenuTargets", "smallCombatTargets"):
            if layout.get(key):
                failures.append(f"{key}={layout[key]}")
        if layout.get("error"):
            failures.append(layout["error"])
        if layout.get("menuHorizontalOverflow", 999) > 2:
            failures.append(f"menuOverflow={layout.get('menuHorizontalOverflow', 'ausente')}")
        if layout.get("menuActions", 0) < 10 or layout.get("combatActions", 0) < 6:
            failures.append(f"acciones incompletas={layout}")
        if not layout.get("exclusivePanels"):
            failures.append(f"paneles simultáneos={layout}")
        if not layout.get("menuPersistent"):
            failures.append("el menú se cerró al cambiar un ajuste")
        if not layout.get("fpvActive") or not layout.get("fpvHiddenGeneral"):
            failures.append(f"HUD FPV duplicado={layout}")
        if failures:
            raise RuntimeError("HUD táctil inválido: " + "; ".join(failures))

        # Combate real: un pointer de navegador debe reducir munición, no basta
        # con que el botón exista o cambie de color.
        fire = cdp.eval(js("""
          document.querySelector('#vl-combat-fab')?.click();
          document.querySelector('#vl-weps [data-w="m"]')?.click();
          const b = document.querySelector('#vl-fire');
          const r = b.getBoundingClientRect();
          return { x:r.left+r.width/2, y:r.top+r.height/2,
            before:window.__volar.weaponState.ammo.m,
            fired:window.__volar.weapons.fired };
        """))
        cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": fire["x"], "y": fire["y"],
                  "button": "left", "buttons": 1, "clickCount": 1})
        cdp.pump(0.08)
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": fire["x"], "y": fire["y"],
                  "button": "left", "buttons": 0, "clickCount": 1})
        cdp.pump(0.2)
        shot = cdp.eval(js("""
          return { after:window.__volar.weaponState.ammo.m,
            fired:window.__volar.weapons.fired };
        """))
        if not (shot["after"] < fire["before"] and shot["fired"] > fire["fired"]):
            raise RuntimeError(f"DISPARAR no consumió munición: before={fire} after={shot}")
        cdp.eval("document.querySelector('#vl-combat-close')?.click()")

        # El inspector debe dejar la escena visible y poder moverse dentro del
        # visual viewport con un gesto real.
        cdp.eval(js("""
          document.querySelector('#vl-fab')?.click();
          document.querySelector('#vl-ajustes')?.click();
          return true;
        """))
        cdp.pump(0.2)
        drag = cdp.eval(js("""
          const p=document.querySelector('#vl-grade'), h=p.querySelector('.vl-grade-drag');
          const pr=p.getBoundingClientRect(), hr=h.getBoundingClientRect();
          return { x:hr.left+hr.width*.35, y:hr.top+hr.height/2,
            left:pr.left, top:pr.top, height:pr.height, viewport:innerHeight };
        """))
        cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": drag["x"], "y": drag["y"],
                  "button": "left", "buttons": 1, "clickCount": 1})
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": drag["x"] + 42,
                  "y": drag["y"] - 54, "button": "left", "buttons": 1})
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": drag["x"] + 42,
                  "y": drag["y"] - 54, "button": "left", "buttons": 0, "clickCount": 1})
        cdp.pump(0.15)
        moved = cdp.eval(js("""
          const p=document.querySelector('#vl-grade'), r=p.getBoundingClientRect();
          return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,
            vl:visualViewport?.offsetLeft||0,vt:visualViewport?.offsetTop||0,
            vw:visualViewport?.width||innerWidth,vh:visualViewport?.height||innerHeight,
            visible:getComputedStyle(p).display!=='none' };
        """))
        if drag["height"] > drag["viewport"] * 0.48:
            raise RuntimeError(f"Imagen tapa la vista previa: {drag}")
        if abs(moved["left"] - drag["left"]) < 15 and abs(moved["top"] - drag["top"]) < 15:
            raise RuntimeError(f"Imagen no se movió: before={drag} after={moved}")
        if not moved["visible"] or moved["left"] < moved["vl"] - 2 or moved["top"] < moved["vt"] - 2 or moved["right"] > moved["vl"] + moved["vw"] + 2 or moved["bottom"] > moved["vt"] + moved["vh"] + 2:
            raise RuntimeError(f"Imagen salió del viewport: before={drag} after={moved}")
        layout["weaponShot"] = {"before": fire["before"], "after": shot["after"]}
        layout["imageDrag"] = moved
        hud["touchLayout"] = layout
    screenshot(cdp, QA_DIR / f"matrix-volar-{viewport}.png")
    return {"surface": "volar", "viewport": viewport, "fps": rep.get("fps"),
            "visual": visual, **hud}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--viewport", action="append", choices=sorted(VIEWPORTS),
                    help="Repeat to limit the matrix. Default: mobile, iPad, desktop.")
    ap.add_argument("--surface", action="append", choices=("share", "workspace", "jobs"),
                    help="Repeat to limit surfaces. Default: share, workspace, jobs.")
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
    results = run_matrix(args.clip_id, args.base_url, viewports, args.surface)
    for r in results:
        if r["surface"] == "jobs":
            print(f"jobs/{r['viewport']}: ok · {r['state']['cards']} cards · drawer {r['drawer']['width']:.0f}px")
            continue
        macro = r["macro"]
        sel = r["selected"]
        print(f"{r['surface']}/{r['viewport']}: ok · macro {macro['before']:.4f}->{macro['after']:.4f} · versions {sel.get('count')}")


if __name__ == "__main__":
    main()
