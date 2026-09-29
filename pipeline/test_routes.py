"""Route characterization safety net for aerobrain_server.

Pins the ordered list of exact-match POST/GET routes (drift test) and asserts the auth
boundary on every POST route: unauthenticated requests are rejected (401/403), never 500.
Routes that parse JSON first also must answer 4xx (not 500) to a malformed body.
If you add/remove a route on purpose, update the fixtures below.
"""
from __future__ import annotations

import ast
import http.client
import inspect
import re
import textwrap
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server
import jobs

POST_ROUTES = [
    "/api/login", "/api/logout", "/api/job_cancel", "/upload", "/api/photo_upload",
    "/api/reel_order", "/api/reel_edit", "/api/audio_upload", "/api/audio_op",
    "/api/splat_autoclean", "/api/splat_revert", "/api/splat_upload", "/api/edit",
    "/api/sd_import", "/api/frame", "/api/measure", "/api/compare", "/api/scene_create",
    "/api/scene_improve", "/api/scene_promote", "/api/odm", "/api/model_update",
    "/api/model_delete", "/api/splat_delete", "/api/media_op", "/api/splat_campaign",
    "/api/splat", "/api/preflight", "/api/suggest_name", "/api/client_error",
    "/api/error_report", "/api/search", "/api/analyze", "/api/gpu_node/wake",
    "/api/gpu_node/sleep", "/api/scene_objects", "/api/highlight", "/api/clip",
    "/api/trip_meta", "/api/rescan", "/api/property", "/api/property_ai",
]

GET_EXACT_ROUTES = [
    "/api/healthz", "/api/whoami", "/login.html", "/api/splat_profiles", "/api/scenes",
    "/api/scene", "/api/job_log", "/api/job", "/api/jobs",
]

GET_PREFIX_ROUTES = [
    "/api/viewer_ping", "/api/gpu_node", "/api/perf", "/api/error_report_content",
    "/api/error_reports", "/api/geocode", "/api/capture_report", "/api/sd_scan",
    "/api/audio_beats", "/api/audio_list", "/api/drone_photos", "/api/photo_thumb",
    "/api/studio_media", "/api/reel_recipe", "/api/properties",
]

# Routes whose first action after auth is `self.read_json(...)`: a malformed body is
# rejected before any side effect, so they are safe to hit with an authenticated request.
JSON_FIRST_ROUTES = [
    "/api/job_cancel", "/api/reel_order", "/api/reel_edit", "/api/audio_op", "/api/edit",
    "/api/sd_import", "/api/frame", "/api/measure", "/api/compare", "/api/scene_create",
    "/api/scene_improve", "/api/scene_promote", "/api/odm", "/api/model_update",
    "/api/model_delete", "/api/splat_delete", "/api/media_op", "/api/splat_campaign",
    "/api/splat", "/api/preflight", "/api/suggest_name", "/api/search", "/api/analyze",
    "/api/scene_objects", "/api/highlight", "/api/clip", "/api/trip_meta",
    "/api/property", "/api/property_ai",
]

PUBLIC_HEADERS = {
    "CF-Ray": "routes-test-MIA",
    "CF-Connecting-IP": "203.0.113.55",
    "X-Forwarded-Proto": "https",
    "Host": "vuelos.metislab.work",
}
LOCAL_HEADERS = {"Host": "127.0.0.1:8790"}   # treated as the local dev operator


