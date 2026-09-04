import tempfile
import unittest
from pathlib import Path

from world_compiler.export.manifest import REQUIRED_GEOMETRY_ROLES, validate_game_scene_document


def valid_document():
    geometry = [
        {
            "role": role,
            "asset": f"geometry/{role}.obj",
            "provenance": "GEOMETRICALLY_INFERRED",
            "sha256": "a" * 64,
            "triangles": 1,
        }
        for role in REQUIRED_GEOMETRY_ROLES
    ]
    return {
        "version": 1,
        "hero_id": "hero_0123456789abcdef",
        "scene_id": "scene_fixture",
        "version_id": "recon_fixture",
        "profile": "hero-r0",
        "aoi": {"center_ab_m": [0, 0], "size_m": 100},
        "coordinates": {
            "matrix_ab_m_to_ue_cm": [[1, 0, 0, 0]] * 4,
            "matrix_ue_cm_to_ab_m": [[1, 0, 0, 0]] * 4,
            "metadata": {"units": "centimeters"},
        },
        "geometry": geometry,
        "truth_field": "truth/truth_field.v1.json",
        "materials": "materials/recipes.json",
        "reference_cameras": {"status": "unavailable", "cameras": []},
        "missing_views": "missing_views.json",
        "source_hashes": {"scene_manifest": "b" * 64},
        "dependency_hashes": {"compiler_contract": "world-compiler-r0-v1"},
        "records": {"request": "request.json", "run": "run.json", "cost": "cost.json"},
    }


class GameSceneManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        document = valid_document()
        for row in document["geometry"]:
            path = self.root / row["asset"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("v 0 0 0\n")
        for relative in (
            document["truth_field"],
            document["materials"],
            document["missing_views"],
            *document["records"].values(),
        ):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}\n")
        self.document = document

    def tearDown(self):
        self.temporary.cleanup()

    def test_complete_document_has_six_distinct_provenance_layers(self):
        validate_game_scene_document(self.document, self.root)

        self.assertEqual(set(REQUIRED_GEOMETRY_ROLES), {row["role"] for row in self.document["geometry"]})

    def test_asset_escape_is_rejected_before_import(self):
        self.document["geometry"][0]["asset"] = "../private.obj"

        with self.assertRaisesRegex(ValueError, "escapes world root"):
            validate_game_scene_document(self.document, self.root)

    def test_missing_transform_inverse_is_rejected(self):
        del self.document["coordinates"]["matrix_ue_cm_to_ab_m"]

        with self.assertRaisesRegex(ValueError, "coordinate matrices"):
            validate_game_scene_document(self.document, self.root)


if __name__ == "__main__":
    unittest.main()
