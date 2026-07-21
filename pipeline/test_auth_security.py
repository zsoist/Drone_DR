"""Regression tests for AeroBrain's single-operator authentication boundary."""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server
import external_probe
import jobs


PUBLIC_HEADERS = {
    "CF-Ray": "auth-test-MIA",
    "CF-Connecting-IP": "203.0.113.44",
    "X-Forwarded-Proto": "https",
    "Host": "vuelos.metislab.work",
}


class AuthSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.tmp_path = Path(cls.tmp.name)
        cls.old_db = jobs.DB
        cls.old_keys = server._sb_keys
        cls.old_token = server.TOKEN
        cls.old_auth_event_log = server.AUTH_EVENT_LOG
        jobs.DB = cls.tmp_path / "jobs.db"
        server.AUTH_EVENT_LOG = cls.tmp_path / "auth-events.jsonl"
        jobs.init()
        cls.httpd = server.QuietThreadingHTTPServer(("127.0.0.1", 0), server.H)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        jobs.DB = cls.old_db
        server._sb_keys = cls.old_keys
        server.TOKEN = cls.old_token
        server.AUTH_EVENT_LOG = cls.old_auth_event_log
        cls.tmp.cleanup()

    def setUp(self):
        with closing(sqlite3.connect(jobs.DB)) as conn:
            conn.execute("DELETE FROM sessions")
            conn.commit()
        self.auth_file = self.tmp_path / f"operator-{time.time_ns()}.json"
        server.OPERATOR_AUTH_FILE = self.auth_file
        server._sb_keys = lambda: {
            "AEROBRAIN_USER": "daniel",
            "AEROBRAIN_PASS_SHA256": hashlib.sha256(b"correct horse").hexdigest(),
        }
        limiter = getattr(server, "LOGIN_LIMITER", None)
        if limiter is not None and hasattr(limiter, "reset"):
            limiter.reset()

    def request(self, method, path, *, body=None, headers=None, public=True):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        merged = dict(PUBLIC_HEADERS if public else {"Host": "127.0.0.1:8790"})
        merged.update(headers or {})
        payload = None
        if body is not None:
            payload = json.dumps(body).encode()
            merged.setdefault("Content-Type", "application/json")
            merged["Content-Length"] = str(len(payload))
        conn.request(method, path, body=payload, headers=merged)
        response = conn.getresponse()
        data = response.read()
        result = (response.status, dict(response.getheaders()), data)
        conn.close()
        return result

    def login(self, password="correct horse"):
        return self.request(
            "POST",
            "/api/login",
            body={"user": "daniel", "password": password},
            headers={
                "Origin": "https://vuelos.metislab.work",
                "Sec-Fetch-Site": "same-origin",
                "X-AeroBrain-CSRF": "1",
            },
        )

    @staticmethod
    def session_cookie(headers):
        match = re.search(r"(__Host-ab_session=[^;]+)", headers.get("Set-Cookie", ""))
        if not match:
            raise AssertionError("login response did not set the hardened session cookie")
        return match.group(1)

    def test_session_default_absolute_expiry_is_24_hours(self):
        before = time.time()
        jobs.session_create()
        with closing(sqlite3.connect(jobs.DB)) as conn:
            expiry = conn.execute("SELECT expiry FROM sessions").fetchone()[0]
        self.assertGreaterEqual(expiry - before, 86395)
        self.assertLessEqual(expiry - before, 86405)

    def test_session_token_is_hashed_at_rest(self):
        sid = jobs.session_create()
        with closing(sqlite3.connect(jobs.DB)) as conn:
            row = conn.execute("SELECT * FROM sessions").fetchone()
        self.assertNotIn(sid, {str(value) for value in row})

    def test_job_and_session_database_is_owner_only(self):
        self.assertEqual(jobs.DB.stat().st_mode & 0o777, 0o600)

    def test_edge_auth_key_file_requires_owner_only_regular_file(self):
        old_path = server.EDGE_AUTH_KEY_FILE
        key_file = self.tmp_path / f"edge-key-{time.time_ns()}"
        key_file.write_bytes(b"k" * 64)
        key_file.chmod(0o600)
        server.EDGE_AUTH_KEY_FILE = key_file
        try:
            self.assertEqual(server._load_edge_auth_key(), b"k" * 64)
            key_file.chmod(0o644)
            self.assertEqual(server._load_edge_auth_key(), b"")
            key_file.unlink()
            key_file.symlink_to(self.tmp_path / "missing-edge-key")
            self.assertEqual(server._load_edge_auth_key(), b"")
        finally:
            server.EDGE_AUTH_KEY_FILE = old_path

    def test_session_info_is_single_user_and_exposes_absolute_expiry(self):
        self.assertTrue(hasattr(jobs, "session_info"), "session_info is required")
        sid = jobs.session_create()
        info = jobs.session_info(sid)
        self.assertEqual(info["user_id"], "daniel")
        self.assertGreater(info["expiry"], time.time())

    def test_signed_edge_session_requires_fresh_valid_hmac(self):
        self.assertTrue(hasattr(server, "EDGE_AUTH_KEY"))
        old_key = server.EDGE_AUTH_KEY
        server.EDGE_AUTH_KEY = b"edge-test-key"
        sid = jobs.session_create()
        try:
            stamp = str(int(time.time()))
            message = f"{stamp}\nGET\n/api/whoami\n{sid}".encode()
            signature = hmac.new(server.EDGE_AUTH_KEY, message, hashlib.sha256).hexdigest()
            edge_headers = {
                "X-AeroBrain-Edge-Session": sid,
                "X-AeroBrain-Edge-Time": stamp,
                "X-AeroBrain-Edge-Signature": signature,
            }
            status, _, body = self.request("GET", "/api/whoami", headers=edge_headers)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["user"]["id"], "daniel")

            status, _, _ = self.request(
                "GET", "/api/whoami",
                headers=edge_headers | {"X-AeroBrain-Edge-Signature": "0" * 64},
            )
            self.assertEqual(status, 401)

            stale = str(int(time.time()) - 120)
            stale_message = f"{stale}\nGET\n/api/whoami\n{sid}".encode()
            status, _, _ = self.request(
                "GET", "/api/whoami",
                headers=edge_headers | {
                    "X-AeroBrain-Edge-Time": stale,
                    "X-AeroBrain-Edge-Signature": hmac.new(
                        server.EDGE_AUTH_KEY, stale_message, hashlib.sha256).hexdigest(),
                },
            )
            self.assertEqual(status, 401)
        finally:
            server.EDGE_AUTH_KEY = old_key

    def test_public_app_document_redirects_before_render(self):
        status, headers, _ = self.request("GET", "/")
        self.assertEqual(status, 303)
        self.assertTrue(headers["Location"].startswith("/login.html?next="))
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_www_is_canonicalized_to_the_single_cookie_origin(self):
        status, headers, _ = self.request("GET", "/tresd.html?m=one",
                                          headers={"Host": "www.metislab.work"})
        self.assertEqual(status, 308)
        self.assertEqual(headers["Location"],
                         "https://vuelos.metislab.work/tresd.html?m=one")

    def test_unknown_external_host_is_rejected(self):
        status, _, _ = self.request("GET", "/", headers={"Host": "evil.example"})
        self.assertEqual(status, 421)

    def test_public_vault_data_and_head_are_unauthorized(self):
        for method in ("GET", "HEAD"):
            status, headers, _ = self.request(method, "/data/manifest/flights.json")
            self.assertEqual(status, 401)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(headers["Cloudflare-CDN-Cache-Control"], "no-store")

    def test_whoami_is_public_but_discloses_no_private_state(self):
        status, headers, body = self.request("GET", "/api/whoami")
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body), {"ok": False})
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_local_dev_requires_loopback_host_not_only_loopback_ip(self):
        handler = object.__new__(server.H)
        handler.client_address = ("127.0.0.1", 50123)
        handler.headers = {"Host": "attacker.example", "Sec-Fetch-Site": "none"}
        self.assertFalse(handler._is_local())

        handler.headers = {"Host": "127.0.0.1:8790", "Sec-Fetch-Site": "none"}
        self.assertTrue(handler._is_local())

    def test_local_cross_site_browser_request_does_not_get_dev_access(self):
        status, _, _ = self.request(
            "GET",
            "/",
            public=False,
            headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
        )
        self.assertEqual(status, 303)

    def test_local_codex_and_claude_dev_navigation_remains_available(self):
        status, _, body = self.request("GET", "/api/whoami", public=False)
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload["user"]["id"], "daniel")
        self.assertTrue(payload["dev_mode"])

    def test_token_cannot_be_exchanged_for_browser_session(self):
        server.TOKEN = "test-master-token"
        status, _, _ = self.request(
            "POST",
            "/api/login",
            body={"token": "test-master-token"},
            headers={
                "Origin": "https://vuelos.metislab.work",
                "Sec-Fetch-Site": "same-origin",
                "X-AeroBrain-CSRF": "1",
            },
        )
        self.assertEqual(status, 401)

    def test_password_login_sets_host_cookie_for_exactly_24_hours(self):
        status, headers, body = self.login()
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"]
        self.assertIn("__Host-ab_session=", cookie)
        self.assertIn("Max-Age=86400", cookie)
        self.assertIn("Path=/", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        payload = json.loads(body)
        self.assertEqual(payload["user"]["id"], "daniel")
        self.assertEqual(payload["timezone"], "America/Bogota")
        self.assertRegex(payload["expires_at"], r"-05:00$")
        self.assertGreaterEqual(payload["expires_in_seconds"], 86395)
        self.assertLessEqual(payload["expires_in_seconds"], 86400)

    def test_authenticated_session_unlocks_app_and_private_data(self):
        status, headers, _ = self.login()
        self.assertEqual(status, 200)
        cookie = self.session_cookie(headers)

        status, headers, _ = self.request("GET", "/home.html", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "private, no-store")

        status, _, body = self.request("GET", "/api/whoami", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["user"]["id"], "daniel")

    def test_authenticated_media_is_never_edge_cacheable(self):
        status, headers, _ = self.login()
        self.assertEqual(status, 200)
        cookie = self.session_cookie(headers)
        vault = self.tmp_path / f"vault-{time.time_ns()}"
        proxy = vault / "proxies" / "private.mp4"
        proxy.parent.mkdir(parents=True)
        proxy.write_bytes(b"private-video")
        with mock.patch.object(server, "VAULT", vault):
            status, headers, body = self.request(
                "GET",
                "/data/proxies/private.mp4",
                headers={
                    "Cookie": cookie,
                    "Range": "bytes=0-0",
                    "User-Agent": "AeroBrainOpsStatus/1",
                },
            )
        self.assertEqual(status, 206)
        self.assertEqual(body, b"p")
        self.assertEqual(headers["Cache-Control"], "private, no-cache")
        self.assertEqual(headers["Cloudflare-CDN-Cache-Control"], "no-store")

    def test_external_probe_allows_private_browser_cache_only_when_cdn_is_no_store(self):
        self.assertTrue(hasattr(external_probe, "edge_worker_present"))
        self.assertTrue(external_probe.edge_worker_present({
            "X-AeroBrain-Edge": "private-data-v1",
        }))
        self.assertFalse(external_probe.edge_worker_present({}))
        self.assertTrue(hasattr(external_probe, "private_boundary_headers"))
        self.assertTrue(external_probe.private_boundary_headers({
            "Cache-Control": "private, no-cache, must-revalidate",
            "Cloudflare-CDN-Cache-Control": "no-store",
            "X-AeroBrain-Edge": "private-data-v1",
        }))
        self.assertFalse(external_probe.private_boundary_headers({
            "Cache-Control": "public, max-age=86400",
            "Cloudflare-CDN-Cache-Control": "no-store",
            "X-AeroBrain-Edge": "private-data-v1",
        }))
        self.assertFalse(external_probe.private_boundary_headers({
            "Cache-Control": "private, no-cache",
        }))
        self.assertFalse(external_probe.private_boundary_headers({
            "Cache-Control": "private, no-cache",
            "Cloudflare-CDN-Cache-Control": "no-store",
        }))

    def test_logout_revokes_session_and_clears_browser_state(self):
        status, headers, _ = self.login()
        self.assertEqual(status, 200)
        cookie = self.session_cookie(headers)
        status, headers, _ = self.request(
            "POST",
            "/api/logout",
            body={},
            headers={
                "Cookie": cookie,
                "Origin": "https://vuelos.metislab.work",
                "Sec-Fetch-Site": "same-origin",
                "X-AeroBrain-CSRF": "1",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Clear-Site-Data"], '"cache", "cookies", "storage"')
        status, _, _ = self.request("GET", "/api/whoami", headers={"Cookie": cookie})
        self.assertEqual(status, 401)

    def test_logout_consumes_body_before_reusing_http11_connection(self):
        sid = jobs.session_create()
        cookie = f"{server.SESSION_COOKIE}={sid}"
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        headers = PUBLIC_HEADERS | {
            "Cookie": cookie,
            "Origin": "https://vuelos.metislab.work",
            "Sec-Fetch-Site": "same-origin",
            "X-AeroBrain-CSRF": "1",
            "Content-Type": "application/json",
            "Content-Length": "2",
        }
        try:
            conn.request("POST", "/api/logout", body=b"{}", headers=headers)
            response = conn.getresponse()
            response.read()
            self.assertEqual(response.status, 200)

            conn.request("GET", "/api/whoami", headers=PUBLIC_HEADERS | {"Cookie": cookie})
            response = conn.getresponse()
            response.read()
            self.assertEqual(response.status, 401)
        finally:
            conn.close()

    def test_authenticated_context_never_bleeds_to_next_http11_request(self):
        sid = jobs.session_create()
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        try:
            conn.request(
                "GET", "/api/whoami",
                headers=PUBLIC_HEADERS | {"Cookie": f"{server.SESSION_COOKIE}={sid}"})
            response = conn.getresponse()
            response.read()
            self.assertEqual(response.status, 200)

            conn.request("GET", "/api/jobs", headers=PUBLIC_HEADERS)
            response = conn.getresponse()
            response.read()
            self.assertEqual(response.status, 401)
        finally:
            conn.close()

    def test_logout_revokes_session_forwarded_by_signed_edge_bridge(self):
        old_key = server.EDGE_AUTH_KEY
        server.EDGE_AUTH_KEY = b"edge-test-key"
        sid = jobs.session_create()
        try:
            stamp = str(int(time.time()))
            message = f"{stamp}\nPOST\n/api/logout\n{sid}".encode()
            signature = hmac.new(server.EDGE_AUTH_KEY, message, hashlib.sha256).hexdigest()
            status, headers, _ = self.request(
                "POST", "/api/logout", body={}, headers={
                    "Origin": "https://vuelos.metislab.work",
                    "Sec-Fetch-Site": "same-origin",
                    "X-AeroBrain-CSRF": "1",
                    "X-AeroBrain-Edge-Session": sid,
                    "X-AeroBrain-Edge-Time": stamp,
                    "X-AeroBrain-Edge-Signature": signature,
                })
            self.assertEqual(status, 200)
            self.assertEqual(headers["Clear-Site-Data"], '"cache", "cookies", "storage"')
            self.assertIsNone(jobs.session_info(sid))
        finally:
            server.EDGE_AUTH_KEY = old_key

    def test_expired_session_is_rejected_and_removed(self):
        sid = jobs.session_create(ttl_seconds=1)
        with closing(sqlite3.connect(jobs.DB)) as conn:
            conn.execute("UPDATE sessions SET expiry=? WHERE token_hash=?",
                         (time.time() - 1, jobs._session_hash(sid)))
            conn.commit()
        status, _, _ = self.request(
            "GET", "/api/whoami", headers={"Cookie": f"{server.SESSION_COOKIE}={sid}"})
        self.assertEqual(status, 401)
        with closing(sqlite3.connect(jobs.DB)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM sessions").fetchone()[0], 0)

    def test_external_master_token_cannot_bypass_daniels_login(self):
        old_token = server.TOKEN
        server.TOKEN = "test-master-token"
        try:
            status, _, _ = self.request("GET", "/api/jobs?token=test-master-token")
            self.assertEqual(status, 401)
            status, _, _ = self.request(
                "GET", "/api/jobs", headers={"X-Token": "test-master-token"})
            self.assertEqual(status, 401)
        finally:
            server.TOKEN = old_token

    def test_login_page_is_public_with_a_strict_csp(self):
        for method in ("GET", "HEAD"):
            status, headers, _ = self.request(method, "/login.html")
            self.assertEqual(status, 200)
            csp = headers["Content-Security-Policy"]
            self.assertIn("default-src 'none'", csp)
            self.assertIn("form-action 'self'", csp)
            self.assertNotIn("unsafe-inline", csp)
            self.assertEqual(headers["Cache-Control"], "private, no-store")
            self.assertEqual(headers["Cloudflare-CDN-Cache-Control"], "no-store")

    def test_login_surface_is_dedicated_to_daniel_and_has_no_cancel_path(self):
        login_html = server.WEB / "login.html"
        login_js = server.WEB / "login.js"
        login_css = server.WEB / "login.css"
        self.assertTrue(login_html.is_file())
        self.assertTrue(login_js.is_file())
        self.assertTrue(login_css.is_file())
        html = login_html.read_text()
        script = login_js.read_text()
        styles = login_css.read_text()
        self.assertIn('value="daniel"', html)
        self.assertIn('autocomplete="current-password"', html)
        self.assertIn('rel="icon" href="data:,"', html)
        self.assertNotIn('type="email"', html)
        self.assertNotIn("Cancelar", html)
        self.assertIn("X-AeroBrain-CSRF", script)
        self.assertIn("location.replace", script)
        self.assertIn(".ic {", styles)
        self.assertIn("stroke: currentColor", styles)

    def test_app_shell_redirects_expired_sessions_instead_of_opening_modal(self):
        script = (server.WEB / "shell.js").read_text()
        self.assertNotIn("function loginModal", script)
        self.assertNotIn("ensureAuth", script)
        self.assertIn("location.replace", script)
        self.assertIn("X-AeroBrain-CSRF", script)
        self.assertIn("timeZone: 'America/Bogota'", script)
        self.assertIn("expires_in_seconds", script)
        self.assertIn("setTimeout(requireSession", script)

    def test_password_is_migrated_from_sha256_to_scrypt_file(self):
        self.assertTrue(
            hasattr(server, "verify_operator_password"),
            "memory-hard operator password verifier is required",
        )
        self.assertTrue(server.verify_operator_password("correct horse"))
        self.assertTrue(self.auth_file.is_file())
        self.assertEqual(self.auth_file.stat().st_mode & 0o777, 0o600)
        stored = json.loads(self.auth_file.read_text())
        self.assertEqual(stored["algorithm"], "scrypt")
        self.assertNotIn("correct horse", self.auth_file.read_text())
        server._sb_keys = lambda: {"AEROBRAIN_PASS_SHA256": ""}
        self.assertTrue(server.verify_operator_password("correct horse"))
        self.assertFalse(server.verify_operator_password("wrong"))

    def test_oversized_operator_verifier_fails_closed(self):
        record = {
            "version": 1,
            "algorithm": "scrypt",
            **server._SCRYPT_DEFAULTS,
            "salt": base64.urlsafe_b64encode(b"s" * 16).decode(),
            "digest": base64.urlsafe_b64encode(b"d" * 32).decode(),
        }
        payload = json.dumps(record) + (" " * 5000)
        self.auth_file.write_text(payload)
        self.assertEqual(server._read_operator_verifier(), {"invalid": True})

    def test_untrusted_scrypt_parameters_are_rejected_before_derivation(self):
        record = {
            "version": 1,
            "algorithm": "scrypt",
            "n": 2 ** 30,
            "r": 64,
            "p": 64,
            "salt": base64.urlsafe_b64encode(b"s" * 16).decode(),
            "digest": base64.urlsafe_b64encode(b"d" * 32).decode(),
        }
        self.auth_file.write_text(json.dumps(record))
        with mock.patch.object(server, "_derive_scrypt", return_value=b"x" * 32) as derive:
            self.assertFalse(server.verify_operator_password("correct horse"))
        self.assertEqual(derive.call_count, 1)
        self.assertEqual(derive.call_args.kwargs, server._SCRYPT_DEFAULTS)

    def test_operator_verifier_symlink_fails_closed(self):
        self.auth_file.symlink_to(self.tmp_path / "missing-verifier.json")
        self.assertEqual(server._read_operator_verifier(), {"invalid": True})

    def test_operator_verifier_with_broad_permissions_fails_closed(self):
        server._write_operator_verifier(b"correct horse")
        self.auth_file.chmod(0o644)
        self.assertEqual(server._read_operator_verifier(), {"invalid": True})

    def test_cross_site_logout_is_rejected_and_session_survives(self):
        sid = jobs.session_create()
        name = getattr(server, "SESSION_COOKIE", "ab_s")
        status, _, _ = self.request(
            "POST",
            "/api/logout",
            body={},
            headers={
                "Cookie": f"{name}={sid}",
                "Origin": "https://evil.example",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(status, 403)
        self.assertTrue(jobs.session_valid(sid))

    def test_login_is_rate_limited(self):
        old_sleep = server.time.sleep
        server.time.sleep = lambda _seconds: None
        try:
            statuses = [self.login("wrong")[0] for _ in range(7)]
        finally:
            server.time.sleep = old_sleep
        self.assertIn(429, statuses)

    def test_small_distributed_burst_cannot_lock_the_only_operator_account(self):
        limiter = server.LoginRateLimiter()
        for index in range(25):
            limiter.failure(f"203.0.113.{index}", now=1000)
        self.assertEqual(limiter.retry_after("198.51.100.9", now=1001), 0)

    def test_login_limiter_discards_expired_client_buckets(self):
        limiter = server.LoginRateLimiter(window_seconds=10)
        for index in range(25):
            limiter.failure(f"203.0.113.{index}", now=1000)
        self.assertEqual(limiter.retry_after("198.51.100.9", now=1011), 0)
        self.assertEqual(limiter._by_ip, {})

    def test_password_kdf_concurrency_is_bounded_for_the_m4(self):
        self.assertEqual(getattr(server, "AUTH_KDF_CONCURRENCY", None), 2)
        self.assertTrue(hasattr(server, "AUTH_KDF_SLOTS"))

    def test_safe_next_path_rejects_external_and_scheme_relative_urls(self):
        self.assertTrue(hasattr(server, "safe_next_path"), "safe redirect helper is required")
        self.assertEqual(server.safe_next_path("https://evil.example"), "/home.html")
        self.assertEqual(server.safe_next_path("//evil.example/path"), "/home.html")
        self.assertEqual(server.safe_next_path("/tresd.html?m=one"), "/tresd.html?m=one")

    def test_app_mutations_use_the_csrf_aware_fetch_wrapper(self):
        direct_post = re.compile(r"\bfetch\(.{0,300}?method:\s*['\"]POST['\"]", re.DOTALL)
        for name in ("tresd.js", "system.js", "splatlab.js"):
            source = (server.WEB / name).read_text()
            self.assertIsNone(direct_post.search(source),
                              f"{name} has a direct POST that bypasses authFetch")

    def test_removed_modal_auth_helper_has_no_call_sites(self):
        offenders = []
        for path in server.WEB.glob("*.js"):
            if "ensureAuth(" in path.read_text():
                offenders.append(path.name)
        self.assertEqual(offenders, [], f"stale ensureAuth calls remain in {offenders}")

    def test_protected_api_reads_use_auth_fetch_for_immediate_expiry_redirect(self):
        direct_api = re.compile(r"\bfetch\(\s*([`'\"])/api/(?!login\b|whoami\b)")
        offenders = []
        for path in server.WEB.glob("*.js"):
            if direct_api.search(path.read_text()):
                offenders.append(path.name)
        self.assertEqual(offenders, [], f"direct protected API fetches remain in {offenders}")

    def test_supabase_catalog_is_server_only(self):
        server_source = Path(server.__file__).read_text()
        semantic_source = server_source[
            server_source.index("def semantic_search"):server_source.index("def _deepseek")
        ]
        self.assertIn("SUPABASE_DRONE_SECRET_KEY", semantic_source)
        self.assertNotIn("SUPABASE_DRONE_PUBLISHABLE_KEY", semantic_source)

        migrations = sorted((Path(server.__file__).parent.parent / "supabase" / "migrations").glob("*.sql"))
        migration = "\n".join(path.read_text().lower() for path in migrations)
        self.assertIn("drop policy if exists pub_read", migration)
        self.assertIn(
            "revoke usage on schema public from public, anon, authenticated",
            migration,
        )
        self.assertIn("revoke all privileges on all tables in schema public", migration)
        self.assertIn("revoke all privileges on all sequences in schema public", migration)
        self.assertIn("revoke execute on all functions in schema public", migration)
        self.assertIn("grant execute on all functions in schema public to service_role", migration)
        self.assertRegex(
            migration,
            r"alter default privileges for role postgres\s+"
            r"revoke execute on functions from public",
        )
        self.assertIn("revoke all privileges", migration)
        self.assertIn("from anon, authenticated", migration)
        self.assertIn("revoke execute", migration)
        self.assertIn("from public, anon, authenticated", migration)
        self.assertIn("grant execute", migration)
        self.assertIn("to service_role", migration)
        self.assertIn("set search_path = pg_catalog, public", migration)
        self.assertIn("tablename = 'rooms'", migration)


if __name__ == "__main__":
    unittest.main(verbosity=2)
