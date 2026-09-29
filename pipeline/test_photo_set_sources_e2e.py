"""END-TO-END: photo-set sources (`set:<set>/<pass>` tokens) through the whole 3D job.

Temp vault, fake photo sets on disk -> POST /api/odm payload -> the worker's real run_3d()
with ONLY the heavy calls mocked (docker/ODM/CUDA, tresd_publish, browser gate, GLB) ->
odm_prep runs for real (exiftool) -> fake ODM opensfm output -> meta / scene store / scene.v2 /
system.json / API responses asserted, then the web helpers are executed under node against the
produced JSON.  Covers photo-only, video+photos (FULL), and a PARTIAL merge (photo pass that
fails to co-register: scene not promoted, splat not auto-queued).

No GPU, no docker, no live vault, no real jobs.
"""
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server
import jobs
import odm_prep
import scene_manifest
import scenes
import worker
from test_odm_photo_set import HAVE_EXIFTOOL, make_jpg
from test_server_hardening import LOCAL

REPO = Path(__file__).resolve().parent.parent
VIDEO = "DJI_20260315121500_0001_D"
SET_A, SET_B = "Casa A", "Casa B"
TOK_NADIR = f"set:{SET_A}/nadir"
TOK_ORBITA = f"set:{SET_A}/orbita"
TOK_B = f"set:{SET_B}/unica"


