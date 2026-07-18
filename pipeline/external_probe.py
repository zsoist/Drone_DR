#!/usr/bin/env python3
"""External, unauthenticated AeroBrain availability and auth-boundary probe.

The public monitor must see health/login surfaces and must *not* see manifests
or media. Uses only the standard library so GitHub Actions can run it.
"""
import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request


def edge_worker_present(headers) -> bool:
    return headers.get("X-AeroBrain-Edge", "") == "private-data-v1"


def private_boundary_headers(headers) -> bool:
    """Require browser-private data plus an explicit shared-CDN storage ban."""
    browser = {
        part.strip().split("=", 1)[0].lower()
        for part in headers.get("Cache-Control", "").split(",")
        if part.strip()
    }
    cdn = {
        part.strip().split("=", 1)[0].lower()
        for part in headers.get("Cloudflare-CDN-Cache-Control", "").split(",")
        if part.strip()
    }
    return (bool({"private", "no-store"} & browser)
            and "no-store" in cdn
            and edge_worker_present(headers))


def request(url: str, *, headers: dict | None = None, limit: int = 2_000_000,
            timeout: int = 15) -> tuple[int, bytes, object, int, str]:
    req = urllib.request.Request(url, headers={
        "User-Agent": "AeroBrainExternalProbe/1",
        **(headers or {}),
    })
    started = time.monotonic()
    try:
        response = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise RuntimeError(f"response too large: {url}")
        elapsed_ms = round((time.monotonic() - started) * 1000)
        return response.status, body, response.headers, elapsed_ms, response.geturl()


def probe(base: str) -> dict:
    base = base.rstrip("/")
    status, body, headers, health_ms, _ = request(f"{base}/api/healthz", limit=4096)
    health = json.loads(body)
    if status != 200 or health.get("ok") is not True or not edge_worker_present(headers):
        raise RuntimeError(f"health failed: status={status} body={health}")

    status, body, headers, login_ms, final_url = request(f"{base}/", limit=1_000_000)
    if (status != 200
            or urllib.parse.urlsplit(final_url).path != "/login.html"
            or b"AeroBrain" not in body
            or not edge_worker_present(headers)):
        raise RuntimeError(f"login gate failed: status={status} final={final_url}")

    status, body, headers, whoami_ms, _ = request(f"{base}/api/whoami", limit=4096)
    whoami = json.loads(body)
    if status != 401 or whoami != {"ok": False} or not edge_worker_present(headers):
        raise RuntimeError(f"whoami boundary failed: status={status} body={whoami}")

    status, _, headers, manifest_ms, _ = request(
        f"{base}/data/manifest/flights.json", limit=4096)
    if status != 401 or not private_boundary_headers(headers):
        raise RuntimeError(f"manifest leaked: status={status}")

    # The gate runs before path resolution, so a stable sentinel proves that
    # Range/media routes are private without publishing a real clip identifier.
    status, _, headers, media_ms, _ = request(
        f"{base}/data/proxies/__auth_probe__.mp4",
        headers={"Range": "bytes=0-0"}, limit=4096)
    if status != 401 or not private_boundary_headers(headers):
        raise RuntimeError(f"media leaked: status={status}")

    return {
        "ok": True,
        "base": base,
        "login_gate": True,
        "protected_status": 401,
        "latency_ms": {
            "health": health_ms,
            "login": login_ms,
            "whoami": whoami_ms,
            "manifest": manifest_ms,
            "media_gate": media_ms,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://vuelos.metislab.work")
    args = parser.parse_args()
    print(json.dumps(probe(args.base), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
