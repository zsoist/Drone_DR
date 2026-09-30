"""W4b evidence renders: ODM | old shell bake (v1) | new photo-projected shell, same cameras.

    python3 -m buildings.compare_renders <clip_id> <out_dir> [--facades 4]
Uses Blender headless (render_views.py). KTX2 GLBs are not readable by Blender, so the raw
(PNG-atlas) GLBs from work/ are rendered; they carry the identical geometry/UVs/atlas.
"""
import argparse, math, subprocess, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from buildings import facets as FA, photobake as PB
from paths import VAULT

BL = "/Applications/Blender.app/Contents/MacOS/Blender"


def facade_cams(cid, n_per=4, dist=95.0, el=14.0):
    work = VAULT / "models" / cid / "buildings" / "work"
    cams, names = [], []
    for b in ("b01", "b02"):
        g, t, s = PB._vis_faces(*PB.shell_game(work, b))
        walls = [f for f in FA.extract_facets(g, t, s) if f.kind == FA.WALL][:n_per]
        for k, f in enumerate(walls):
            az = math.degrees(math.atan2(f.n[0], f.n[2]))
            o = f.o                                                     # game -> blender (x, -z, y)
            nm = f"{b}_facade{k}"
            cams.append(f"{nm}:{az:.1f}:{el}:{dist}:{o[0]:.2f}:{-o[2]:.2f}:{o[1]:.2f}")
            names.append(nm)
    return ";".join(cams), names


def render(kind, inputs, out, extra):
    subprocess.run([BL, "-b", "-noaudio", "-P", str(HERE / "render_views.py"), "--", "--kind", kind, "--inputs", *inputs,
                    "--out", str(out), *extra], check=True, capture_output=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cid"); ap.add_argument("out"); ap.add_argument("--facades", type=int, default=4)
    ap.add_argument("--dist", type=float, default=95.0); ap.add_argument("--el", type=float, default=14.0); ap.add_argument("--prefix", default="closeup"); ap.add_argument("--overview", action="store_true"); ap.add_argument("--facade-views", action="store_true")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    B = VAULT / "models" / a.cid / "buildings"
    W = B / "work"
    from PIL import Image
    sets = {"odm": ("odm", [str(W / "odm_render_crop.obj")]),
            "old": ("shell", [str(W / "b01_visual_raw.glb"), str(W / "b02_visual_raw.glb")]),
            "new": ("shell", [str(W / "b01_photo_raw.glb"), str(W / "b02_photo_raw.glb")])}
    if a.overview:
        for k, (kind, ins) in sets.items():
            render(kind, ins, out / k, ["--target", "12,38,25", "--dist", "120"])
        for v in ("oblique_a", "oblique_b", "oblique_c", "oblique_d", "top"):
            ims = [Image.open(out / f"{k}_{v}.png").convert("RGB") for k in sets]
            w, h = ims[0].size
            o = Image.new("RGB", (w * 3, h))
            for i, im in enumerate(ims): o.paste(im, (i * w, 0))
            o.resize((w * 3 // 2, h // 2)).save(out / f"pair_{v}.png")
    if a.facade_views:
        cams, names = facade_cams(a.cid, a.facades, dist=a.dist, el=a.el)
        for k, (kind, ins) in sets.items():
            render(kind, ins, out / f"f_{k}", ["--cams", cams, "--w", "1200", "--h", "900"])
        for nm in names:
            ims = [Image.open(out / f"f_{k}_{nm}.png").convert("RGB") for k in sets]
            w, h = ims[0].size
            o = Image.new("RGB", (w * 3, h))
            for i, im in enumerate(ims): o.paste(im, (i * w, 0))
            o.save(out / f"{a.prefix}_{nm}.png")
        print(names)
