import json
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


PIPELINE = Path(__file__).resolve().parent
ROOT = PIPELINE.parent / "web" / "assets" / "weapons"
sys.path.insert(0, str(PIPELINE))

from weapon_asset_contract import audit_weapon_arsenal, validate_weapon_glb
from generate_weapon_arsenal import generate


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

    def test_seed_rebuild_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory(prefix="flightverse-weapons-") as folder:
            rebuilt = Path(folder)
            generate(rebuilt, 20260727)
            for stem in WEAPONS.values():
                for tier in ("ultra", "runtime"):
                    expected = hashlib.sha256(
                        (ROOT / tier / f"{stem}.glb").read_bytes()
                    ).hexdigest()
                    actual = hashlib.sha256(
                        (rebuilt / tier / f"{stem}.glb").read_bytes()
                    ).hexdigest()
                    self.assertEqual(expected, actual, f"{stem}/{tier}")


if __name__ == "__main__":
    unittest.main()
