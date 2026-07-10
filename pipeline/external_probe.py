#!/usr/bin/env python3
"""External, unauthenticated AeroBrain SLO probe.

Checks the same user-visible path an external monitor sees: public health,
homepage HTML, manifest discovery, and one-byte HTTP Range video streaming.
Uses only the standard library so GitHub Actions can run it without setup.
"""
import argparse
import json
import time
import urllib.parse
import urllib.request


def request(url: str, *, headers: dict | None = None, limit: int = 2_000_000,
            timeout: int = 15) -> tuple[int, bytes, object, int]:
    req = urllib.request.Request(url, headers={
        "User-Agent": "AeroBrainExternalProbe/1",
        **(headers or {}),
    })
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise RuntimeError(f"response too large: {url}")
        elapsed_ms = round((time.monotonic() - started) * 1000)
        return response.status, body, response.headers, elapsed_ms


def probe(base: str) -> dict:
    base = base.rstrip("/")
    status, body, _, health_ms = request(f"{base}/api/healthz", limit=4096)
    health = json.loads(body)
    if status != 200 or health.get("ok") is not True:
        raise RuntimeError(f"health failed: status={status} body={health}")

    status, body, _, home_ms = request(f"{base}/", limit=1_000_000)
    if status != 200 or b"AeroBrain" not in body:
        raise RuntimeError(f"home failed: status={status}")

    status, body, _, manifest_ms = request(
        f"{base}/data/manifest/flights.json", limit=2_000_000)
    flights = json.loads(body).get("flights", [])
    clip_id = next((f.get("clip_id") for f in flights
                    if f.get("clip_id") and f.get("has_proxy")), None)
    if status != 200 or not clip_id:
        raise RuntimeError("manifest has no streamable proxy")

    video = f"{base}/data/proxies/{urllib.parse.quote(clip_id)}.mp4"
    status, body, headers, stream_ms = request(
        video, headers={"Range": "bytes=0-0"}, limit=1)
    content_range = headers.get("Content-Range", "")
    if status != 206 or len(body) != 1 or not content_range.startswith("bytes 0-0/"):
        raise RuntimeError(
            f"stream failed: status={status} bytes={len(body)} range={content_range}")

    return {
        "ok": True,
        "base": base,
        "clip_id": clip_id,
        "content_range": content_range,
        "latency_ms": {
            "health": health_ms,
            "home": home_ms,
            "manifest": manifest_ms,
            "stream": stream_ms,
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
