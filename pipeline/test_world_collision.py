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
import scene_manifest

try:
    import mesh_coverage
except ImportError:
    mesh_coverage = None

try:
    import audit_world
except ImportError:
    audit_world = None


def write_glb(path: Path, positions, indices, *, nodes=None, scenes=None, scene=None):
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
    if nodes is not None:
        gltf["nodes"] = nodes
    if scenes is not None:
        gltf["scenes"] = scenes
    if scene is not None:
        gltf["scene"] = scene
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


class GlbSceneTransformTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "instances.glb"

    def tearDown(self):
        self.temp.cleanup()

    def test_parse_glb_applies_active_scene_parent_trs_and_repeated_mesh_instances(self):
        write_glb(
            self.path,
            [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
            [0, 1, 2],
            nodes=[
                {"translation": [5, 10, 7], "children": [1, 2]},
                {
                    "mesh": 0,
                    "translation": [10, 2, 3],
                    "rotation": [0, 0.7071067811865476, 0, 0.7071067811865476],
                    "scale": [2, 3, 4],
                },
                {"mesh": 0, "translation": [-2, 0, 1]},
                {"mesh": 0, "translation": [999, 999, 999]},
            ],
            scenes=[{"nodes": [3]}, {"nodes": [0]}],
            scene=1,
        )

        positions, indices = collision_bake.parse_glb(self.path)

        np.testing.assert_allclose(
            positions,
            [
                [15, 12, 10], [15, 12, 8], [19, 12, 10],
                [3, 10, 8], [4, 10, 8], [3, 10, 9],
            ],
        )
        self.assertEqual([0, 1, 2, 3, 4, 5], indices.tolist())


class StructuralFilterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model_dir = Path(self.temp.name)
        np.zeros((3, 3), dtype="<f4").tofile(self.model_dir / "dsm.bin")
        self.lod = {
            "bin": "dsm.bin",
            "grid": [3, 3],
            "spacing_m": [1.0, 1.0],
            "elev_min": 0.0,
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_filter_keeps_tall_wall_that_intersects_the_ground_band(self):
        positions = np.asarray([
            [-0.25, -10, 0],
            [0.25, 100, 0],
            [-0.25, 100, 0],
        ], dtype=np.float32)

        filtered_positions, filtered_indices = collision_bake._filtered_geometry(
            positions,
            np.asarray([0, 1, 2], dtype=np.uint32),
            self.model_dir,
            self.lod,
        )

        np.testing.assert_array_equal(positions, filtered_positions)
        self.assertEqual([0, 1, 2], filtered_indices.tolist())


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

    def test_validate_rejects_v2_collider_until_current_revision_rebuilds_it(self):
        meta = collision_bake.build(self.cid, vault=self.vault)
        meta["version"] = 2
        (self.model_dir / "collision.json").write_text(json.dumps(meta))

        with self.assertRaisesRegex(ValueError, "versión"):
            collision_bake.validate(self.cid, vault=self.vault)

        rebuilt = collision_bake.build(self.cid, vault=self.vault)

        self.assertEqual(collision_bake.VERSION, rebuilt["version"])
        self.assertGreater(rebuilt["version"], 2)
        self.assertEqual(rebuilt, collision_bake.validate(self.cid, vault=self.vault))

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

    def test_manifest_automatically_builds_collision_for_a_flyable_mesh(self):
        with (
            mock.patch.object(scene_manifest, "VAULT", self.vault),
            mock.patch.object(scene_manifest, "_site_for_version", return_value=None),
        ):
            manifest = scene_manifest.build(self.cid)

        self.assertTrue(manifest["capabilities"]["collision"])
        self.assertEqual(
            f"data/models/{self.cid}/collision.bin",
            manifest["assets"]["collision_bin"],
        )
        self.assertEqual(
            f"data/models/{self.cid}/mesh_coverage.bin",
            manifest["assets"]["mesh_coverage"],
        )
        self.assertEqual("structural_mesh", manifest["collision"]["source"])
        collision_bake.validate(self.cid, vault=self.vault)
        mesh_coverage.validate(self.cid, vault=self.vault)

    def test_manifest_never_advertises_stale_collision_when_rebuild_fails(self):
        (self.model_dir / "collision.bin").write_bytes(b"stale")
        (self.model_dir / "collision.json").write_text("{}")
        with (
            mock.patch.object(scene_manifest, "VAULT", self.vault),
            mock.patch.object(scene_manifest, "_site_for_version", return_value=None),
            mock.patch.object(
                scene_manifest.collision_bake,
                "validate",
                side_effect=ValueError("fingerprint stale"),
            ),
            mock.patch.object(
                scene_manifest.collision_bake,
                "build",
                side_effect=ValueError("source corrupt"),
            ),
        ):
            manifest = scene_manifest.build(self.cid)

        self.assertFalse(manifest["capabilities"]["collision"])
        self.assertNotIn("collision_bin", manifest["assets"])
        self.assertEqual("build_failed", manifest["collision"]["status"])
        self.assertIn("source corrupt", manifest["collision"]["error"])

    def test_terrain_only_manifest_remains_collision_ready(self):
        cid = "fixture_terrain"
        mdir = self.vault / "models" / cid
        mdir.mkdir(parents=True)
        lod = {
            "bin": "dsm.bin",
            "grid": [2, 2],
            "spacing_m": [1.0, 1.0],
            "size_m": [1.0, 1.0],
            "elev_min": 10.0,
            "elev_max": 11.0,
        }
        (mdir / "dsm_lod.json").write_text(json.dumps(lod))
        np.full((2, 2), 10.0, dtype="<f4").tofile(mdir / "dsm.bin")
        (mdir / "meta.json").write_text(json.dumps({
            "clip_id": cid,
            "has_dsm": True,
        }))
        with (
            mock.patch.object(scene_manifest, "VAULT", self.vault),
            mock.patch.object(scene_manifest, "_site_for_version", return_value=None),
        ):
            manifest = scene_manifest.build(cid)

        self.assertTrue(manifest["capabilities"]["terrain"])
        self.assertTrue(manifest["capabilities"]["collision"])
        self.assertEqual("terrain_only", manifest["collision"]["source"])
        self.assertNotIn("collision_bin", manifest["assets"])

    def test_active_mesh_world_without_current_assets_fails_audit_by_clip_id(self):
        self.assertIsNotNone(audit_world)
        manifest_dir = self.vault / "manifest"
        manifest_dir.mkdir()
        (manifest_dir / "system.json").write_text(json.dumps({
            "models": [{"clip_id": self.cid}],
            "scenes": [{
                "id": "scene_fixture",
                "active_version": self.cid,
                "versions": [{"id": self.cid}],
            }],
        }))
        (self.model_dir / "scene.v2.json").write_text(json.dumps({
            "clip_id": self.cid,
            "capabilities": {"terrain": True, "mesh": True, "collision": False},
            "assets": {},
        }))

        result = audit_world.audit(vault=self.vault)

        self.assertFalse(result["ok"])
        self.assertEqual(self.cid, result["failures"][0]["clip_id"])
        self.assertEqual("collision_not_published", result["failures"][0]["reason"])

    def test_audit_matches_mundo_deduplication_for_active_and_standalone_worlds(self):
        manifest_dir = self.vault / "manifest"
        manifest_dir.mkdir()
        (manifest_dir / "system.json").write_text(json.dumps({
            "models": [
                {"clip_id": "active"},
                {"clip_id": "inactive"},
                {"clip_id": "standalone"},
                {"clip_id": "standalone"},
            ],
            "scenes": [{
                "active_version": "active",
                "versions": [{"id": "active"}, {"id": "inactive"}],
            }],
        }))
        for cid in ("active", "inactive", "standalone"):
            mdir = self.vault / "models" / cid
            mdir.mkdir(parents=True)
            (mdir / "scene.v2.json").write_text(json.dumps({
                "clip_id": cid,
                "capabilities": {
                    "terrain": True,
                    "mesh": False,
                    "collision": True,
                },
            }))

        result = audit_world.audit(vault=self.vault)

        self.assertTrue(result["ok"])
        self.assertEqual(
            ["active", "standalone"],
            [world["clip_id"] for world in result["worlds"]],
        )


if __name__ == "__main__":
    unittest.main()
