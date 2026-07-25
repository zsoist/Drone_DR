import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class DeployWorldGateTests(unittest.TestCase):
    def test_web_restart_runs_world_audit_and_100_sample_live_gate(self):
        source = (ROOT / "pipeline" / "safe_restart.sh").read_text()
        self.assertIn('audit_world.py', source)
        self.assertIn('flightverse_collision_gate.py', source)
        self.assertIn('--stress 100', source)
        self.assertIn('AEROBRAIN_SKIP_WORLD_GATE', source)
        self.assertIn('ACTIVE_WORLD', source)


if __name__ == "__main__":
    unittest.main()
