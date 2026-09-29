"""Regression tests, second hardening pass: analyze_clip end-to-end, republish ordering,
orphan kill outside the DB transaction, route_splat strict, scenes perms, env overrides,
ortho thumbnails + backfill + manifest/index wiring."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))

import backfill_thumbs  # noqa: E402
import build_index  # noqa: E402
import compute_policy  # noqa: E402
import jobs  # noqa: E402
import scenes  # noqa: E402
import tresd_publish  # noqa: E402


class AnalyzeClipEndToEndTests(unittest.TestCase):
    def _run(self, deep, n_frames):
        import analyze
        with tempfile.TemporaryDirectory() as td:
            v = Path(td)
            fdir = v / "frames" / "DJI_X"
            fdir.mkdir(parents=True)
            for i in range(n_frames):
                (fdir / f"f_{i:04d}.jpg").write_bytes(b"\xff")
            seen = {}

            def vision(prompt, sample, keys):
                seen["prompt"], seen["n"] = prompt, len(sample)
                return 'ok {"summary": "s", "scene_type": "urbano", "tags": ["a"], "travel_score": 7}'
            with mock.patch.object(analyze, "VAULT", v), \
                    mock.patch.object(analyze, "gemini_vision", side_effect=vision), \
                    mock.patch.object(analyze, "deepseek_text",
                                      return_value='{"director_notes": ["n"], "story_arc": "a", "uses": []}'):
                data = analyze.analyze_clip("DJI_X", {}, deep=deep)
            self.assertEqual(data, json.loads((v / "ai" / "DJI_X.json").read_text()))
        return data, seen

    def test_analyze_clip_runs_and_reports_real_spacing(self):
        data, seen = self._run(False, 100)
        self.assertEqual("urbano", data["scene_type"])
        self.assertEqual(8, seen["n"])
        self.assertIn("un frame cada 28s", seen["prompt"])

    def test_analyze_clip_short_clip_and_deep(self):
        data, seen = self._run(True, 5)
        self.assertEqual(5, data["frames_analyzed"])
        self.assertIn("un frame cada 2s", seen["prompt"])
        self.assertEqual("a", data["story_arc"])


class RepublishOrderTests(unittest.TestCase):
    def test_stale_dsm_purge_happens_right_before_meta_write(self):
        src = (HERE / "tresd_publish.py").read_text()
        body = src[src.index("def main():"):]
        purge = body.index("purge_stale_dsm_derived(out)")
        self.assertGreater(purge, body.index("swap_model_dir(new_model"))
        self.assertGreater(purge, body.index("sidecars .gz"))
        self.assertLess(purge, body.index('meta = {\n        "clip_id"'))
        self.assertLess(purge, body.index('atomic_write_json(out / "meta.json"'))


class OrphanKillOutsideTransactionTests(unittest.TestCase):
    def test_kill_container_runs_after_the_db_commit(self):
        with tempfile.TemporaryDirectory() as td:
            old = jobs.DB, jobs.JOB_LOG_DIR
            jobs.DB, jobs.JOB_LOG_DIR = Path(td) / "j.db", Path(td) / "logs"
            try:
                jobs.init()
                j = jobs.enqueue("3d", "x", {})
                with jobs._conn() as c:
                    c.execute("UPDATE jobs SET status='running', pid=NULL, container='odm-gpu-z' "
                              "WHERE id=?", (j["id"],))
                seen = {}

                def fake_kill(name, backend=None):
                    # otra conexión debe poder ESCRIBIR: la transacción de init ya cerró
                    with jobs._conn() as c2:
                        c2.execute("UPDATE jobs SET label='free' WHERE id=?", (j["id"],))
                    seen["ok"] = True
                    return True, ""
                with mock.patch.object(jobs, "kill_container", side_effect=fake_kill):
                    jobs.init(orphan_kinds=("3d",))
                self.assertTrue(seen.get("ok"))
                self.assertEqual("error", jobs.get(j["id"])["status"])
            finally:
                jobs.DB, jobs.JOB_LOG_DIR = old


class ComputePolicySplatTests(unittest.TestCase):
    def test_route_splat_is_strict_when_pc_only(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("AEROBRAIN_COMPUTE", None)
            r = compute_policy.route_splat({"backend": "metal", "best_available": True})
        self.assertEqual("strict", r["backend_policy"])
        self.assertEqual("cuda", r["backend"])
        with mock.patch.dict(os.environ, {"AEROBRAIN_COMPUTE": "local"}):
            self.assertNotIn("backend_policy", compute_policy.route_splat({"backend": "metal"}))


class ScenesPermissionTests(unittest.TestCase):
    def test_scene_json_is_world_readable(self):
        with tempfile.TemporaryDirectory() as td:
            with mock.patch.object(scenes, "SCENES_DIR", Path(td)):
                sc = scenes.create_scene("Casa", {"lat": 1, "lon": 2}, ["A"], [])
                mode = stat.S_IMODE((Path(td) / f"{sc['id']}.json").stat().st_mode)
        self.assertEqual(0o644, mode)


class TestIsolationTests(unittest.TestCase):
    def test_run_all_tests_and_perf_honor_env_overrides(self):
        code = ("import jobs, perf; print(jobs.JOB_LOG_DIR); print(perf.ERRLOG)")
        with tempfile.TemporaryDirectory() as td:
            env = dict(os.environ, AEROBRAIN_JOB_LOG_DIR=f"{td}/jl", AEROBRAIN_ERRLOG=f"{td}/e.jsonl",
                       PYTHONPATH=str(HERE))
            out = subprocess.run([sys.executable, "-c", code], env=env, cwd=HERE,
                                 capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual([f"{td}/jl", f"{td}/e.jsonl"], out)

    def test_run_all_tests_child_env_points_at_a_temp_sandbox(self):
        import run_all_tests
        env = run_all_tests._env()
        self.assertNotIn("drone-vault", env["AEROBRAIN_JOB_LOG_DIR"])
        self.assertNotIn("drone-vault", env["AEROBRAIN_ERRLOG"])


def _png(path, w, h, alpha=True):
    from PIL import Image
    im = Image.new("RGBA" if alpha else "RGB", (w, h), (10, 120, 30, 200) if alpha else (10, 120, 30))
    im.save(path)


class ThumbTests(unittest.TestCase):
    def test_make_thumb_caps_width_keeps_aspect_and_alpha(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / "ortho.webp", Path(td) / "ortho_thumb.webp"
            _png(src, 2000, 1000)
            self.assertTrue(tresd_publish.make_ortho_thumb(src, dst))
            with Image.open(dst) as im:
                self.assertEqual((480, 240), im.size)
                self.assertIn("A", im.getbands())
            self.assertLess(dst.stat().st_size, src.stat().st_size)
            small = Path(td) / "s.png"
            _png(small, 100, 50)
            self.assertTrue(tresd_publish.make_ortho_thumb(small, Path(td) / "t2.webp"))
            with Image.open(Path(td) / "t2.webp") as im:
                self.assertEqual((100, 50), im.size)

    def test_corrupt_source_leaves_no_partial_thumb(self):
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / "ortho.webp", Path(td) / "ortho_thumb.webp"
            src.write_bytes(b"not an image")
            self.assertFalse(tresd_publish.make_ortho_thumb(src, dst))
            self.assertEqual([src.name], [p.name for p in Path(td).iterdir()])

    def test_refresh_removes_a_stale_thumb_when_regeneration_fails(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "ortho.webp").write_bytes(b"broken")
            (out / "ortho_thumb.webp").write_bytes(b"old thumb from another run")
            self.assertFalse(tresd_publish.refresh_ortho_thumb(out))
            self.assertFalse((out / "ortho_thumb.webp").exists())

    def test_backfill_is_idempotent_and_skips_fresh_thumbs(self):
        with tempfile.TemporaryDirectory() as td:
            models = Path(td) / "models"
            for name in ("A", "B"):
                (models / name).mkdir(parents=True)
                (models / name / "meta.json").write_text("{}")
                _png(models / name / "ortho.webp", 1200, 800)
            (models / "C").mkdir()
            (models / "C" / "meta.json").write_text("{}")          # sin ortho
            first = backfill_thumbs.backfill(models)
            self.assertEqual(["A", "B"], first["created"])
            self.assertEqual(["C"], first["no_ortho"])
            second = backfill_thumbs.backfill(models)
            self.assertEqual([], second["created"])
            self.assertEqual(["A", "B"], second["skipped"])
            os.utime(models / "A" / "ortho.webp", (2e9, 2e9))      # ortho más nueva → regenera
            third = backfill_thumbs.backfill(models)
            self.assertEqual(["A"], third["created"])

    def test_build_index_exposes_thumb_only_when_present(self):
        with tempfile.TemporaryDirectory() as td:
            models = Path(td)
            for name in ("A", "B"):
                (models / name).mkdir()
                (models / name / "meta.json").write_text(json.dumps({"clip_id": name}))
            (models / "A" / "ortho_thumb.webp").write_bytes(b"x")
            by = {m["clip_id"]: m for m in build_index.load_models(models)}
        self.assertEqual("data/models/A/ortho_thumb.webp", by["A"]["thumb"])
        self.assertNotIn("thumb", by["B"])

    def test_scene_manifest_prefers_thumb_poster_with_ortho_fallback(self):
        src = (HERE / "scene_manifest.py").read_text()
        self.assertIn('ortho_thumb.webp").exists()', src)
        self.assertIn("meta['ortho_asset']", src)


if __name__ == "__main__":
    unittest.main()