class E2E(unittest.TestCase):
    """Base: patched temp vault + real HTTP server + the worker's run_3d with heavy calls mocked."""

    # how many images of each source the fake SfM registers; override per test
    register = None

    def setUp(self):
        if not HAVE_EXIFTOOL:
            self.skipTest("exiftool no disponible")
        self._td = tempfile.TemporaryDirectory()
        self.vault = Path(self._td.name)
        for sub in ("raw", "manifest", "tracks", "models", "odm", "photos", "ai", "splats", "thumbs",
                    "proxies", "frames", "reels"):
            (self.vault / sub).mkdir()
        self._patches = [
            mock.patch.object(server, "VAULT", self.vault),
            mock.patch.object(worker, "VAULT", self.vault),
            mock.patch.object(odm_prep, "VAULT", self.vault),
            mock.patch.object(scene_manifest, "VAULT", self.vault),
            mock.patch.object(scenes, "SCENES_DIR", self.vault / "manifest" / "scenes"),
            mock.patch.object(jobs, "DB", self.vault / "jobs.db"),
            mock.patch.object(jobs, "JOB_LOG_DIR", self.vault / "job_logs"),
            mock.patch.dict(os.environ, {"AEROBRAIN_VAULT": str(self.vault)}),
            mock.patch.object(server.H, "timeout", 30),
        ]
        for p in self._patches:
            p.start()
        jobs.init()
        server._PHOTO_PASS_CACHE.clear()
        self.httpd = server.QuietThreadingHTTPServer(("127.0.0.1", 0), server.H)
        self.t = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.t.start()
        self.register = type(self).register
        self.enqueued = []

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.t.join(timeout=2)
        for p in reversed(self._patches):
            p.stop()
        self._td.cleanup()

    # ------------------------------------------------------------------ fixtures
    def fill_pass(self, set_, pass_, n, lat0=4.65, lon0=-74.05, seed0=0):
        for i in range(n):
            make_jpg(self.vault / "raw" / set_ / pass_ / f"DJI_2026031512{i:02d}_{i:04d}_D.JPG",
                     lat0 + i * 1e-4, lon0, seed=seed0 + i)

    def add_video(self, cid=VIDEO, lon=-74.05, lat=4.65):
        (self.vault / "manifest" / f"{cid}.json").write_text(json.dumps({
            "clip_id": cid, "duration_s": 30, "date": "2026-03-15", "time": "12:15:00",
            "stats": {"max_rel_alt_m": 90, "start": "2026-03-15T12:15:00",
                      "bbox": [lon - 1e-3, lat - 1e-3, lon + 1e-3, lat + 1e-3], "distance_m": 100}}))
        (self.vault / "tracks" / f"{cid}.flight.json").write_text(json.dumps({
            "points": [], "stats": {"max_rel_alt_m": 90, "start": "2026-03-15T12:15:00",
                                    "bbox": [lon - 1e-3, lat - 1e-3, lon + 1e-3, lat + 1e-3]}}))

    def req(self, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=60)
        payload = json.dumps(body).encode() if body is not None else None
        h = dict(LOCAL)
        if payload is not None:
            h["Content-Length"] = str(len(payload))
            h["Content-Type"] = "application/json"
        try:
            c.request(method, path, body=payload, headers=h)
            r = c.getresponse()
            return r.status, json.loads(r.read() or b"{}")
        finally:
            c.close()

    # ------------------------------------------------------------------ mocked heavy calls
    def fake_extract(self, tmp_dir, images, src_cid, prefix, profile, fps, width):
        """Stand-in for the ffmpeg extraction of a video source: 9 GPS-tagged frames."""
        args = []
        for i in range(9):
            name = f"{prefix}f_{i:04d}.jpg"
            make_jpg(tmp_dir / name, None, None, seed=200 + i)
            args += odm_prep._geotag(images / name, {"lat": 4.65 + i * 1e-4, "lon": -74.05, "abs_alt": 90})
        return args, 9

    def fake_run_tracked(self, jid, cmd, timeout=None, **_kw):
        script = Path(cmd[1]).name
        if script == "odm_prep.py":
            with mock.patch.object(sys, "argv", ["odm_prep.py", *cmd[2:]]), \
                    mock.patch.object(odm_prep, "_extract_source", self.fake_extract):
                try:
                    odm_prep.main()
                except SystemExit as exc:
                    return 1 if exc.code not in (None, 0) else 0
            return 0
        if script == "tresd_publish.py":
            cid = cmd[2]
            mdir = self.vault / "models" / cid
            mdir.mkdir(parents=True, exist_ok=True)
            n = len(list((self.vault / "odm" / f"proj_{cid}" / "images").glob("*.jpg")))
            (mdir / "meta.json").write_text(json.dumps({
                "clip_id": cid, "title": "fixture", "pipeline_mode": "mesh", "has_dsm": False,
                "qa": {"cameras_reconstructed": n, "cameras_total": n, "status": "ok",
                       "gsd_cm_px": 3.1, "area_m2": 12000}}))
            return 0
        raise AssertionError(f"unexpected tracked command: {cmd}")

    def fake_odm(self, jid, container, proj, preset, preset_name, rerun_from=None, stable_dense=False):
        """Fake SfM output derived from the real staged images. `self.register` maps a filename
        prefix (s0_, s1_...) to how many of its images register; default = all."""
        names = sorted(p.name for p in (proj / "images").glob("*.jpg"))
        (proj / "opensfm").mkdir(exist_ok=True)
        (proj / "opensfm" / "image_list.txt").write_text(
            "\n".join(f"/datasets/code/images/{n}" for n in names))
        budget = dict(self.register or {})
        shots = {}
        for n in names:
            pref = n.split("_")[0] + "_"
            left = budget.get(pref, 10 ** 6)
            if left > 0:
                budget[pref] = left - 1
                shots[n] = {}
        (proj / "opensfm" / "reconstruction.json").write_text(json.dumps([{"shots": shots, "points": {}}]))
        return 0

    def run_job(self, spec, jid="3d-e2e"):
        """Run the worker's REAL run_3d for `spec`. Returns the final job row."""
        job = jobs.enqueue("3d", spec["clip_id"], spec)
        job = {**job, "spec": dict(spec)}
        with mock.patch.object(worker.jobstore, "run_tracked", side_effect=self.fake_run_tracked), \
                mock.patch.object(worker, "run_odm_step", side_effect=self.fake_odm), \
                mock.patch.object(worker, "run_odm_cuda",
                                  side_effect=lambda j, proj, preset, name: self.fake_odm(
                                      j["id"], None, proj, preset, name)), \
                mock.patch.object(worker, "browser_gate"), \
                mock.patch.object(worker, "glb_after_publish", return_value=False), \
                mock.patch.object(worker.jobstore, "enqueue",
                                  side_effect=lambda k, l, sp: self.enqueued.append((k, l, sp)) or {"id": "x"}):
            worker.run_3d(job)
        return jobs.get(job["id"])

    def post_odm(self, body):
        """POST /api/odm with enqueue captured. Returns the job spec the worker would receive."""
        captured = []
        with mock.patch.object(server.jobstore, "enqueue",
                               side_effect=lambda k, l, sp: captured.append(sp) or {"id": "job-x"}), \
                mock.patch.object(server.jobstore, "pending", return_value=False):
            code, resp = self.req("POST", "/api/odm", body)
        self.assertEqual(200, code, resp)
        return captured[0], resp

    def meta(self, cid):
        return json.loads((self.vault / "models" / cid / "meta.json").read_text())

    def make_scene(self, spec, title="Casa A"):
        """Scene + version exactly like prepare_scene_version does for a scene job."""
        scene = scenes.create_scene(title, {"lat": 4.65, "lon": -74.05})
        rid, sspec = server.prepare_scene_version(
            scene["id"], spec["sources"], [], "estandar", title, odm_backend="local")
        return scene["id"], rid, sspec