def _dedupe(seq):
    seen, out = set(), []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _path_literals(func, attr_only):
    """String literals compared with `==` to `<x>.path` (and bare `path` for GET), via ast."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(func)))
    out = set()
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Compare) and len(node.ops) == 1
                and isinstance(node.ops[0], ast.Eq)):
            continue
        left, right = node.left, node.comparators[0]
        is_path = ((isinstance(left, ast.Attribute) and left.attr == "path")
                   or (not attr_only and isinstance(left, ast.Name) and left.id == "path"))
        if is_path and isinstance(right, ast.Constant) and isinstance(right.value, str) \
                and right.value.startswith("/"):
            out.add(right.value)
    return out


class RouteDriftTests(unittest.TestCase):
    def test_post_routes_match_fixture(self):
        # rutas ya migradas a la tabla de despacho + literales que queden en la cadena de _post
        in_chain = _path_literals(server.H._post, attr_only=True)
        table = set(getattr(server.H, "_POST_ROUTES", {}))
        self.assertFalse(in_chain & table, "route both in the dispatch table and in the if-chain")
        self.assertEqual(in_chain | table, set(POST_ROUTES),
                         "POST routes changed: update POST_ROUTES in test_routes.py")

    def test_post_dispatch_table_is_complete_and_callable(self):
        self.assertEqual(set(server.H._POST_ROUTES), set(POST_ROUTES))
        self.assertEqual(_path_literals(server.H._post, attr_only=True), set(),
                         "_post still has inline route blocks")
        for path, name in server.H._POST_ROUTES.items():
            with self.subTest(route=path):
                fn = getattr(server.H, name)
                self.assertEqual(["self", "u", "q"],
                                 list(inspect.signature(fn).parameters))

    def test_get_exact_routes_match_fixture(self):
        found = _path_literals(server.H.do_GET, attr_only=False)
        self.assertEqual(found, set(GET_EXACT_ROUTES),
                         "GET exact routes changed: update GET_EXACT_ROUTES in test_routes.py")

    def test_get_prefix_routes_match_fixture(self):
        src = inspect.getsource(server.H.do_GET)
        found = _dedupe(re.findall(r'self\.path\.startswith\("(/[^"]*)"', src))
        self.assertEqual(found, GET_PREFIX_ROUTES,
                         "GET prefix routes changed: update GET_PREFIX_ROUTES in test_routes.py")

    def test_json_first_routes_are_real_post_routes(self):
        self.assertTrue(set(JSON_FIRST_ROUTES) <= set(POST_ROUTES))


class RouteBehaviourTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls.tmp.name)
        cls.old_db = jobs.DB
        cls.old_log = server.AUTH_EVENT_LOG
        jobs.DB = tmp / "jobs.db"
        server.AUTH_EVENT_LOG = tmp / "auth-events.jsonl"
        jobs.init()
        cls.vault_patch = mock.patch.object(server, "VAULT", tmp)
        cls.vault_patch.start()
        cls.httpd = server.QuietThreadingHTTPServer(("127.0.0.1", 0), server.H)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        cls.vault_patch.stop()
        jobs.DB = cls.old_db
        server.AUTH_EVENT_LOG = cls.old_log
        cls.tmp.cleanup()

    def request(self, method, path, headers, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        h = dict(headers)
        payload = body if body is not None else b""
        h["Content-Length"] = str(len(payload))
        h.setdefault("Content-Type", "application/json")
        try:
            conn.request(method, path, body=payload, headers=h)
            r = conn.getresponse()
            r.read()
            return r.status
        finally:
            conn.close()

    def test_unauthenticated_post_is_rejected_never_500(self):
        for route in POST_ROUTES:
            with self.subTest(route=route):
                status = self.request("POST", route, PUBLIC_HEADERS, b"{}")
                self.assertIn(status, (401, 403))

    def test_malformed_json_is_4xx_when_authenticated(self):
        for route in JSON_FIRST_ROUTES:
            with self.subTest(route=route):
                status = self.request("POST", route, LOCAL_HEADERS, b"{not json")
                self.assertGreaterEqual(status, 400)
                self.assertLess(status, 500)

    def test_get_exact_routes_never_500_unauthenticated(self):
        for route in GET_EXACT_ROUTES:
            if route == "/api/healthz":      # 503 is its legitimate "unhealthy" answer
                continue
            with self.subTest(route=route):
                self.assertLess(self.request("GET", route, PUBLIC_HEADERS), 500)


if __name__ == "__main__":
    unittest.main()
