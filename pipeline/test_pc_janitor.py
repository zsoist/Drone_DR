import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pc_janitor import Entry, job_id_for, plan

NOW = 2_000_000_000.0
DAY = 86400


def old(path, days, **kw):
    return Entry(path, NOW - days * DAY, **kw)


class PcJanitorPolicyTests(unittest.TestCase):
    def test_maps_every_remote_artifact_shape_to_its_mac_job(self):
        jid = "splat-1785728452002847000-66007b"
        for name in (f"job-{jid}", f"telemetry-job-{jid}.csv", jid, f"in-job-{jid}",
                     f"out-job-{jid}.ply"):
            self.assertEqual(job_id_for(name), jid, name)
        self.assertEqual(job_id_for("odm-3d-1784005392968475000-b5bbe4-out.tar"),
                         "3d-1784005392968475000-b5bbe4")
        self.assertEqual(job_id_for("splat-env"), None)

    def test_never_touches_active_jobs_even_when_ancient(self):
        e = old("/root/gpu-jobs/data/job-splat-1-abcdef", 400)
        self.assertEqual(plan([e], {"splat-1-abcdef": "running"}, NOW), [])
        self.assertEqual(plan([e], {"splat-1-abcdef": "queued"}, NOW), [])

    def test_honors_future_retain_until(self):
        e = old("/root/gpu-jobs/runs/job-splat-1-abcdef", 30, retain_until=NOW + 60)
        self.assertEqual(plan([e], {"splat-1-abcdef": "error"}, NOW), [])

    def test_expires_terminal_jobs_after_retention(self):
        fresh = old("/root/gpu-jobs/odm/3d-2-bbbbbb", 2)
        stale = old("/root/gpu-jobs/odm/3d-3-cccccc", 60)
        got = plan([fresh, stale], {"3d-2-bbbbbb": "error", "3d-3-cccccc": "error"}, NOW)
        self.assertEqual([e.path for e, _ in got], [stale.path])

    def test_untracked_leftovers_need_the_longer_window(self):
        young = old("/root/gpu-jobs/odm/full238", 20)
        ancient = old("/root/gpu-jobs/odm/mini", 70)
        got = plan([young, ancient], {}, NOW)
        self.assertEqual([e.path for e, _ in got], [ancient.path])

    def test_only_direct_children_of_known_roots(self):
        entries = [old("/root/gpu-jobs/splat-env", 400),
                   old("/root/gpu-jobs", 400),
                   old("/root/gpu-jobs/data/x/deep", 400),
                   old("/root/gpu-jobs/runs/.scripts", 400),
                   old("/mnt/d/Games/job-splat-1-abcdef", 400),
                   old("/root/gpu-jobs/data/bad name", 400)]
        self.assertEqual(plan(entries, {"splat-1-abcdef": "done"}, NOW), [])


if __name__ == "__main__":
    unittest.main()
