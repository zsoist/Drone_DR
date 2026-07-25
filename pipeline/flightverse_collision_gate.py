#!/usr/bin/env python3
"""Deterministic Chrome gate for FLIGHTVERSE world collision behavior."""
from __future__ import annotations

import argparse
import json
import time

from browser_gate import DEFAULT_BASE_URL, launch_chrome, new_page


def fixture_gate(base_url: str, timeout: int = 30) -> dict:
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        url = f"{base_url.rstrip('/')}/flightverse/world-collision-fixture.html"
        cdp.send("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        report = None
        while time.time() < deadline:
            cdp.pump(0.25)
            try:
                report = cdp.eval(
                    "window.__worldCollisionFixture?.done"
                    " ? window.__worldCollisionFixture : null"
                )
            except RuntimeError:
                continue
            if report:
                break
        if not report:
            raise RuntimeError(
                f"fixture no terminó en {timeout}s · console={cdp.errors[:6]}"
            )
        report["console_errors"] = cdp.errors[:6]
        if cdp.errors:
            report["ok"] = False
        if not report.get("ok"):
            raise RuntimeError(json.dumps(report, ensure_ascii=False))
        if int(report.get("queries", 0)) != 10_000:
            raise RuntimeError(f"fixture no ejecutó 10k queries: {report}")
        if float(report.get("query_ms", 1e9)) > 2_000:
            raise RuntimeError(f"10k queries excedieron presupuesto: {report}")
        return report
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        profile.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    if not args.fixture:
        parser.error("--fixture es obligatorio hasta habilitar el gate de mundo vivo")
    report = fixture_gate(args.base_url, args.timeout)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
