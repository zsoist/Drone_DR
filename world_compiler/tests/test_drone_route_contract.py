import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
ROUTE = ROOT / "unreal/DroneWorld/Config/AcceptanceRoute.json"


class DroneRouteContractTests(unittest.TestCase):
    def test_route_is_30_seconds_monotonic_and_inside_hero_cell(self):
        document = json.loads(ROUTE.read_text())
        samples = document["samples"]
        times = [row["time_s"] for row in samples]

        self.assertEqual(0.0, times[0])
        self.assertEqual(30.0, times[-1])
        self.assertTrue(all(a < b for a, b in zip(times, times[1:])))
        self.assertTrue(all(abs(row["position_ab_local_m"][0]) <= 50 for row in samples))
        self.assertTrue(all(abs(row["position_ab_local_m"][2]) <= 50 for row in samples))
        self.assertGreater(samples[0]["position_ab_local_m"][1], 0)
        self.assertEqual({"fpv", "third_person"}, set(document["camera_modes"]))

    def test_pawn_contract_names_hover_agl_collision_reset_hud_and_camera_modes(self):
        pawn = (ROOT / "unreal/DroneWorld/Source/DroneWorld/ABDronePawn.cpp").read_text()
        hud = (ROOT / "unreal/DroneWorld/Source/DroneWorld/ABDroneHUD.cpp").read_text()

        for token in ("GetWorld()->LineTraceSingleByChannel", "ToggleCamera", "ResetDrone", "OnComponentHit"):
            self.assertIn(token, pawn)
        self.assertIn("AGL", hud)
        self.assertIn("Camera", hud)


if __name__ == "__main__":
    unittest.main()
