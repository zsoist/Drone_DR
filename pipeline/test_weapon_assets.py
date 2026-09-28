import io
import json
import hashlib
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


PIPELINE = Path(__file__).resolve().parent
ROOT = PIPELINE.parent / "web" / "assets" / "weapons"
sys.path.insert(0, str(PIPELINE))

from weapon_asset_contract import audit_weapon_arsenal, validate_weapon_glb
from generate_weapon_arsenal import generate


def _glb_content(data: bytes) -> dict:
    """What the runtime sees in a GLB, independent of how the toolchain serialized it.

    Byte equality broke on 2026-09-03 without any asset change: trimesh 5 stopped
    emitting the wrapper root node 'world' (same graph, different node order) and a
    different zlib compresses identical pixels into different PNG bytes.
    """
    offset, chunks = 12, {}
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunks[kind] = data[offset + 8:offset + 8 + length]
        offset += 8 + length
    gltf = json.loads(chunks[0x4E4F534A])
    binary = chunks.get(0x004E4942, b"")
    views = gltf.get("bufferViews", [])

    def view_bytes(index: int) -> bytes:
        view = views[index]
        start = view.get("byteOffset", 0)
        return binary[start:start + view["byteLength"]]

    image_views = {image["bufferView"] for image in gltf.get("images", [])}
    pixels = [
        hashlib.sha256(np.asarray(
            Image.open(io.BytesIO(view_bytes(i))).convert("RGBA")).tobytes()).hexdigest()
        for i in sorted(image_views)
    ]
    geometry = [hashlib.sha256(view_bytes(i)).hexdigest()
                for i in range(len(views)) if i not in image_views]
    nodes = gltf.get("nodes", [])
    parent_of = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}

    def parent_name(index: int):
        parent = parent_of.get(index)
        name = nodes[parent].get("name") if parent is not None else None
        return None if name == "world" else name

    graph = sorted(
        json.dumps({"name": node.get("name"), "parent": parent_name(i),
                    "mesh": node.get("mesh"), "matrix": node.get("matrix"),
                    "extras": node.get("extras")}, sort_keys=True)
        for i, node in enumerate(nodes) if node.get("name") != "world"
    )
    # buffers/bufferViews carry byte offsets and lengths that shift with PNG size;
    # scenes/scene index the (reordered) node array; asset names the generator version
    serialization = {"nodes", "scenes", "scene", "bufferViews", "buffers", "asset"}
    rest = json.dumps({k: v for k, v in gltf.items() if k not in serialization}, sort_keys=True)
    return {"pixels": pixels, "geometry": geometry, "graph": graph, "rest": rest}


WEAPONS = {
    "ac": "ac30_cannon",
    "sw": "swarm8_pod",
    "vx": "viperx_missile",
    "rg": "railgun_pod",
    "tb": "nova_bomb",
}
REQUIRED_NODES = {"mount", "projectile", "muzzle", "collision_proxy"}


class WeaponAssetContractTests(unittest.TestCase):
    def test_every_weapon_has_ultra_runtime_validation_and_preview(self):
        for stem in WEAPONS.values():
            self.assertTrue((ROOT / "ultra" / f"{stem}.glb").is_file())
            self.assertTrue((ROOT / "runtime" / f"{stem}.glb").is_file())
            self.assertTrue((ROOT / "validation" / f"{stem}.json").is_file())
            self.assertTrue((ROOT / "previews" / f"{stem}.png").is_file())
        self.assertTrue((ROOT / "previews" / "contact-sheet.png").is_file())

    def test_ultra_has_named_nodes_and_embedded_4k_pbr_maps(self):
        for stem in WEAPONS.values():
            report = validate_weapon_glb(
                ROOT / "ultra" / f"{stem}.glb",
                "ultra",
                REQUIRED_NODES,
            )
            self.assertEqual(report["texture_dimensions"], [[4096, 4096]] * 3)
            self.assertLess(report["bytes"], 15 * 1024 * 1024)
            self.assertLess(report["triangles"], 120_000)
            self.assertTrue(report["finite_accessors"])
            self.assertTrue(report["axis_contract"])

    def test_runtime_maps_are_1k_and_models_are_bounded(self):
        for stem in WEAPONS.values():
            report = validate_weapon_glb(
                ROOT / "runtime" / f"{stem}.glb",
                "runtime",
                REQUIRED_NODES,
            )
            self.assertEqual(report["texture_dimensions"], [[1024, 1024]] * 3)
            self.assertLess(report["bytes"], 3 * 1024 * 1024)
            self.assertLess(report["triangles"], 30_000)
            self.assertTrue(report["buffer_bounds"])
            self.assertGreater(report["bounds"][2], 0.4)

    def test_manifest_and_sidecars_match_the_exact_generated_files(self):
        report = audit_weapon_arsenal(ROOT)
        self.assertTrue(report["ok"], report)
        self.assertEqual(set(report["weapons"]), set(WEAPONS.values()))
        manifest = json.loads((ROOT / "manifest.json").read_text())
        self.assertEqual(manifest["seed"], 20260727)
        self.assertEqual(manifest["coordinateSystem"], "+Y up, -Z forward")
        self.assertEqual(set(manifest["weapons"]), set(WEAPONS))

    def test_seed_rebuild_is_content_deterministic(self):
        with tempfile.TemporaryDirectory(prefix="flightverse-weapons-") as folder:
            rebuilt = Path(folder)
            generate(rebuilt, 20260727)
            for stem in WEAPONS.values():
                for tier in ("ultra", "runtime"):
                    expected = _glb_content((ROOT / tier / f"{stem}.glb").read_bytes())
                    actual = _glb_content((rebuilt / tier / f"{stem}.glb").read_bytes())
                    for part in ("geometry", "pixels", "graph", "rest"):
                        self.assertEqual(expected[part], actual[part], f"{stem}/{tier}: {part}")


if __name__ == "__main__":
    unittest.main()
