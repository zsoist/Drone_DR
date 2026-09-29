"""SRT → vt (tiempo de video) y consumidores (odm_prep, capture_quality) por tiempo, no por índice."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

import capture_quality as cq
import odm_prep
import srt_parser


def synth_srt(path: Path, seconds=30, prelock=5, drop=(15, 20)):
    """Un bloque por segundo de video. Sin lock (0,0) los primeros `prelock` s y en [drop)."""
    base = datetime(2026, 7, 4, 16, 9, 33)
    out = []
    for s in range(seconds):
        h, m, sec = s // 3600, (s % 3600) // 60, s % 60
        nolock = s < prelock or drop[0] <= s < drop[1]
        lat, lon = (0.0, 0.0) if nolock else (4.0 + 0.0001 * s, -74.0 + 0.0001 * s)
        out.append(
            f"{s + 1}\n00:{m:02d}:{sec:02d},000 --> 00:{m:02d}:{sec:02d},033\n"
            f'<font size="28">FrameCnt: {s + 1}, DiffTime: 33ms\n'
            f"{(base + timedelta(seconds=s)).strftime('%Y-%m-%d %H:%M:%S')}.000\n"
            f"[iso: 100] [shutter: 1/120.0] [fnum: 170] [ev: 0] [latitude: {lat}] "
            f"[longitude: {lon}] [rel_alt: {s * 0.5:.3f} abs_alt: 2500.000] [ct: 5000] </font>\n")
    path.write_text("\n".join(out))


class SrtTimebase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.srt = Path(self.tmp.name) / "a.SRT"
        synth_srt(self.srt)
        self.track = srt_parser.parse_srt(self.srt)
        self.pts = self.track["points"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_vt_present_and_gaps_dropped(self):
        vts = [p["vt"] for p in self.pts]
        self.assertEqual(vts, [float(v) for v in list(range(5, 15)) + list(range(20, 30))])
        self.assertEqual(len(self.pts), 20)
        for p in self.pts:                                   # formato previo intacto
            self.assertTrue({"t", "lat", "lon", "rel_alt", "abs_alt", "iso", "shutter"} <= p.keys())
            self.assertIsInstance(p["t"], str)
        self.assertEqual(self.track["stats"]["duration_s"], 20)
        self.assertEqual(self.track["stats"]["video_span_s"], 24.0)

    def test_index_mapping_was_wrong_time_lookup_is_right(self):
        # video t=22 s: por índice sería pts[22] (fuera de rango); por tiempo → punto vt=22
        self.assertAlmostEqual(srt_parser.point_at(self.pts, 22)["lat"], 4.0022)
        self.assertAlmostEqual(srt_parser.point_at(self.pts, 7.2)["lat"], 4.0007)
        self.assertNotAlmostEqual(self.pts[7]["lat"], srt_parser.point_at(self.pts, 7)["lat"])
        # en el hueco → vecino más cercano
        self.assertAlmostEqual(srt_parser.point_at(self.pts, 16)["lat"], 4.0014)
        self.assertAlmostEqual(srt_parser.point_at(self.pts, 19)["lat"], 4.0020)
        # extremos
        self.assertAlmostEqual(srt_parser.point_at(self.pts, 0)["lat"], 4.0005)
        self.assertAlmostEqual(srt_parser.point_at(self.pts, 999)["lat"], 4.0029)

    def test_point_at_legacy_tracks_without_vt_fall_back_to_index(self):
        legacy = [{"lat": float(i)} for i in range(5)]
        self.assertEqual(srt_parser.point_at(legacy, 2.7)["lat"], 2.0)
        self.assertEqual(srt_parser.point_at(legacy, 99)["lat"], 4.0)
        self.assertIsNone(srt_parser.point_at([], 1))

    def test_frame_time_half_frame_offset(self):
        self.assertEqual(odm_prep.frame_time(Path("f_0001.jpg"), 0.5), 0.0)
        self.assertEqual(odm_prep.frame_time(Path("f_0011.jpg"), 0.5), 20.0)
        self.assertEqual(odm_prep.frame_time(Path("f_0004.jpg"), 1.0), 3.0)

    def test_odm_prep_geotags_by_video_time(self):
        def fake_popen(cmd, *a, **k):
            out = Path(cmd[-1]).parent
            for n in (1, 8, 11, 15):                         # t = 0, 14, 20, 28
                (out / f"f_{n:04d}.jpg").write_bytes(b"x")
            return mock.Mock(poll=lambda: 0, returncode=0)
        with tempfile.TemporaryDirectory() as td, \
                mock.patch.object(odm_prep, "find_raw", return_value=Path("raw.mp4")), \
                mock.patch.object(odm_prep, "_load_pts", return_value=self.pts), \
                mock.patch.object(odm_prep.subprocess, "Popen", side_effect=fake_popen):
            args, n = odm_prep._extract_source(Path(td), Path("/final"), "c", "", None, 0.5, 100)
        self.assertEqual(n, 4)
        lats = {}
        cur = None
        for a in args:
            if a.startswith("-GPSLatitude="):
                cur = float(a.split("=")[1])
            if a.startswith("/final/"):
                lats[Path(a).name] = cur
        self.assertAlmostEqual(lats["f_0001.jpg"], 4.0005)   # t=0 → primer punto (antes del lock)
        self.assertAlmostEqual(lats["f_0008.jpg"], 4.0014)
        self.assertAlmostEqual(lats["f_0011.jpg"], 4.0020)
        self.assertAlmostEqual(lats["f_0015.jpg"], 4.0028)

    def test_choose_frames_uses_vt_and_ignores_gap_positions(self):
        times = [float(t) for t in range(0, 30)]
        sharp = {t: 10.0 for t in times}
        chosen = cq.choose_frames(self.pts, times, sharp, "preview")
        got = [c["t"] for c in chosen]
        # frames dentro del hueco (>2.5s de un punto) no tienen posición → se conservan sin filtro
        for t in (17.0, 18.0):
            self.assertIn(t, got)

    def test_budget_decimates_uniformly_keeping_the_tail(self):
        pts = [{"t": float(i), "vt": float(i), "lon": -74.0 + i * 1e-3, "lat": 4.0} for i in range(3000)]
        times = [float(i) for i in range(3000)]
        sharp = {t: 5.0 for t in times}
        with mock.patch.dict(cq.PROFILES, {"tiny": {"budget": 100, "min_dist_m": 0.1, "blur_drop": 0.0}}):
            chosen = cq.choose_frames(pts, times, sharp, "tiny")
        got = [c["t"] for c in chosen]
        self.assertEqual(len(got), 100)
        self.assertEqual(got[0], 0.0)
        self.assertEqual(got[-1], 2999.0)                    # la cola ya no se pierde
        self.assertEqual(got, sorted(set(got)))
        steps = [b - a for a, b in zip(got, got[1:])]
        self.assertLess(max(steps) - min(steps), 3)          # uniforme

    def test_analyze_uses_manifest_duration_and_writes_atomically(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            (vault / "manifest").mkdir()
            (vault / "manifest" / "c1.json").write_text(json.dumps({"duration_s": 123.0}))
            seen = {}

            def fake_sample(video, dur, n=24):
                seen["dur"] = dur
                return [{"t": 1, "sharp": 5.0, "bright": 100.0}]
            with mock.patch.object(cq, "VAULT", vault), \
                    mock.patch.object(cq, "CACHE", vault / "manifest" / "capture"), \
                    mock.patch.object(cq, "_video_for", return_value=Path("v.mp4")), \
                    mock.patch.object(cq, "sample_frames", side_effect=fake_sample):
                rep = cq.analyze("c1")
                self.assertEqual(seen["dur"], 123.0)
                self.assertEqual(rep["duration_s"], 123.0)
                files = sorted(p.name for p in (vault / "manifest" / "capture").iterdir())
                self.assertEqual(files, ["c1.json"])         # sin .tmp residual
                json.loads((vault / "manifest" / "capture" / "c1.json").read_text())


if __name__ == "__main__":
    unittest.main()
