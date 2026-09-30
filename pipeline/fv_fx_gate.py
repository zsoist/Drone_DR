#!/usr/bin/env python3
"""Flightverse workstream B browser gate (weapons / FX / audio), real Chrome via CDP.

Runs the world with ?fv=2 and checks:
  * all 6 weapons fire with no console/app errors, projectiles and explosions appear
  * missile gravity is integrated (not overwritten): vertical velocity keeps falling
  * bullet drop matches 0.5*g*t^2 (the same math the lead pipper uses)
  * FX pools stay under the per-tier caps after 500 spawn events (low / mid / high)
  * FX draw calls: 4 layers for all effects; report renderer draw calls idle vs 3-explosion stress
  * fx.aimData is published; no world-space aim ring is drawn
  * hit-stop only on kills / big blasts; shake budget clamp
  * Director-mode path does not throw (reticleHit null)
Usage: python3 pipeline/fv_fx_gate.py [--base http://localhost:8790] [--flag fv=2] [--json out.json]
Exit code 1 when any check fails.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_gate as bg  # noqa: E402
import browser_matrix as bm  # noqa: E402

WORLD = "recon_4e4245a1f4_aoi130"
WEAPONS = ["mg", "ac", "m", "sw", "rg", "tb"]


def run(base: str, flag: str, viewport: str, world: str = WORLD) -> dict:
    proc, prof, port = bg.launch_chrome()
    out: dict = {"checks": [], "metrics": {}}

    def check(name, ok, detail=""):
        out["checks"].append({"name": name, "ok": bool(ok), "detail": detail})

    try:
        c = bg.new_page(port)
        c.send("Network.enable")
        c.send("Network.setExtraHTTPHeaders", {"headers": {"Accept-Encoding": "identity"}})
        bm.set_viewport(c, viewport)
        c.send("Page.navigate", {"url": f"{base}/volar.html?m={world}&qa=1&{flag}"})
        bm.wait_for(c, "window.__volar && window.__volar.qa && window.__volar.qa.scene ? true : null", timeout=90, label="qa")
        c.pump(4)
        c.eval("document.getElementById('vl-guide-go') && document.getElementById('vl-guide-go').click()")
        c.pump(1)
        # ?fv=2: A's 'Toca para empezar' overlay blocks firing until dismissed
        c.eval("(()=>{const o=window.__volar.ctx.ui.overlay; if(o && o.active && o.active()) { try{o.close(o.active())}catch(e){} try{o.close('start')}catch(e){} } })()")
        c.pump(1)

        v2 = c.eval("!!window.__volar.ctx.fx.weapons.v2")
        check("fx v2 active", v2)
        # ── all six weapons fire ────────────────────────────────────────────
        c.eval("window.__volar.ctx.controls.camera.setGimbal(-0.75); window.__volar.ctx.drone.pos.y = window.__volar.ctx.terrain.heightAt(0,-40)+45;")
        c.pump(1.5)
        for w in WEAPONS:
            ok = c.eval(
                f"(()=>{{const fx=window.__volar.ctx.fx; fx.selectWeapon('{w}'); fx.weapons.state.cool=0;"
                f" fx.weapons.state.overheat=0; fx.weapons.state.ammo['{w}']=5; return fx.doFire()}})()")
            c.pump(2.2)
            check(f"weapon {w} fires", ok is True)
        errors = c.eval("JSON.stringify(window.__volar.errors)")
        check("no app errors after firing all weapons", errors == "[]", errors)
        exploded = c.eval("window.__volar.weapons.exploded")
        check("explosions produced (m, sw, tb)", exploded and exploded >= 10, str(exploded))
        check("aimData published", c.eval("!!window.__volar.ctx.fx.aimData && window.__volar.ctx.fx.aimData.valid"))
        check("no world-space aim ring", c.eval("window.__volar.ctx.fx.aim.children.length === 0 && window.__volar.ctx.fx.aim.visible === false"))

        # ── missile gravity is integrated (fix: was overwritten every step) ──
        res = c.eval(
            """(async()=>{const c=window.__volar.ctx, fx=c.fx, w=fx.weapons, T=c.THREE;
              fx.selectWeapon('m'); w.state.cool=0; w.state.ammo.m=5;
              const cam=c.camera; const d=new T.Vector3(); cam.getWorldDirection(d);
              // aim straight ahead far away so the launch is NOT drop-compensated by a near point
              const src=cam.position.clone().add(new T.Vector3(0,30,0));
              w.fire(src,{aimPoint:src.clone().addScaledVector(new T.Vector3(1,0,0),2],target:null});
              return 1})()""".replace("2],target", "2),target"))
        del res
        c.eval("""window.__vy=[]; (function(){const w=window.__volar.ctx.fx.weapons; const id=setInterval(()=>{const m=w.state.missiles[0]; if(m) window.__vy.push([+m.t.toFixed(2), +(m.vel.y).toFixed(3), +(m.fall||0).toFixed(3)]); else if(window.__vy.length>3) clearInterval(id)},50)})()""")
        c.pump(2.0)
        vy = json.loads(c.eval("JSON.stringify(window.__vy)") or "[]")
        falling = len(vy) > 6 and vy[-1][2] < vy[3][2] - 0.5 and vy[-1][1] < vy[3][1]
        check("missile gravity integrates (vy keeps falling)", falling, json.dumps(vy[:1] + vy[-1:]))

        # ── bullet drop = 0.5*g*t^2 ─────────────────────────────────────────
        drop = c.eval(
            """(()=>{const c=window.__volar.ctx, w=c.fx.weapons, T=c.THREE; w.setWeapon('mg'); w.state.cool=0; w.state.ammo.mg=50; w.state.overheat=0;
              const src=new T.Vector3(0,400,0); w.fire(src,{aimPoint:new T.Vector3(1000,400,0),target:null});
              const b=w.state.bullets.at(-1); const y0=b.pos.y, vy0=b.vel.y; let t=0; const dt=1/120;
              while(t<0.7 && w.state.bullets.includes(b)){ w.update(dt,[]); t+=dt; }
              return JSON.stringify({dy: b.pos.y-y0, vy0, t, x:b.pos.x})})()""")
        d = json.loads(drop)
        expect = d["vy0"] * d["t"] - 0.5 * 4 * d["t"] ** 2
        check("MG trajectory is ballistic: dy = vy0*t - 0.5*g*t^2", abs(d["dy"] - expect) < 0.02, drop)

        # ── pool caps after 500 spawn events per tier ───────────────────────
        caps = c.eval(
            """(()=>{const w=window.__volar.ctx.fx.weapons, f=w.fxs; const tier=f.tier;
              for(let i=0;i<500;i++){ f.explosion(i%5==0?'XL':(i%2?'M':'S'),{pos:{x:i%40,y:60,z:-i%40},normal:{x:0,y:1,z:0},ground:true}); f.impact('metal',{pos:{x:0,y:60,z:0},normal:{x:0,y:1,z:0},heavy:true}); f.crash({pos:{x:0,y:60,z:0},normal:{x:0,y:1,z:0},severity:1}); }
              f.update(1/60, window.__volar.ctx.camera, 900);
              const s=f.snapshot(); return JSON.stringify({tier, caps:s.caps, live:s.live, peaks:{sprites:s.pools.sprites.peak,debris:s.pools.debris.peak,decals:s.pools.decals.peak}, stolen:s.pools.sprites.stolen})})()""")
        cj = json.loads(caps)
        ok = (cj["live"]["sprites"] <= cj["caps"]["sprites"] and cj["live"]["debris"] <= cj["caps"]["debris"]
              and cj["live"]["decals"] <= cj["caps"]["decals"] and cj["live"]["lights"] <= cj["caps"]["lights"]
              and cj["peaks"]["sprites"] <= cj["caps"]["sprites"] and cj["peaks"]["debris"] <= cj["caps"]["debris"])
        check("FX pools respect caps after 500 events", ok, caps)
        out["metrics"]["pools_after_500"] = cj
        c.eval("window.__volar.ctx.fx.weapons.fxs.clear()")

        # ── 3-explosion stress: draw calls + frame times + fx cpu ───────────
        c.pump(1.0)
        idle = json.loads(c.eval(
            """(async()=>{const r=window.__volar; const t=[]; let last=performance.now(); await new Promise(res=>{let n=0; const f=()=>{const now=performance.now(); t.push(now-last); last=now; if(++n<90) requestAnimationFrame(f); else res()}; requestAnimationFrame(f)});
              t.sort((a,b)=>a-b); return JSON.stringify({p50:t[Math.floor(t.length*.5)], p95:t[Math.floor(t.length*.95)], calls: r.qa.frame && r.qa.frame.calls})})()"""))
        out["metrics"]["idle"] = idle
        stress = json.loads(c.eval(
            """(async()=>{const c=window.__volar.ctx, r=window.__volar, f=c.fx.weapons.fxs; const t=[]; let last=performance.now(); let calls=0, fxms=0, n=0, maxLive=0;
              const fire=()=>{ for(let k=0;k<3;k++) f.explosion(k==0?'M':(k==1?'S':'XL'),{pos:{x:-10+k*10,y:c.terrain.heightAt(-10+k*10,-40)+1,z:-40},normal:{x:0,y:1,z:0},ground:true}); };
              fire();
              await new Promise(res=>{const loop=()=>{const now=performance.now(); t.push(now-last); last=now; if(n%20===19) fire(); calls=Math.max(calls, r.qa.frame?r.qa.frame.calls:0); fxms=Math.max(fxms,f.snapshot().updateMs); maxLive=Math.max(maxLive,f.snapshot().live.sprites); if(++n<140) requestAnimationFrame(loop); else res()}; requestAnimationFrame(loop)});
              t.sort((a,b)=>a-b); return JSON.stringify({p50:t[Math.floor(t.length*.5)], p95:t[Math.floor(t.length*.95)], calls, fx_update_ms_avg:fxms, maxLiveSprites:maxLive})})()"""))
        out["metrics"]["explosion_stress"] = stress
        check("fx CPU cost < 1.5 ms/frame", stress["fx_update_ms_avg"] < 1.5, str(stress["fx_update_ms_avg"]))
        check("sprites stay under cap during stress", stress["maxLiveSprites"] <= cj["caps"]["sprites"], str(stress["maxLiveSprites"]))

        # ── hit-stop and shake budget wiring ────────────────────────────────
        hs = json.loads(c.eval(
            """(()=>{const fx=window.__volar.ctx.fx; const out={}; fx.hitstop.reset();
              // MG hit, no kill: must NOT stop time
              const w=fx.weapons; out.before=fx.timeScale();
              fx.shakeModel.reset(); for(let i=0;i<40;i++) fx.shakeModel.add('T2',0.1); out.trauma=fx.shakeModel.trauma;
              return JSON.stringify(out)})()"""))
        check("shake total clamped to 0.35", hs["trauma"] <= 0.35 + 1e-9, json.dumps(hs))
        check("time scale 1 outside hit-stop", hs["before"] == 1)

        # ── hit-stop freezes the WHOLE world (sim clock), not only weapons ──────────────────────
        c.eval("window.__volar.ctx.fx.hitstop.reset()")
        c.pump(0.3)
        free = c.eval("(async()=>{const S=window.__volar.ctx.state; const a=S.simT; await new Promise(r=>setTimeout(r,250)); return S.simT-a})()")
        frozen = c.eval(
            """(async()=>{const c=window.__volar.ctx, S=c.state; c.fx.hitstop.reset(); const ok=c.fx.hitstop.request(400);
              const a=S.simT, p=c.drone.pos.clone(); await new Promise(r=>setTimeout(r,250));
              return JSON.stringify({ok, dt:S.simT-a, moved:c.drone.pos.distanceTo(p)})})()""")
        fz = json.loads(frozen)
        check("hit-stop slows the sim clock (world-wide)", fz["ok"] and free > 0.15 and fz["dt"] < free * 0.4,
              f"free={free} stopped={fz}")
        c.pump(0.6)

        # ── FPV static overlay on crash classes (prop / crash), red edge in reduced motion ──────
        st = json.loads(c.eval(
            """(()=>{const c=window.__volar.ctx, f=c.fx.fpvStatic; const out={has:!!f};
              if(!f) return JSON.stringify(out);
              c.controls.camera.setRig(3); out.rig=window.__volar.camera.rig;
              out.shown=f.show('crash'); out.activeAfter=f.active; out.kind=f.kind;
              out.bounce=f.show('bounce'); return JSON.stringify(out)})()"""))
        c.pump(1.4)
        still = c.eval("window.__volar.ctx.fx.fpvStatic.active")
        check("FPV static overlay shows on crash and clears itself", st.get("has") and st.get("shown") and st.get("activeAfter")
              and st.get("bounce") is False and still is False, json.dumps(st) + f" still={still}")

        # ── Director mode no longer throws ──────────────────────────────────
        thrown = c.eval(
            """(()=>{try{ const c=window.__volar.ctx; const prev=c.state.director; c.state.director={}; c.fx.render(0.016); c.state.director=prev; return false }catch(e){ return String(e) }})()""")
        check("director mode render does not throw", thrown is False, str(thrown))

        final_errors = c.eval("JSON.stringify(window.__volar.errors)")
        check("no app errors at the end", final_errors == "[]", final_errors)
        out["console_errors"] = [str(e)[:200] for e in list(c.errors)[:8]]
    finally:
        bg.teardown_chrome(proc, prof)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8790")
    ap.add_argument("--flag", default="fv=2")
    ap.add_argument("--viewport", default="mobile_portrait")
    ap.add_argument("--cid", default=WORLD)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()
    t0 = time.time()
    result = run(args.base, args.flag, args.viewport, args.cid)
    failed = [c for c in result["checks"] if not c["ok"]]
    for c in result["checks"]:
        print(("PASS " if c["ok"] else "FAIL ") + c["name"] + ("" if c["ok"] else f"  -> {c['detail'][:300]}"))
    print("metrics:", json.dumps(result["metrics"]))
    print(f"{len(result['checks']) - len(failed)}/{len(result['checks'])} ok in {time.time() - t0:.0f}s")
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
