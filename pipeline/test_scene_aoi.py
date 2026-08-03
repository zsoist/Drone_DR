import struct
import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np

from scene_aoi import (
    circle_intersects_triangle,
    crop_obj_circle,
    crop_splat_circle,
    normalized_from_colmap_images,
    normalized_to_game_matrix,
    parse_odm_coords_origin,
    publish_bundle,
    utm18_from_wgs84,
    validate_cid,
    validate_nerfstudio_normalization_contract,
)
from scene_manifest import splat_transform_contract


class SceneAoiGeometryTests(unittest.TestCase):
    def test_wgs84_conversion_places_block_center_in_odm_utm_frame(self):
        east, north = utm18_from_wgs84(4.671778, -74.049388)
        self.assertAlmostEqual(east, 605435.02, delta=0.08)
        self.assertAlmostEqual(north, 516454.56, delta=0.08)

    def test_odm_local_origin_is_read_from_georeferencing_contract(self):
        with tempfile.TemporaryDirectory() as td:
            coords = Path(td) / "coords.txt"
            coords.write_text("WGS84 UTM 18N\n605458 516502\n1 2 3\n")
            self.assertEqual(parse_odm_coords_origin(coords), (605458.0, 516502.0))

    def test_aoi_ids_reject_path_traversal_before_touching_the_vault(self):
        self.assertEqual(validate_cid("recon_ab12_aoi130"), "recon_ab12_aoi130")
        for unsafe in ("../models/source", "scene/aoi", "", "."):
            with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                validate_cid(unsafe)

    def test_triangle_crossing_circle_is_kept_even_when_vertices_are_outside(self):
        crossing = np.array([[-2.0, 0.2], [2.0, 0.2], [2.0, 0.4]])
        far = np.array([[2.0, 2.0], [3.0, 2.0], [2.0, 3.0]])
        self.assertTrue(circle_intersects_triangle(crossing, (0.0, 0.0), 1.0))
        self.assertFalse(circle_intersects_triangle(far, (0.0, 0.0), 1.0))

    def test_splat_crop_preserves_complete_32_byte_records_inside_circle(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "source.splat"
            output = Path(td) / "cropped.splat"
            records = []
            for index, xyz in enumerate(((0.0, 0.0, 4.0), (1.5, 0.0, 5.0), (3.0, 0.0, 6.0))):
                records.append(struct.pack("<3f", *xyz) + bytes([index + 1]) * 20)
            source.write_bytes(b"".join(records))

            report = crop_splat_circle(
                source,
                output,
                normalized_to_local=np.eye(4),
                center_local=(0.0, 0.0),
                radius_m=2.0,
            )

            self.assertEqual(report["input_gaussians"], 3)
            self.assertEqual(report["output_gaussians"], 2)
            self.assertEqual(output.read_bytes(), records[0] + records[1])

    def test_obj_crop_keeps_boundary_faces_and_remaps_geometry_indices(self):
        source_text = """mtllib model.mtl
v 0 0 1
v 0.5 0 1
v 0 0.5 1
v -2 0.2 2
v 2 0.2 2
v 2 0.4 2
v 3 3 3
v 4 3 3
v 3 4 3
vt 0 0
vt 1 0
vt 0 1
usemtl roof
f 1/1 2/2 3/3
f 4/1 5/2 6/3
usemtl noise
f 7/1 8/2 9/3
"""
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "source.obj"
            output = Path(td) / "cropped.obj"
            source.write_text(source_text)

            report = crop_obj_circle(source, output, center_local=(0.0, 0.0), radius_m=1.0)
            result = output.read_text()

            self.assertEqual(report["input_faces"], 3)
            self.assertEqual(report["output_faces"], 2)
            self.assertEqual(report["output_vertices"], 6)
            self.assertEqual(result.count("\nf "), 2)
            self.assertNotIn("usemtl noise", result)
            self.assertIn("f 4/1 5/2 6/3", result)

    def test_normalized_to_game_maps_aoi_center_to_world_origin(self):
        normalized_from_local = np.array([
            [0.01, 0.0, 0.0, -1.0],
            [0.0, 0.01, 0.0, -2.0],
            [0.0, 0.0, 0.01, -26.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
        matrix = normalized_to_game_matrix(
            normalized_from_local,
            center_local=(-22.98, -47.44),
            elev_min=2580.0,
        )
        local_center_msl = np.array([-22.98, -47.44, 2600.0, 1.0])
        normalized = normalized_from_local @ local_center_msl
        game = matrix @ normalized
        np.testing.assert_allclose(game, [0.0, 20.0, 0.0, 1.0], atol=1e-8)

    def test_colmap_normalization_centers_and_scales_all_registered_cameras(self):
        with tempfile.TemporaryDirectory() as td:
            images = Path(td) / "images.txt"
            # Identity COLMAP rotations and t=-camera_center. The empty line
            # after each image is its (empty) POINTS2D row.
            images.write_text("""# Image list
1 1 0 0 0 0 0 0 1 one.jpg

2 1 0 0 0 -10 0 0 1 two.jpg

3 1 0 0 0 0 -10 0 1 three.jpg

4 1 0 0 0 0 0 -10 1 four.jpg

""")
            matrix, report = normalized_from_colmap_images(images)

            centers = np.array([
                [0.0, 0.0, 0.0, 1.0],
                [10.0, 0.0, 0.0, 1.0],
                [0.0, 10.0, 0.0, 1.0],
                [0.0, 0.0, 10.0, 1.0],
            ])
            normalized = centers @ matrix.T
            np.testing.assert_allclose(normalized[:, :3].mean(axis=0), 0.0, atol=1e-12)
            self.assertAlmostEqual(float(np.abs(normalized[:, :3]).max()), 1.0, places=12)
            self.assertEqual(report["registered_cameras"], 4)
            self.assertLessEqual(report["camera_center_mean_abs"], 1e-12)
            self.assertAlmostEqual(report["camera_extent"], 1.0, places=12)

    def test_normalization_contract_requires_real_hashed_training_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            images = root / "images.txt"
            config = root / "config.yml"
            images.write_text("# registered cameras\n")
            config.write_text("method_name: splatfacto\n")

            with self.assertRaises(ValueError):
                validate_nerfstudio_normalization_contract({}, images, config)

    def test_normalization_contract_verifies_colmap_and_nerfstudio_configuration(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            images = root / "images.txt"
            config = root / "config.yml"
            images.write_text("# registered cameras\n1 1 0 0 0 0 0 0 1 image.jpg\n\n")
            config.write_text("""method_name: splatfacto
assume_colmap_world_coordinate_convention: true
auto_scale_poses: true
center_method: poses
orientation_method: up
scale_factor: 1.0
downscale_factor: 1
camera_optimizer:
  mode: 'off'
""")
            digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            contract = {
                "trainer": "nerfstudio-splatfacto",
                "method_name": "splatfacto",
                "config_sha256": digest(config),
                "colmap_images_sha256": digest(images),
                "assume_colmap_world_coordinate_convention": True,
                "auto_scale_poses": True,
                "center_method": "poses",
                "orientation_method": "up",
                "scale_factor": 1.0,
                "downscale_factor": 1,
                "camera_optimizer": "off",
            }

            verified = validate_nerfstudio_normalization_contract(
                {"trainer": "nerfstudio-splatfacto", "normalization_contract": contract},
                images,
                config,
            )

            self.assertEqual(verified, contract)
            images.write_text("tampered\n")
            with self.assertRaises(ValueError):
                validate_nerfstudio_normalization_contract(
                    {"trainer": "nerfstudio-splatfacto", "normalization_contract": contract},
                    images,
                    config,
                )

    def test_scene_manifest_uses_verified_world_transform_from_splat_metadata(self):
        matrix = [
            95.0, 0.0, 0.0, 1.0,
            0.0, 95.0, 0.0, 2.0,
            0.0, 0.0, 95.0, 3.0,
            0.0, 0.0, 0.0, 1.0,
        ]
        contract = splat_transform_contract({
            "world_transform": {
                "status": "aligned",
                "matrix": matrix,
                "rmse_m": 0.0,
                "method": "nerfstudio-colmap-exact",
            }
        })
        self.assertEqual(contract["status"], "aligned")
        self.assertEqual(contract["matrix"], matrix)
        self.assertEqual(contract["method"], "nerfstudio-colmap-exact")

    def test_scene_manifest_rejects_unverified_or_malformed_alignment(self):
        self.assertEqual(splat_transform_contract({})["status"], "unaligned")
        self.assertEqual(
            splat_transform_contract({"world_transform": {"status": "aligned", "matrix": [1.0]}})["status"],
            "unaligned",
        )
        singular = [
            1.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ]
        self.assertEqual(
            splat_transform_contract({"world_transform": {"status": "aligned", "matrix": singular}})["status"],
            "unaligned",
        )

    def test_bundle_publication_rolls_back_every_prior_move_on_failure(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            first_stage = root / "stage" / "first.bin"
            first_stage.parent.mkdir()
            first_stage.write_bytes(b"first")
            second_stage = root / "stage" / "second.bin"
            second_stage.write_bytes(b"second")
            first_final = root / "public" / "first.bin"
            first_final.parent.mkdir()
            second_final = root / "missing-parent" / "second.bin"

            with self.assertRaises(OSError):
                publish_bundle([(first_stage, first_final), (second_stage, second_final)])

            self.assertTrue(first_stage.exists())
            self.assertFalse(first_final.exists())
            self.assertTrue(second_stage.exists())


if __name__ == "__main__":
    unittest.main()