class PhotoOnlyJob(E2E):
    def test_single_photo_pass_job_end_to_end(self):
        self.fill_pass(SET_A, "nadir", 8)
        spec, resp = self.post_odm({"photo_sets": [TOK_NADIR], "preset": "estandar"})
        self.assertEqual([TOK_NADIR], spec["sources"])
        self.assertIsNone(spec["primary_cid"])
        self.assertTrue(spec["clip_id"].startswith("recon_"))

        # scene-bound version of the same job (what "Mejorar escena" builds)
        scene_id, rid, sspec = self.make_scene(spec)
        self.assertEqual(spec["clip_id"], rid)
        self.assertIsNone(sspec["primary_cid"])
        self.assertEqual([TOK_NADIR], sspec["photo_sets"])
        sc = scenes.get_scene(scene_id)
        self.assertEqual([], sc["source_inventory"]["videos"])
        self.assertEqual([TOK_NADIR], sc["source_inventory"]["photo_sets"])
        ev = sc["versions"][0]["source_evidence"][0]
        self.assertEqual("photo_set", ev["kind"])
        self.assertEqual(f"Fotos · {SET_A}/nadir", ev["label"])
        self.assertEqual(8, ev["photo_count"])
        self.assertEqual(f"{SET_A}/nadir/", ev["thumb_rel"][:len(SET_A) + 7])
        self.assertEqual(1.0, ev["gps_coverage"])
        self.assertEqual(4, len(ev["coverage_bbox"]))

        row = self.run_job(sspec)
        self.assertEqual("done", row["status"], row)

        m = self.meta(rid)
        self.assertEqual([TOK_NADIR], m["sources"])
        self.assertEqual("SINGLE", m["reconstruction"]["merge_label"])
        (src,) = m["reconstruction"]["sources"]
        self.assertEqual(TOK_NADIR, src["clip_id"])
        self.assertEqual("photo_set", src["kind"])
        self.assertEqual(f"Fotos · {SET_A}/nadir", src["label"])
        self.assertEqual((8, 8, True), (src["submitted"], src["registered"], src["merged"]))
        self.assertEqual(8, src["photo_count"])
        self.assertTrue(src["thumb_rel"].endswith(".JPG"))
        self.assertEqual(8, m["odm_report"]["by_source"][TOK_NADIR]["registered"])

        sc = scenes.get_scene(scene_id)
        (ver,) = sc["versions"]
        self.assertEqual(("ready", "SINGLE"), (ver["status"], ver["merge_label"]))
        self.assertEqual(rid, sc["active_version"])
        self.assertEqual([TOK_NADIR], ver["effective_sources"])
        self.assertEqual([], ver["dropped_sources"])
        contrib = ver["contributions"][0]
        self.assertEqual(("photo_set", 8, 8, True),
                         (contrib["kind"], contrib["submitted"], contrib["registered"], contrib["merged"]))
        ev = sc["source_evidence"][0]
        self.assertEqual(("integrated", "photo_set", 8), (ev["status"], ev["kind"], ev["photo_count"]))

        # published contract for the 3D / world pages
        man = json.loads((self.vault / "models" / rid / "scene.v2.json").read_text())
        self.assertEqual([TOK_NADIR], man["site"]["effective_sources"])
        self.assertEqual(0, man["site"]["source_count"])          # videos only; photo passes are not clips
        json.dumps(man)

        # system.json (built by the real build_index in a subprocess against the temp vault)
        sysj = json.loads((self.vault / "manifest" / "system.json").read_text())
        model = next(x for x in sysj["models"] if x["clip_id"] == rid)
        self.assertEqual("photo_set", model["reconstruction"]["sources"][0]["kind"])

        # web-facing API
        code, body = self.req("GET", "/api/scenes")
        self.assertEqual(200, code)
        self.assertEqual([TOK_NADIR], body["scenes"][0]["versions"][0]["sources"])
        self.node_checks(body["scenes"][0], model)

    def node_checks(self, scene, model):
        """Run the real web helpers (scene-improve-policy.js) over the produced JSON."""
        if not shutil.which("node"):
            self.skipTest("node no disponible")
        js = r"""
const P = require('./web/scene-improve-policy.js');
const {scene, model} = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const v = scene.versions[0];
const counts = P.countSources(v.sources);
const rows = v.sources.map(id => ({id, durationS: 0}));
const totals = P.validateSelection(rows, P.DEFAULT_LIMITS);
const plan = P.buildImprovementPlan({baseSources: rows.map(r => ({...r, classification: {}})), candidates: []});
console.log(JSON.stringify({counts, labels: v.sources.map(P.sourceLabel), valid: totals.valid,
  photoSets: totals.totals.photoSets, selected: plan.selectedIds,
  reconLabels: model.reconstruction.sources.map(s => P.sourceLabel(s.clip_id))}));
"""
        out = subprocess.run(["node", "-e", js], cwd=REPO, input=json.dumps({"scene": scene, "model": model}),
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(0, out.returncode, out.stderr)
        got = json.loads(out.stdout)
        self.assertEqual(len(scene["versions"][0]["sources"]) - got["counts"]["photoSets"], got["counts"]["videos"])
        self.assertTrue(all(x.startswith("Fotos · ") or not x.startswith("set:") for x in got["labels"]))
        self.assertTrue(got["valid"])
        self.assertEqual(scene["versions"][0]["sources"], got["selected"])


class MixedVideoAndPhotos(E2E):
    def test_video_plus_two_passes_full_merge(self):
        self.add_video()
        self.fill_pass(SET_A, "nadir", 8)
        self.fill_pass(SET_A, "orbita", 7, seed0=40)
        spec, _ = self.post_odm({"clip_id": VIDEO, "sources": [VIDEO],
                                 "photo_sets": [TOK_NADIR, TOK_ORBITA], "preset": "estandar"})
        self.assertEqual([VIDEO, TOK_NADIR, TOK_ORBITA], spec["sources"])
        self.assertEqual(VIDEO, spec["primary_cid"])

        scene_id, rid, sspec = self.make_scene(spec)
        self.assertEqual(VIDEO, sspec["primary_cid"])
        row = self.run_job(sspec)
        self.assertEqual("done", row["status"], row)

        m = self.meta(rid)
        self.assertEqual([VIDEO, TOK_NADIR, TOK_ORBITA], m["sources"])
        recon = m["reconstruction"]
        self.assertEqual("FULL", recon["merge_label"])
        kinds = {r["clip_id"]: r.get("kind") for r in recon["sources"]}
        self.assertEqual({VIDEO: None, TOK_NADIR: "photo_set", TOK_ORBITA: "photo_set"}, kinds)
        by = {r["clip_id"]: r for r in recon["sources"]}
        self.assertEqual((9, 9), (by[VIDEO]["submitted"], by[VIDEO]["registered"]))
        self.assertEqual((8, 8), (by[TOK_NADIR]["submitted"], by[TOK_NADIR]["registered"]))
        self.assertEqual((7, 7), (by[TOK_ORBITA]["submitted"], by[TOK_ORBITA]["registered"]))
        self.assertNotIn("partial_merge", m)
        manifest = json.loads((self.vault / "odm" / f"proj_{rid}" / "frames_manifest.json").read_text())
        self.assertEqual(2, len(manifest["photo_sets"]))
        self.assertEqual("s0_", manifest["sources"][0]["prefix"])
        self.assertEqual("s1_", manifest["sources"][1]["prefix"])

        sc = scenes.get_scene(scene_id)
        ver = sc["versions"][0]
        self.assertEqual(("ready", "FULL"), (ver["status"], ver["merge_label"]))
        self.assertEqual([VIDEO, TOK_NADIR, TOK_ORBITA], ver["effective_sources"])
        self.assertEqual([VIDEO], sc["source_inventory"]["videos"])
        self.assertEqual([TOK_NADIR, TOK_ORBITA], sc["source_inventory"]["photo_sets"])
        self.assertEqual(rid, sc["active_version"])
        man = json.loads((self.vault / "models" / rid / "scene.v2.json").read_text())
        self.assertEqual(1, man["site"]["source_count"])
        self.assertEqual([VIDEO, TOK_NADIR, TOK_ORBITA], man["site"]["effective_sources"])

        # "Mejorar escena" over the active version must KEEP the photo passes (videos first)
        with mock.patch.object(server.jobstore, "pending", return_value=False), \
                mock.patch.object(server.jobstore, "enqueue",
                                  side_effect=lambda k, l, sp: self.enqueued.append((k, l, sp)) or {"id": "job-2"}):
            code, resp = self.req("POST", "/api/scene_improve", {
                "scene_id": scene_id, "sources": [TOK_ORBITA, VIDEO, TOK_NADIR, "set:../x/y", "set:Nope/x"],
                "preset": "estandar"})
        self.assertEqual(400, code, resp)                        # bogus / missing set is refused, not dropped
        with mock.patch.object(server.jobstore, "pending", return_value=False), \
                mock.patch.object(server.jobstore, "enqueue",
                                  side_effect=lambda k, l, sp: self.enqueued.append((k, l, sp)) or {"id": "job-2"}):
            code, resp = self.req("POST", "/api/scene_improve", {
                "scene_id": scene_id, "sources": [TOK_ORBITA, VIDEO, TOK_NADIR], "preset": "estandar"})
        self.assertEqual(200, code, resp)
        kind, label, jspec = self.enqueued[-1]
        self.assertEqual([VIDEO, TOK_ORBITA, TOK_NADIR], jspec["sources"])   # videos first, then request order
        self.assertEqual([TOK_ORBITA, TOK_NADIR], jspec["photo_sets"])
        self.assertEqual(VIDEO, jspec["sources"][0])
        self.assertEqual(VIDEO, jspec["primary_cid"])
        self.assertEqual(3, resp["sources"])
        # default (no explicit sources) reuses the active version, tokens included
        with mock.patch.object(server.jobstore, "pending", return_value=False), \
                mock.patch.object(server.jobstore, "enqueue",
                                  side_effect=lambda k, l, sp: self.enqueued.append((k, l, sp)) or {"id": "job-3"}):
            self.fill_pass(SET_B, "unica", 6, seed0=90)
            code, resp = self.req("POST", "/api/scene_improve", {
                "scene_id": scene_id, "new_sources": [TOK_B], "preset": "estandar"})
        self.assertEqual(200, code, resp)
        self.assertEqual([VIDEO, TOK_NADIR, TOK_ORBITA, TOK_B], self.enqueued[-1][2]["sources"])

    def test_partial_photo_pass_that_fails_registration_is_gated(self):
        self.add_video()
        self.fill_pass(SET_A, "nadir", 8)
        type(self).register = {"s1_": 2}          # only 2/8 photos co-register -> below the 5 / 60% rule
        try:
            spec, _ = self.post_odm({"clip_id": VIDEO, "sources": [VIDEO],
                                     "photo_sets": [TOK_NADIR], "preset": "estandar"})
            scene_id, rid, sspec = self.make_scene(spec)
            sspec["then_splat"] = True
            self.register = type(self).register
            row = self.run_job(sspec)
        finally:
            type(self).register = None
        self.assertEqual("done", row["status"], row)

        m = self.meta(rid)
        self.assertEqual([TOK_NADIR], m["partial_merge"])
        self.assertEqual("PARTIAL", m["reconstruction"]["merge_label"])
        by = {r["clip_id"]: r for r in m["reconstruction"]["sources"]}
        self.assertEqual((8, 2, False), (by[TOK_NADIR]["submitted"], by[TOK_NADIR]["registered"], by[TOK_NADIR]["merged"]))
        self.assertTrue(by[VIDEO]["merged"])

        sc = scenes.get_scene(scene_id)
        ver = sc["versions"][0]
        self.assertEqual("partial", ver["status"])
        self.assertEqual([TOK_NADIR], ver["dropped_sources"])
        self.assertEqual([VIDEO], ver["effective_sources"])
        self.assertIsNone(sc["active_version"])                    # a partial merge is never promoted
        ev = {r["clip_id"]: r for r in sc["source_evidence"]}[TOK_NADIR]
        self.assertEqual("registration_failed", ev["status"])
        self.assertEqual(f"Fotos · {SET_A}/nadir", ev["label"])
        # no phased splat over a partial merge
        self.assertEqual([], [e for e in self.enqueued if e[0] == "splat"])

    def test_sparse_photo_pass_queues_viable_recovery_without_it(self):
        self.add_video()
        self.fill_pass(SET_A, "nadir", 3)                            # < 5 photos
        spec, _ = self.post_odm({"clip_id": VIDEO, "sources": [VIDEO],
                                 "photo_sets": [TOK_NADIR], "preset": "estandar"})
        scene_id, rid, sspec = self.make_scene(spec)
        job = jobs.enqueue("3d", rid, sspec)
        job = {**job, "spec": dict(sspec)}
        with mock.patch.object(worker.jobstore, "run_tracked", side_effect=self.fake_run_tracked), \
                mock.patch.object(worker, "run_odm_step", side_effect=self.fake_odm), \
                mock.patch.object(worker, "run_odm_cuda",
                                  side_effect=lambda j, proj, preset, name: self.fake_odm(
                                      j["id"], None, proj, preset, name)), \
                mock.patch.object(worker, "browser_gate"), \
                mock.patch.object(worker.jobstore, "enqueue", wraps=jobs.enqueue) as enq:
            with self.assertRaisesRegex(RuntimeError, "recovery viable"):
                worker.build_3d_assets(job, rid, "estandar", "t", sources=sspec["sources"], photos=[])
        recovery = enq.call_args[0][2]
        self.assertEqual([VIDEO], recovery["sources"])
        self.assertEqual(VIDEO, recovery["primary_cid"])
        sc = scenes.get_scene(scene_id)
        bad = next(r for r in sc["source_evidence"] if r["clip_id"] == TOK_NADIR)
        self.assertEqual("insufficient_views", bad["status"])
        self.assertIn("fotos", bad["reason"])


class UnitLevel(unittest.TestCase):
    """The pure pieces the end-to-end flow relies on."""

    def test_token_validation_and_labels(self):
        self.assertEqual(("Casa A", "nadir 1"), scenes.parse_photo_set_source("set:Casa A/nadir 1"))
        for bad in ("set:a/../b", "set:a", "set:/x", "set:a/b/c", "set: a/b", "set:a/b ", "set:a;b/c"):
            self.assertIsNone(scenes.parse_photo_set_source(bad), bad)
            with self.assertRaises(ValueError):
                scenes.validate_source_id(bad)
        self.assertEqual("DJI_0001_D", scenes.validate_source_id("DJI_0001_D"))
        self.assertEqual("Fotos · A/n", scenes.source_label("set:A/n"))

    def test_normalize_sources_dedups_and_keeps_order(self):
        self.assertEqual(["V", TOK_NADIR], worker.normalize_sources(["V", TOK_NADIR, "V", TOK_NADIR]))

    def test_mix_label(self):
        self.assertEqual("1 video + 2 pasadas de fotos + 3 fotos", worker.source_mix_label(1, 2, 3))
        self.assertEqual("1 pasada de fotos", worker.source_mix_label(0, 1, 0))

    def test_record_contributions_accepts_tokens_and_rejects_foreign_ones(self):
        with tempfile.TemporaryDirectory() as td, mock.patch.object(scenes, "SCENES_DIR", Path(td)):
            s = scenes.create_scene("T", {"lat": 1, "lon": 2})
            scenes.add_version(s["id"], "recon_x", ["V", TOK_NADIR], [], "processing")
            scenes.record_contributions(s["id"], "recon_x", [
                {"clip_id": TOK_NADIR, "submitted": 8, "registered": 8, "merged": True,
                 "photo_count": 8, "thumb_rel": "Casa A/nadir/a.JPG"}])
            with self.assertRaises(ValueError):
                scenes.record_contributions(s["id"], "recon_x", [{"clip_id": TOK_ORBITA, "merged": True}])
            got = scenes.get_scene(s["id"])
            self.assertEqual(["V"], got["source_inventory"]["videos"])
            self.assertEqual([TOK_NADIR], got["source_inventory"]["photo_sets"])
            self.assertEqual("Casa A/nadir/a.JPG", got["source_evidence"][0]["thumb_rel"])


if __name__ == "__main__":
    unittest.main()
