"""Sync web-facing vault artifacts to the R2 bucket (aerobrain-media).

Uploads only what the web app consumes: manifests, tracks, thumbs, proxies, ai.
Raw 4K originals NEVER leave the SSD. Skips objects already uploaded (by size
ledger kept locally — R2 free tier Class A ops are budgeted).

Usage: python3 sync_r2.py [--dry-run]
"""
import json
import subprocess
import sys
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
BUCKET = "aerobrain-media"
ACCOUNT = "40d4fe9f36bcf7f093ac3d30f6483e03"
LEDGER = VAULT / "manifest" / ".r2-ledger.json"
DIRS = ["manifest", "tracks", "thumbs", "proxies", "ai"]

CONTENT_TYPES = {".json": "application/json", ".jpg": "image/jpeg", ".mp4": "video/mp4"}


def put(key: str, path: Path):
    # `script` fakes a TTY: wrangler refuses OAuth writes in non-interactive shells
    subprocess.run(
        ["script", "-q", "/dev/null", "npx", "--yes", "wrangler", "r2", "object", "put",
         f"{BUCKET}/{key}", "--file", str(path), "--remote",
         "--content-type", CONTENT_TYPES.get(path.suffix, "application/octet-stream")],
        check=True, capture_output=True,
        env={"CLOUDFLARE_ACCOUNT_ID": ACCOUNT, "PATH": "/opt/homebrew/bin:/usr/bin:/bin",
             "HOME": str(Path.home())})


def main():
    dry = "--dry-run" in sys.argv
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else {}
    todo = []
    for d in DIRS:
        base = VAULT / d
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file() and not p.name.startswith("."):
                key = f"{d}/{p.relative_to(base)}"
                if ledger.get(key) != p.stat().st_size:
                    todo.append((key, p))

    total = sum(p.stat().st_size for _, p in todo)
    print(f"{len(todo)} objetos por subir ({total / 1e9:.2f}GB)")
    if dry:
        for k, _ in todo[:20]:
            print(" ", k)
        return
    for i, (key, p) in enumerate(todo, 1):
        try:
            put(key, p)
            ledger[key] = p.stat().st_size
            print(f"[{i}/{len(todo)}] ↑ {key}")
        except subprocess.CalledProcessError as e:
            print(f"✗ {key}: {e.stderr.decode()[:200] if e.stderr else e}")
        if i % 10 == 0:
            LEDGER.write_text(json.dumps(ledger))
    LEDGER.write_text(json.dumps(ledger))
    print("✅ sync completo")


if __name__ == "__main__":
    main()
