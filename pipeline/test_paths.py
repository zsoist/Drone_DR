"""paths.py: filesystem roots and their env overrides (each case in a fresh interpreter)."""
import os
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _paths(**env) -> dict:
    clean = {k: v for k, v in os.environ.items()
             if k not in ("AEROBRAIN_VAULT", "AEROBRAIN_KEYS_ENV")}
    code = ("import paths, json; print(json.dumps({k: str(getattr(paths, k)) "
            "for k in ('REPO', 'PIPE', 'WEB', 'VAULT', 'KEYS_ENV')}))")
    out = subprocess.run([sys.executable, "-c", code], cwd=HERE, capture_output=True, text=True,
                         env={**clean, "PYTHONPATH": str(HERE), **env}, check=True).stdout
    import json
    return json.loads(out)


class PathsTests(unittest.TestCase):
    def test_defaults_point_at_production_locations(self):
        p = _paths()
        self.assertEqual("/Volumes/SSD/drone-vault", p["VAULT"])
        self.assertEqual("/Volumes/SSD/_system/claude/.api-keys.env", p["KEYS_ENV"])

    def test_repo_relative_roots_are_derived_from_the_module_location(self):
        p = _paths()
        self.assertEqual(str(HERE.parent), p["REPO"])
        self.assertEqual(str(HERE), p["PIPE"])
        self.assertEqual(str(HERE.parent / "web"), p["WEB"])

    def test_env_overrides_vault_and_keys_file(self):
        p = _paths(AEROBRAIN_VAULT="/tmp/vault-x", AEROBRAIN_KEYS_ENV="/tmp/keys-x.env")
        self.assertEqual("/tmp/vault-x", p["VAULT"])
        self.assertEqual("/tmp/keys-x.env", p["KEYS_ENV"])
        self.assertEqual(str(HERE.parent), p["REPO"])           # overrides never move the repo


if __name__ == "__main__":
    unittest.main()
