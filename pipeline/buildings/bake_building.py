"""Blender (headless) half of W4 step 3 / 4:  bake the textured ODM mesh onto a clean shell.

    blender -b -P bake_building.py -- --phase bake   --name b01 --source crop.obj --shell b01_shell.obj \
            --work work/ --size 4096 [--extrude 0.8 --max-ray 2.0 --margin 6 --samples 4]
    blender -b -P bake_building.py -- --phase export --name b01 --work work/ --out b01.glb [--atlas x.png]

Bake = "selected to active", DIFFUSE with only the COLOR filter: no lighting is baked, only
the albedo the photogrammetry texture already carries. Ray misses stay transparent (alpha 0)
so run.py can inpaint them; the raw bake is written as <name>_bake_raw.png.

Frames: the source crop and the shell are already in Blender space x=E-cx, y=N-cy,
z=elev-elev_min, so glTF's Y-up export equals the web's game frame (x=E, y=up, z=-N).
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True, choices=["bake", "export"])
    ap.add_argument("--name", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--source")
    ap.add_argument("--shell")
    ap.add_argument("--size", type=int, default=4096)
    ap.add_argument("--extrude", type=float, default=0.8)
    ap.add_argument("--max-ray", type=float, default=2.0)
    ap.add_argument("--margin", type=int, default=6)
    ap.add_argument("--samples", type=int, default=4)
    ap.add_argument("--island-margin", type=float, default=0.003)
    ap.add_argument("--angle", type=float, default=66.0)
    ap.add_argument("--device", default="CPU")
    ap.add_argument("--atlas")
    ap.add_argument("--out")
    return ap.parse_args(argv)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=str(path), forward_axis="Y", up_axis="Z")
    return [o for o in bpy.data.objects if o not in before]


def select_only(objs, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def unwrap(shell, island_margin, angle_deg):
    select_only([shell], shell)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=island_margin,
                             area_weight=0.6, correct_aspect=True, scale_to_bounds=False)
    # one texel density for every island, then pack
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=island_margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def uv_stats(shell):
    me = shell.data
    uv = me.uv_layers.active.data
    import numpy as np
    n = len(me.loops)
    a = np.empty(n * 2, dtype=np.float32)
    uv.foreach_get("uv", a)
    a = a.reshape(-1, 2)
    # area-weighted texel density: uv area / 3d area over triangles
    tri_uv = 0.0
    tri_3d = 0.0
    verts = me.vertices
    for p in me.polygons:
        li = list(p.loop_indices)
        if len(li) != 3:
            continue
        u = a[li]
        tri_uv += abs((u[1][0] - u[0][0]) * (u[2][1] - u[0][1]) - (u[1][1] - u[0][1]) * (u[2][0] - u[0][0])) / 2
        tri_3d += p.area
    return {"uv_coverage_frac": round(float(tri_uv), 4), "area_3d_m2": round(float(tri_3d), 2),
            "min_uv": [float(a[:, 0].min()), float(a[:, 1].min())], "max_uv": [float(a[:, 0].max()), float(a[:, 1].max())]}


def phase_bake(a):
    work = Path(a.work)
    reset()
    src = import_obj(a.source)
    shell = import_obj(a.shell)[0]
    shell.name = a.name
    unwrap(shell, a.island_margin, a.angle)
    stats = uv_stats(shell)
    # bake target
    img = bpy.data.images.new(f"{a.name}_bake", a.size, a.size, alpha=True, float_buffer=False)
    img.generated_color = (0.0, 0.0, 0.0, 0.0)
    img.colorspace_settings.name = "sRGB"
    mat = bpy.data.materials.new(f"{a.name}_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    shell.data.materials.clear()
    shell.data.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cyc = sc.cycles
    cyc.samples = a.samples
    cyc.use_denoising = False
    cyc.device = "CPU"
    if a.device.upper() == "GPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cyc.device = "GPU"
    sc.view_settings.view_transform = "Standard"
    select_only(src, shell)
    for o in src:
        o.select_set(True)
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_selected_to_active=True,
                        cage_extrusion=a.extrude, max_ray_distance=a.max_ray, margin=a.margin,
                        margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES",
                        normal_space="TANGENT")
    raw = work / f"{a.name}_bake_raw.png"
    img.filepath_raw = str(raw)
    img.file_format = "PNG"
    img.save()
    bpy.ops.wm.save_as_mainfile(filepath=str(work / f"{a.name}.blend"))
    (work / f"{a.name}_bake_stats.json").write_text(json.dumps(
        {"uv": stats, "size": a.size, "extrude": a.extrude, "max_ray": a.max_ray,
         "samples": a.samples, "blender": bpy.app.version_string}))
    print("BAKE_OK", raw)


def phase_export(a):
    work = Path(a.work)
    bpy.ops.wm.open_mainfile(filepath=str(work / f"{a.name}.blend"))
    # drop the photogrammetry source, keep only the shell
    shell = bpy.data.objects[a.name]
    for o in list(bpy.data.objects):
        if o is not shell:
            bpy.data.objects.remove(o, do_unlink=True)
    atlas = a.atlas or str(work / f"{a.name}_atlas.png")
    img = bpy.data.images.load(atlas)
    img.colorspace_settings.name = "sRGB"
    mat = shell.data.materials[0]
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.name = f"{a.name}_facade"
    select_only([shell], shell)
    bpy.ops.export_scene.gltf(filepath=str(a.out), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_image_format="JPEG",
                              export_jpeg_quality=92, export_materials="EXPORT",
                              export_normals=True, export_texcoords=True)
    print("EXPORT_OK", a.out)


if __name__ == "__main__":
    args = parse()
    (phase_bake if args.phase == "bake" else phase_export)(args)
