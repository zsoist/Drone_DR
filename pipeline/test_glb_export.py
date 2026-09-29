"""glb_export: OBJ -> per-tier GLB (gltfpack meshopt + KTX2), frame gate, freshness/approval.

Synthetic fixture only (a bumpy 24x24 heightfield split over two atlas pages, 16x16 JPEGs,
one MTL per tier) so the whole file runs in a few seconds. Tests that need the real
packer skip with a clear reason when gltfpack (with -tc), node or scipy is missing."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from pipeline import glb_export

PACKER = glb_export.gltfpack_path()
HAS_KTX2 = bool(PACKER and glb_export.gltfpack_supports_ktx2(PACKER))
HAS_NODE = shutil.which("node") is not None
try:
    import scipy  # noqa: F401
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
SKIP_REASON = ("gltfpack with KTX2 (-tc) not installed (set AEROBRAIN_GLTFPACK or put it in "
               "/Volumes/SSD/_system/tools/gltfpack), node or scipy missing")
NEED_TOOLS = unittest.skipUnless(HAS_KTX2 and HAS_NODE and HAS_SCIPY, SKIP_REASON)

CID = "recon_test_glb"
N = 24


def write_fixture(vault: Path, shift: float = 0.0) -> Path:
    """models/<cid>/{meta.json, model/viewer.obj + 3 tier MTLs + pages}."""
    from PIL import Image
    model = vault / "models" / CID / "model"
    model.mkdir(parents=True)
    rng = np.random.default_rng(7)
    lines = ["mtllib odm_textured_model_geo.mtl"]
    xs = np.linspace(-20, 20, N)
    z = rng.normal(0, 0.6, (N, N)) + 3 * np.sin(xs[:, None] / 6) * np.cos(xs[None, :] / 5)
    for i in range(N):
        for j in range(N):
            lines.append(f"v {xs[i] + shift:.3f} {xs[j]:.3f} {z[i, j]:.3f}")
    for i in range(N):
        for j in range(N):
            lines.append(f"vt {i / (N - 1):.5f} {j / (N - 1):.5f}")
    idx = lambda i, j: i * N + j + 1  # noqa: E731
    for page in (0, 1):
        lines.append(f"usemtl material{page:04d}")
        for i in range(N - 1):
            if (i < N // 2) != (page == 0):
                continue
            for j in range(N - 1):
                a, b, c, d = idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)
                lines.append(f"f {a}/{a} {b}/{b} {c}/{c}")
                lines.append(f"f {a}/{a} {c}/{c} {d}/{d}")
    (model / "odm_textured_model_viewer.obj").write_text("\n".join(lines) + "\n")
    for prefix, mtl in (("vtl_", "odm_textured_model_viewer_low.mtl"),
                        ("vtx_", "odm_textured_model_viewer_extra.mtl"),
                        ("", "odm_textured_model_geo.mtl")):
        body = []
        for page in (0, 1):
            name = f"{prefix}odm_textured_model_geo_material{page:04d}_map_Kd.jpg"
            Image.fromarray(rng.integers(0, 255, (16, 16, 3), dtype=np.uint8)).save(model / name, quality=90)
            body += [f"newmtl material{page:04d}", "Kd 1 1 1", f"map_Kd {name}"]
        (model / mtl).write_text("\n".join(body) + "\n")
    (vault / "models" / CID / "meta.json").write_text(json.dumps(
        {"model_viewer": "model/odm_textured_model_viewer.obj"}))
    return model / "odm_textured_model_viewer.obj"


class FingerprintTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="glbtest-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_counts_and_fingerprint_track_the_source(self):
        obj = write_fixture(self.tmp)
        verts, tris = glb_export.obj_counts(obj)
        self.assertEqual((verts, tris), (N * N, 2 * (N - 1) * (N - 1)))
        mtls = {t: obj.parent / c["mtl"] for t, c in glb_export.TIERS.items()}
        first = glb_export.source_fingerprint(obj, mtls)
        self.assertEqual(first, glb_export.source_fingerprint(obj, mtls))     # deterministic
        obj.write_text(obj.read_text() + "# touched\n")
        self.assertNotEqual(first, glb_export.source_fingerprint(obj, mtls))  # OBJ change

    def test_validate_fails_closed_without_meta(self):
        write_fixture(self.tmp)
        with self.assertRaises(ValueError):
            glb_export.validate(CID, vault=self.tmp)
        self.assertEqual(glb_export.approved(CID, vault=self.tmp), {})

    def test_frame_gate_rejects_a_shifted_source(self):
        # pure-python part of the gate: same mesh translated 1 m must not pass
        a = self.tmp / "a"
        b = self.tmp / "b"
        a.mkdir()
        b.mkdir()
        obj_a = write_fixture(a)
        obj_b = write_fixture(b, shift=1.0)
        sa, sb = glb_export.source_frame_stats(obj_a), glb_export.source_frame_stats(obj_b)
        self.assertAlmostEqual(float(np.linalg.norm(sa["centroid"] - sb["centroid"])), 1.0, places=2)


@NEED_TOOLS
class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="glbtest-"))
        cls.obj = write_fixture(cls.tmp)
        cls.logs: list[str] = []
        # target_tris below the source count -> exercises the decimated branch
        cls.meta = glb_export.build(
            CID, vault=cls.tmp, tier_overrides={"mobile": {"target_tris": 700}},
            log=cls.logs.append)
        cls.glb_dir = cls.tmp / "models" / CID / "glb"

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_all_three_tiers_are_written_with_meta(self):
        self.assertEqual(set(self.meta["tiers"]), {"mobile", "desktop", "extra"})
        for name, entry in self.meta["tiers"].items():
            f = self.glb_dir / f"{name}.glb"
            self.assertEqual(f.stat().st_size, entry["bytes"])
            self.assertEqual(entry["textures"], 2)              # atlas pages kept, no re-bake
            self.assertGreaterEqual(entry["min_mip_levels"], 2)
            self.assertEqual(entry["texture_px"], 2 * 16 * 16)
            self.assertTrue(entry["frame"]["ok"], entry["frame"])
        self.assertLess(self.meta["tiers"]["mobile"]["tris"], self.meta["source"]["tris"])
        self.assertEqual(self.meta["tiers"]["extra"]["tris"], self.meta["source"]["tris"])
        self.assertTrue(self.meta["gltfpack"].startswith("gltfpack"))

    def test_glb_is_ktx2_meshopt(self):
        doc, _ = glb_export.read_glb_json(self.glb_dir / "desktop.glb")
        self.assertIn("KHR_texture_basisu", doc["extensionsUsed"])
        self.assertIn("EXT_meshopt_compression", doc["extensionsUsed"])
        self.assertTrue(all(i["mimeType"] == "image/ktx2" for i in doc["images"]))

    def test_frame_gate_passes_full_tier_within_a_centimetre(self):
        ev = self.meta["tiers"]["extra"]["frame"]
        self.assertLessEqual(ev["vertex_subset_max_m"], glb_export.FRAME_TOL_M)
        self.assertLessEqual(ev["bbox_grow_m"], glb_export.FRAME_TOL_M)
        self.assertLessEqual(ev["bbox_shrink_max_m"], glb_export.FRAME_TOL_M)
        self.assertLessEqual(ev["centroid_delta_m"], glb_export.FRAME_TOL_M)

    def test_frame_gate_fails_when_the_glb_is_in_another_frame(self):
        other = self.tmp / "shifted"
        other.mkdir(exist_ok=True)
        # (fresh sub-vault: the fixture writer creates models/<cid>/...)
        obj2 = write_fixture(other, shift=0.5)
        shifted = glb_export.source_frame_stats(obj2)
        ev = glb_export.frame_gate(self.glb_dir / "extra.glb", shifted, decimated=False)
        self.assertFalse(ev["ok"], ev)

    def test_second_build_is_idempotent_and_touches_nothing(self):
        before = {p.name: p.stat().st_mtime_ns for p in self.glb_dir.glob("*.glb")}
        logs: list[str] = []
        glb_export.build(CID, vault=self.tmp, tier_overrides={"mobile": {"target_tris": 700}},
                         log=logs.append)
        self.assertEqual(before, {p.name: p.stat().st_mtime_ns for p in self.glb_dir.glob("*.glb")})
        self.assertTrue(all("up to date" in line for line in logs), logs)
        self.assertEqual([p.name for p in self.glb_dir.iterdir() if p.name.startswith(".")], [])

    def test_validate_and_approved_need_a_matching_green_gate(self):
        meta = glb_export.validate(CID, vault=self.tmp)
        self.assertEqual(glb_export.approved(CID, vault=self.tmp), {})        # no gate.json
        gate = {"source_fingerprint": meta["source_fingerprint"], "fallback": {"ok": True}, "csp": {"ok": True},
                "tiers": {t: {"ok": True, "key": e["key"]} for t, e in meta["tiers"].items()}}
        (self.glb_dir / "gate.json").write_text(json.dumps(gate))
        try:
            self.assertEqual(set(glb_export.approved(CID, vault=self.tmp)), {"mobile", "desktop", "extra"})
            gate["tiers"]["desktop"]["ok"] = False                            # one red tier
            (self.glb_dir / "gate.json").write_text(json.dumps(gate))
            self.assertEqual(set(glb_export.approved(CID, vault=self.tmp)), {"mobile", "extra"})
            gate["tiers"]["desktop"]["ok"] = True
            gate["tiers"]["extra"]["key"] = "stale-build"                     # gate for another build
            (self.glb_dir / "gate.json").write_text(json.dumps(gate))
            self.assertNotIn("extra", glb_export.approved(CID, vault=self.tmp))
            gate["tiers"]["extra"]["key"] = meta["tiers"]["extra"]["key"]
            gate["fallback"] = {"ok": False}                                  # OBJ fallback unproven
            (self.glb_dir / "gate.json").write_text(json.dumps(gate))
            self.assertEqual(glb_export.approved(CID, vault=self.tmp), {})
        finally:
            (self.glb_dir / "gate.json").unlink(missing_ok=True)

    def test_source_change_invalidates_everything(self):
        stale_root = Path(tempfile.mkdtemp(prefix="glbtest-stale-"))
        self.addCleanup(shutil.rmtree, stale_root, True)
        obj = write_fixture(stale_root)
        glb_export.build(CID, vault=stale_root, tiers=["mobile"], log=lambda *_: None)
        glb_export.validate(CID, vault=stale_root)
        obj.write_text(obj.read_text() + "# geometry edited\n")
        with self.assertRaises(ValueError):
            glb_export.validate(CID, vault=stale_root)
        self.assertEqual(glb_export.approved(CID, vault=stale_root), {})

    def test_verify_reruns_the_frame_gate_from_disk(self):
        out = glb_export.verify(CID, vault=self.tmp, log=lambda *_: None)
        self.assertTrue(all(ev["ok"] for ev in out.values()))


if __name__ == "__main__":
    unittest.main()
