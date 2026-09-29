"""Pins the mesh_offset contract of scene.v2.json.

viewer.obj = geo.obj - vertex_mean(geo)            (tresd_publish.make_viewer_mesh)
game frame origin = DSM centre                     (splat_align.py, dsm_lod.center_wgs84)
geo.obj frame origin = coords.txt (ODM local)      (scene_aoi.parse_odm_coords_origin)
=> transforms.mesh_offset = vertex_mean(geo) - dsm_center_in_odm_local   (NOT the raw mean)

Measured on the live vault (2026-09-29): with the raw mean, meshes sat 8..236 m off the DSM
(mesh/DSM height MAD 2.7-9.5 m); with this contract MAD drops to 1.0-1.9 m on flat sites.
recon_4e4245a1f4_aoi130, whose offset scene_aoi already corrected, is reproduced to 1e-4 m.
"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import scene_aoi
import scene_manifest

LAT, LON = 4.671778, -74.049388


def _write_obj(path: Path, verts):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"v {x} {y} {z}\n" for x, y, z in verts) + "f 1 2 3\n")


class MeshOffsetContractTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.vault = Path(self.td.name)
        patch = mock.patch.object(scene_manifest, "VAULT", self.vault)
        patch.start()
        self.addCleanup(patch.stop)
        self.geo = self.vault / "models" / "c1" / "model" / "odm_textured_model_geo.obj"
        _write_obj(self.geo, [(0, 0, 100), (10, 20, 100), (20, 10, 106)])   # mean (10, 10, 102)
        self.lod = {"center_wgs84": [LON, LAT]}

    def _coords(self, dx, dy):
        east, north = scene_aoi.utm18_from_wgs84(LAT, LON)
        p = self.vault / "odm" / "proj_c1" / "odm_georeferencing" / "coords.txt"
        p.parent.mkdir(parents=True)
        p.write_text(f"WGS84 UTM 18N\n{east - dx:.4f} {north - dy:.4f}\n")

    def test_offset_is_geo_mean_minus_dsm_centre_in_odm_frame(self):
        self._coords(dx=4.0, dy=-3.0)             # DSM centre is (+4 E, -3 N) from the ODM origin
        off, frame = scene_manifest.mesh_offset_game_frame("c1", self.geo, self.lod, [10.0, 10.0, 102.0])
        self.assertEqual(frame, "dsm_center")
        self.assertAlmostEqual(off[0], 10.0 - 4.0, places=3)
        self.assertAlmostEqual(off[1], 10.0 + 3.0, places=3)
        self.assertAlmostEqual(off[2], 102.0, places=3)

    def test_viewer_vertex_lands_on_its_game_frame_position(self):
        self._coords(dx=4.0, dy=-3.0)
        off, _ = scene_manifest.mesh_offset_game_frame("c1", self.geo, self.lod, None)
        mean = scene_manifest._obj_center(self.geo)
        geo_vertex = (20.0, 10.0)                   # ODM-local E,N of a mesh vertex
        viewer_vertex = (geo_vertex[0] - mean[0], geo_vertex[1] - mean[1])
        game = (viewer_vertex[0] + off[0], viewer_vertex[1] + off[1])
        self.assertAlmostEqual(game[0], geo_vertex[0] - 4.0, places=3)   # geo minus DSM centre
        self.assertAlmostEqual(game[1], geo_vertex[1] + 3.0, places=3)

    def test_recomputing_ignores_an_already_corrected_meta_offset(self):
        # scene_aoi stores a corrected meta.mesh_offset; the result must not be corrected twice
        self._coords(dx=4.0, dy=-3.0)
        a, _ = scene_manifest.mesh_offset_game_frame("c1", self.geo, self.lod, [10.0, 10.0, 102.0])
        b, _ = scene_manifest.mesh_offset_game_frame("c1", self.geo, self.lod, a)
        self.assertEqual(a, b)

    def test_without_odm_origin_legacy_meta_offset_passes_through_unlabelled(self):
        off, frame = scene_manifest.mesh_offset_game_frame("c1", self.geo, self.lod, [1.5, 2.5, 99.0])
        self.assertEqual(off, [1.5, 2.5, 99.0])
        self.assertIsNone(frame)

    def test_non_utm18_frame_is_not_guessed(self):
        p = self.vault / "odm" / "proj_c1" / "odm_georeferencing" / "coords.txt"
        p.parent.mkdir(parents=True)
        p.write_text("WGS84 UTM 19N\n1 2\n")
        off, frame = scene_manifest.mesh_offset_game_frame("c1", self.geo, self.lod, [1.5, 2.5, 99.0])
        self.assertEqual((off, frame), ([1.5, 2.5, 99.0], None))


if __name__ == "__main__":
    unittest.main()
