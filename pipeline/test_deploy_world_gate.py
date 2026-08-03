import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
import flightverse_collision_gate  # noqa: E402


class DeployWorldGateTests(unittest.TestCase):
    VALID_EFFECTS = {
        "budget": {"active": 1400, "heavy": 240},
        "active": 0,
        "peak": 0,
        "drawBatches": 5,
        "softAlpha": True,
        "shockwaveViewportCap": 0.35,
    }

    def test_arsenal_run_reapplies_ground_aim_after_navigation(self):
        cdp = object()
        with (
            mock.patch.object(
                flightverse_collision_gate,
                "_wait_for_world_ready",
                return_value={"done": True},
            ) as wait_ready,
            mock.patch.object(
                flightverse_collision_gate,
                "aim_fire_control_at_ground",
                return_value=True,
            ) as aim_ground,
        ):
            self.assertTrue(
                flightverse_collision_gate.prepare_ground_arsenal(cdp, 120)
            )

        wait_ready.assert_called_once_with(cdp, 120)
        aim_ground.assert_called_once_with(cdp)

    def _run_web_restart(
        self,
        *,
        target: str = "web",
        curl_status: int = 0,
        launchctl_status: int = 0,
        preflight_failure: str | None = None,
        extra_env: dict[str, str] | None = None,
    ):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            root = folder / "root"
            pipeline = root / "pipeline"
            mock_bin = folder / "mock-bin"
            trace = folder / "trace.log"
            pipeline.mkdir(parents=True)
            mock_bin.mkdir()
            script = pipeline / "safe_restart.sh"
            shutil.copy(ROOT / "pipeline" / "safe_restart.sh", script)
            gzip_assets = pipeline / "gzip_assets.sh"
            gzip_assets.write_text('#!/bin/bash\nprintf "gzip\\n" >> "$TRACE"\n')
            gzip_assets.chmod(0o755)

            def mock(name: str, body: str):
                path = mock_bin / name
                path.write_text(f"#!/bin/bash\n{body}\n")
                path.chmod(0o755)

            mock("launchctl", (
                'printf "launchctl:%s\\n" "$*" >> "$TRACE"\n'
                f'exit {launchctl_status}'
            ))
            mock("curl", (
                'printf "curl:%s\\n" "$*" >> "$TRACE"\n'
                f'exit {curl_status}'
            ))
            mock("sleep", "exit 0")
            mock("tail", "exit 0")
            mock("python3", """
printf "python:%s\\n" "$*" >> "$TRACE"
stdin=$(cat)
if [[ "$stdin" == *sqlite3* ]]; then
  echo 0
  exit 0
fi
case "$*" in
  *audit_world.py*) printf "audit\\n" >> "$TRACE"; [[ "$PREFLIGHT_FAILURE" == audit ]] && exit 1 ;;
  *world_runtime_sweep.py*) printf "runtime\\n" >> "$TRACE"; [[ "$PREFLIGHT_FAILURE" == sweep ]] && exit 1 ;;
  *flightverse_collision_gate.py*) printf "flight\\n" >> "$TRACE"; [[ "$PREFLIGHT_FAILURE" == collision ]] && exit 1 ;;
esac
echo world-a
""")
            env = {
                **os.environ,
                "PATH": f"{mock_bin}:{os.environ['PATH']}",
                "TRACE": str(trace),
                "PREFLIGHT_FAILURE": preflight_failure or "",
                **(extra_env or {}),
            }
            result = subprocess.run(
                ["bash", str(script), target],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            return result, trace.read_text().splitlines()

    def test_web_preflight_completes_before_kickstart(self):
        result, trace = self._run_web_restart()

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertLess(trace.index("gzip"), trace.index("audit"))
        self.assertLess(trace.index("audit"), trace.index("runtime"))
        self.assertLess(trace.index("runtime"), trace.index("flight"))
        launchctl_call = next(row for row in trace if row.startswith("launchctl:"))
        self.assertLess(trace.index("flight"), trace.index(launchctl_call))
        curl_call = next(row for row in trace if row.startswith("curl:"))
        self.assertIn("/api/healthz", curl_call)
        self.assertLess(trace.index(launchctl_call), trace.index(curl_call))

    def test_web_restart_fails_when_post_restart_health_never_succeeds(self):
        result, trace = self._run_web_restart(curl_status=1)

        self.assertNotEqual(0, result.returncode)
        self.assertTrue(any(row.startswith("launchctl:") for row in trace))
        self.assertEqual(20, sum(row.startswith("curl:") for row in trace))

    def test_web_restart_fails_when_kickstart_fails(self):
        result, trace = self._run_web_restart(launchctl_status=1)

        self.assertNotEqual(0, result.returncode)
        self.assertTrue(any(row.startswith("launchctl:") for row in trace))
        self.assertFalse(any(row.startswith("curl:") for row in trace))

    def test_each_failed_web_preflight_prevents_every_kickstart(self):
        for stage in ("audit", "sweep", "collision"):
            with self.subTest(stage=stage):
                result, trace = self._run_web_restart(preflight_failure=stage)

                self.assertNotEqual(0, result.returncode)
                self.assertFalse(any(row.startswith("launchctl:") for row in trace))

    def test_each_failed_both_preflight_prevents_worker_and_web_kickstart(self):
        for stage in ("audit", "sweep", "collision"):
            with self.subTest(stage=stage):
                result, trace = self._run_web_restart(
                    target="both", preflight_failure=stage)

                self.assertNotEqual(0, result.returncode)
                self.assertIn(
                    {"audit": "audit", "sweep": "runtime", "collision": "flight"}[stage],
                    trace,
                )
                self.assertFalse(any(row.startswith("launchctl:") for row in trace))

    def test_worker_failure_prevents_web_restart_in_both_mode(self):
        result, trace = self._run_web_restart(target="both", launchctl_status=1)

        self.assertNotEqual(0, result.returncode)
        launchctl_calls = [row for row in trace if row.startswith("launchctl:")]
        self.assertEqual(1, len(launchctl_calls))
        self.assertIn("com.aerobrain.worker", launchctl_calls[0])
        self.assertFalse(any("com.aerobrain.web" in row for row in launchctl_calls))
        self.assertFalse(any(row.startswith("curl:") for row in trace))

    def test_break_glass_requires_double_confirmation_and_web_only(self):
        result, trace = self._run_web_restart(extra_env={"AEROBRAIN_SKIP_WORLD_GATE": "1"})
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(any(row.startswith("launchctl:") for row in trace))

        result, trace = self._run_web_restart(
            target="both",
            extra_env={
                "AEROBRAIN_SKIP_WORLD_GATE": "1",
                "AEROBRAIN_BREAK_GLASS_RECOVERY": "I_UNDERSTAND_NO_WORLD_GATE",
            },
        )
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(any(row.startswith("launchctl:") for row in trace))

        result, trace = self._run_web_restart(extra_env={
            "AEROBRAIN_SKIP_WORLD_GATE": "1",
            "AEROBRAIN_BREAK_GLASS_RECOVERY": "I_UNDERSTAND_NO_WORLD_GATE",
        })
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertTrue(any(row.startswith("launchctl:") for row in trace))
        self.assertIn("MANUAL_WORLD_GATE_REQUIRED", result.stderr)

    def test_web_restart_runs_world_audit_and_100_sample_live_gate(self):
        source = (ROOT / "pipeline" / "safe_restart.sh").read_text()
        self.assertIn('audit_world.py', source)
        self.assertIn('flightverse_collision_gate.py', source)
        self.assertIn('--stress 100', source)
        self.assertIn('AEROBRAIN_SKIP_WORLD_GATE', source)
        self.assertIn('ACTIVE_WORLD', source)

    def test_live_sample_requires_model_sized_collision_envelope(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 1.2,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": 4,
        }

        failures = flightverse_collision_gate.validate_live_sample(sample)

        self.assertIn("collision_envelope", [row["reason"] for row in failures])

    def test_live_sample_requires_finite_camera_collision_telemetry(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": math.nan,
        }

        failures = flightverse_collision_gate.validate_live_sample(sample)

        self.assertIn("camera_telemetry", [row["reason"] for row in failures])

    def test_live_sample_requires_glb_bound_envelope_and_active_chase_camera(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "fallback",
            "customDrone": False,
            "cameraRig": "fpv",
            "cameraCollisionChecks": 0,
            "cameraCollisionHits": 0,
        }

        reasons = [
            row["reason"]
            for row in flightverse_collision_gate.validate_live_sample(sample)
        ]

        self.assertIn("collision_envelope_source", reasons)
        self.assertIn("camera_integration", reasons)

    def test_fpv_camera_requires_zero_collision_work(self):
        self.assertEqual(
            [],
            flightverse_collision_gate.validate_fpv_camera({
                "cameraRig": "fpv",
                "cameraCollisionChecks": 0,
                "cameraCollisionHits": 0,
            }),
        )
        reasons = [
            row["reason"]
            for row in flightverse_collision_gate.validate_fpv_camera({
                "cameraRig": "fpv",
                "cameraCollisionChecks": 1,
                "cameraCollisionHits": 1,
            })
        ]
        self.assertIn("fpv_camera_isolation", reasons)

    def test_valid_live_sample_has_no_failures(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": 4,
            "effects": self.VALID_EFFECTS,
        }

        self.assertEqual(
            [],
            flightverse_collision_gate.validate_live_sample(sample),
        )

    def test_clear_chase_camera_still_runs_collision_checks_without_forced_hit(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": 0,
            "effects": self.VALID_EFFECTS,
        }

        self.assertEqual(
            [],
            flightverse_collision_gate.validate_live_sample(sample),
        )

    def test_live_gate_requires_observed_fire_explosion_and_reload_evidence(self):
        failures = flightverse_collision_gate.validate_stress_actions({
            "attempts": 5,
            "fired_delta": 0,
            "exploded_delta": 0,
            "reloads": 0,
        })

        self.assertEqual(
            {"fire_not_observed", "explosion_not_observed", "reload_not_observed"},
            {row["reason"] for row in failures},
        )

    def test_arsenal_gate_requires_selection_ammo_model_projectile_and_impact(self):
        valid = [{
            "key": key,
            "selected": key,
            "ammo_before": 4,
            "ammo_after": 3,
            "fired_delta": 8 if key == "sw" else 1,
            "impact_delta": 1,
            "impact_kind": "structure",
            "model_ready": True,
            "projectiles": 0,
            "effect_emitted_delta": 12,
            "effect_peak": 96,
            "effect_budget": 520,
            "effect_draw_batches": 5,
        } for key in flightverse_collision_gate.NEW_WEAPON_KEYS]
        self.assertEqual(
            [],
            flightverse_collision_gate.validate_arsenal_actions(valid),
        )

        invalid = [dict(row) for row in valid]
        invalid[0].update({
            "ammo_after": 4,
            "fired_delta": 0,
            "impact_delta": 0,
            "model_ready": False,
        })
        reasons = {
            row["reason"]
            for row in flightverse_collision_gate.validate_arsenal_actions(invalid)
            if row.get("weapon") == "ac"
        }
        self.assertEqual({
            "ammo_not_consumed",
            "projectile_not_observed",
            "weapon_model_not_ready",
            "weapon_impact_not_observed",
        }, reasons)

    def test_effect_gate_rejects_unbounded_or_unbatched_particles(self):
        valid = {"run": 1, "effects": self.VALID_EFFECTS}
        self.assertEqual(
            [],
            flightverse_collision_gate.validate_effect_snapshot(valid),
        )
        invalid = {
            **valid,
            "effects": {
                **self.VALID_EFFECTS,
                "active": 1401,
                "drawBatches": 1401,
                "softAlpha": False,
            },
        }
        self.assertEqual(
            "weapon_effect_budget",
            flightverse_collision_gate.validate_effect_snapshot(invalid)[0]["reason"],
        )

    def test_terrain_only_live_sample_does_not_require_structural_collision(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": False,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["terrain"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": 4,
            "effects": self.VALID_EFFECTS,
        }

        self.assertEqual(
            [],
            flightverse_collision_gate.validate_live_sample(
                sample, requires_structural_collision=False),
        )


if __name__ == "__main__":
    unittest.main()
