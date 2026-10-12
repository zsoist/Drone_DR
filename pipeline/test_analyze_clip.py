"""analyze.py: clip analysis end to end and frame sampling."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))


class AnalyzeClipEndToEndTests(unittest.TestCase):
    def _run(self, deep, n_frames):
        import analyze
        import insights
        from test_visual_ai import fixture_insight
        with tempfile.TemporaryDirectory() as td:
            v = Path(td)
            fdir = v / "frames" / "DJI_X"
            fdir.mkdir(parents=True)
            for i in range(n_frames):
                (fdir / f"f_{i+1:04d}.jpg").write_bytes(b"\xff")
            (v / "manifest").mkdir()
            (v / "manifest/DJI_X.json").write_text(json.dumps({"duration_s": n_frames * 2}))
            seen = {}

            def vision(prompt, sample, keys, schema):
                seen["prompt"], seen["n"] = prompt, len(sample)
                value = fixture_insight()
                value["best_frame_times"] = [0]
                return json.dumps(value), {"input_tokens": 1, "output_tokens": 1}
            with mock.patch.object(analyze, "VAULT", v), \
                    mock.patch.object(insights.router, "gemini_insight", side_effect=vision), \
                    mock.patch.object(insights.router, "embed_text", return_value=[1] + [0] * 767), \
                    mock.patch.object(analyze, "deepseek_text",
                                      return_value='{"director_notes": ["n"], "story_arc": "a", "uses": []}'):
                data = analyze.analyze_clip("DJI_X", {}, deep=deep)
            self.assertEqual(data, json.loads((v / "ai" / "DJI_X.json").read_text()))
        return data, seen

    def test_analyze_clip_runs_and_reports_real_spacing(self):
        data, seen = self._run(False, 100)
        self.assertEqual("naturaleza", data["scene_type"])
        self.assertEqual(8, seen["n"])
        self.assertEqual([0, 28, 56, 84, 114, 142, 170, 198], data["sampled_frame_times"])

    def test_analyze_clip_short_clip_and_deep(self):
        data, seen = self._run(True, 5)
        self.assertEqual(5, data["frames_analyzed"])
        self.assertEqual([0, 2, 4, 6, 8], data["sampled_frame_times"])
        self.assertEqual("a", data["story_arc"])


class AnalyzeSamplingTests(unittest.TestCase):
    def test_sample_covers_the_whole_clip(self):
        import analyze
        frames = list(range(100))
        sample, spacing = analyze.sample_frames(frames, 8)
        self.assertEqual(8, len(sample))
        self.assertEqual(0, sample[0])
        self.assertEqual(99, sample[-1])
        self.assertEqual(sorted(set(sample)), sample)
        self.assertEqual(28, spacing)                    # ~ (99/7) frames * 2 s
        short, sp = analyze.sample_frames([1, 2, 3], 8)
        self.assertEqual(([1, 2, 3], 2), (short, sp))

    def test_all_flag_skips_every_analysed_clip_except_trips_index(self):
        import analyze
        with tempfile.TemporaryDirectory() as td:
            v = Path(td)
            (v / "ai").mkdir()
            for n in ("DJI_1.json", "UP_2.json", "trips.json"):
                (v / "ai" / n).write_text("{}")
            for cid in ("DJI_1", "UP_2", "UP_3", "trips"):
                (v / "frames" / cid).mkdir(parents=True)
            done_calls = []
            with mock.patch.object(analyze, "VAULT", v), \
                    mock.patch.object(analyze, "load_keys", return_value={}), \
                    mock.patch.object(analyze, "analyze_clip",
                                      side_effect=lambda cid, keys: done_calls.append(cid)), \
                    mock.patch.object(sys, "argv", ["analyze.py", "--all"]):
                analyze.main()
        self.assertEqual(["UP_3", "trips"], done_calls)


if __name__ == "__main__":
    unittest.main()
