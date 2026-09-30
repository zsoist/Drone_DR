"""Blender headless: offline comparison renders (ODM textured crop vs clean textured shells).

blender -b -P render_views.py -- --kind odm|shell --inputs a.obj|a.glb [...] --out prefix \
        --target x,y,z --dist 120 [--w 1400 --h 1000]
Same camera set for both kinds: 4 obliques (az 30/120/210/300, el 35 deg) + a top view.
Workbench, flat lighting, texture colour: shows exactly the albedo, no shading tricks."""
import argparse, math, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("--kind", required=True)
ap.add_argument("--inputs", nargs="+", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--target", default="0,0,20")
ap.add_argument("--dist", type=float, default=120)
ap.add_argument("--cams", default="", help="name:az:el:dist:tx:ty:tz;... custom perspective views (blender space) instead of the default 5")
ap.add_argument("--w", type=int, default=1400)
ap.add_argument("--h", type=int, default=1000)
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
for p in a.inputs:
    if p.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=p, forward_axis="Y", up_axis="Z")
    else:
        bpy.ops.import_scene.gltf(filepath=p)   # glTF Y-up -> Blender Z-up automatically (== our bl space)
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "FLAT"
sh.color_type = "TEXTURE"
sh.show_backface_culling = False
sc.render.resolution_x, sc.render.resolution_y = a.w, a.h
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0.62, 0.72, 0.85)
sc.view_settings.view_transform = "Standard"
tx, ty, tz = [float(v) for v in a.target.split(",")]
target = Vector((tx, ty, tz))
cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.clip_end = 1000
views = [("oblique_a", 30, 35), ("oblique_b", 120, 35), ("oblique_c", 210, 35), ("oblique_d", 300, 35), ("top", 0, 90)]
custom = {}
if a.cams:
    views = []
    for c in a.cams.split(";"):
        nm, az, el, dist, x, y, z = c.split(":")
        views.append((nm, float(az), float(el)))
        custom[nm] = (float(dist), Vector((float(x), float(y), float(z))))
for name, az, el in views:
    if name == "top":
        cam_d.type = "ORTHO"; cam_d.ortho_scale = 110
        cam.location = target + Vector((0, 0, 200)); cam.rotation_euler = (0, 0, math.radians(0))
        cam.rotation_euler = (0, 0, 0)
    else:
        cam_d.type = "PERSP"; cam_d.lens = 35
        e, z = math.radians(el), math.radians(az)
        dist_, tgt_ = custom.get(name, (a.dist, target))
        cam.location = tgt_ + Vector((math.sin(z) * math.cos(e), -math.cos(z) * math.cos(e), math.sin(e))) * dist_
        d = tgt_ - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{a.out}_{name}.png"
    bpy.ops.render.render(write_still=True)
print("RENDER_OK")
