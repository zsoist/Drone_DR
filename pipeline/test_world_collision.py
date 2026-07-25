import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import collision_bake

try:
    import mesh_coverage
except ImportError:
    mesh_coverage = None


def write_glb(path: Path, positions, indices):
    pos = np.asarray(positions, dtype="<f4")
    idx = np.asarray(indices, dtype="<u4")
    binary = pos.tobytes() + idx.tobytes()
    gltf = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": pos.nbytes},
            {"buffer": 0, "byteOffset": pos.nbytes, "byteLength": idx.nbytes},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3"},
            {"bufferView": 1, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0},
            "indices": 1,
        }]}],
    }
    json_chunk = json.dumps(gltf, separators=(",", ":")).encode()
    json_chunk += b" " * (-len(json_chunk) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(json_chunk), b"JSON")
        + json_chunk
        + struct.pack("<I4s", len(binary), b"BIN\x00")
        + binary
    )


class WorldCollisionBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.vault = Path(self.temp.name)
        self.cid = "fixture_obj"
        self.model_dir = self.vault / "models" / self.cid
        (self.model_dir / "model").mkdir(parents=True)
        lod = {
            "bin": "dsm.bin",
            "grid": [5, 5],
            "spacing_m": [1.0, 1.0],
            "elev_min": 100.0,
            "elev_max": 101.0,
        }
        (self.model_dir / "dsm_lod.json").write_text(json.dumps(lod))
        np.full((5, 5), 100.0, dtype="<f4").tofile(self.model_dir / "dsm.bin")
        (self.model_dir / "meta.json").write_text(json.dumps({
            "model_viewer": "model/odm_textured_model_viewer.obj",
            "mesh_offset": [2.0, 3.0, 100.0],
        }))
        (self.model_dir / "scene.v2.json").write_text(json.dumps({
            "transforms": {
                "mesh_offset": [2.0, 3.0, 100.0],
                "splat": {"status": "unaligned"},
            },
        }))
        (self.model_dir / "model" / "odm_textured_model_viewer.obj").write_text(
            "\n".join([
                "v -2 -3 1",
                "v -1 -3 1",
                "v -1 -4 1",
                "v -2 -4 1",
                "v -2 -3 100",
                "v -1 -3 100",
                "v -2 -4 100",
                "f 1/1 2/2 3/3 4/4",
                "f 1 1 2",
                "f 5 6 7",
            ])
        )

    def tearDown(self):
        self.temp.cleanup()

    def read_collision(self, meta):
        raw = (self.model_dir / "collision.bin").read_bytes()
        positions = np.frombuffer(
            raw[:meta["bytes_pos"]], dtype="<f4",
        ).reshape(-1, 3)
        indices = np.frombuffer(raw[meta["bytes_pos"]:], dtype="<u4")
        return positions, indices

    def test_obj_build_maps_to_world_triangulates_filters_and_compacts(self):
        meta = collision_bake.build(self.cid, vault=self.vault)
        positions, indices = self.read_collision(meta)

        self.assertEqual("model/odm_textured_model_viewer.obj", meta["source"])
        self.assertEqual(4, meta["verts"])
        self.assertEqual(2, meta["tris"])
        self.assertEqual([0.0, 1.0, 0.0], positions[0].tolist())
        self.assertEqual([0, 1, 2, 0, 2, 3], indices.tolist())
        self.assertEqual([0.0, 1.0, 0.0], meta["bounds"][0])
        self.assertEqual([1.0, 1.0, 1.0], meta["bounds"][1])
        self.assertFalse(any(self.model_dir.glob("collision.*.tmp")))

    def test_build_uses_atomic_replacement_for_binary_and_metadata(self):
        real_replace = os.replace
        with mock.patch.object(
            collision_bake.os,
            "replace",
            side_effect=real_replace,
        ) as replace:
            collision_bake.build(self.cid, vault=self.vault)

        destinations = [Path(call.args[1]).name for call in replace.call_args_list]
        self.assertEqual(["collision.bin", "collision.json"], destinations)

    def test_validate_rejects_a_stale_source_fingerprint(self):
        collision_bake.build(self.cid, vault=self.vault)
        collision_bake.validate(self.cid, vault=self.vault)
        obj = self.model_dir / "model" / "odm_textured_model_viewer.obj"
        obj.write_text(obj.read_text() + "\n# changed\n")

        with self.assertRaisesRegex(ValueError, "fingerprint"):
            collision_bake.validate(self.cid, vault=self.vault)

    def test_aligned_glb_remains_a_supported_collision_source(self):
        cid = "fixture_glb"
        mdir = self.vault / "models" / cid
        mdir.mkdir(parents=True)
        (mdir / "dsm_lod.json").write_text(json.dumps({
            "bin": "dsm.bin",
            "grid": [3, 3],
            "spacing_m": [2.0, 2.0],
            "elev_min": 10.0,
            "elev_max": 11.0,
        }))
        np.full((3, 3), 10.0, dtype="<f4").tofile(mdir / "dsm.bin")
        (mdir / "scene.v2.json").write_text(json.dumps({
            "transforms": {
                "splat": {
                    "status": "aligned",
                    "matrix": [
                        1, 0, 0, 0,
                        0, 1, 0, 0,
                        0, 0, 1, 0,
                        0, 0, 0, 1,
                    ],
                },
            },
        }))
        write_glb(
            mdir / "collision.collision.glb",
            [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
            [0, 1, 2],
        )

        meta = collision_bake.build(cid, vault=self.vault)

        self.assertEqual("collision.collision.glb", meta["source"])
        self.assertEqual(3, meta["verts"])
        self.assertEqual(1, meta["tris"])

    def test_coverage_rasterizes_triangles_instead_of_a_bounding_circle(self):
        self.assertIsNotNone(mesh_coverage)
        collision_bake.build(self.cid, vault=self.vault)

        meta = mesh_coverage.build(self.cid, vault=self.vault)
        mask = np.fromfile(
            self.model_dir / "mesh_coverage.bin",
            dtype=np.uint8,
        ).reshape(5, 5)

        self.assertEqual([5, 5], meta["grid"])
        self.assertEqual(1, mask[2, 2])
        self.assertEqual(0, mask[0, 0])
        self.assertGreater(meta["covered_pct"], 0)
        self.assertLess(meta["covered_pct"], 100)
        self.assertEqual(
            collision_bake.validate(self.cid, vault=self.vault)["source_fingerprint"],
            meta["source_fingerprint"],
        )


if __name__ == "__main__":
    unittest.main()
