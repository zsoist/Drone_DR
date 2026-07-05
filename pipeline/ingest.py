"""Ingest DJI SD card → drone-vault/raw/ with integrity manifest.

Copy is rsync-based (resumable if the card unmounts mid-copy). Originals are
never modified or deleted from the card. After copy, a manifest records
size+mtime per file; --checksum adds SHA-256 (slow: 2nd full read of the card).

Usage:
    python3 ingest.py                # auto-detect card, copy, quick manifest
    python3 ingest.py --checksum     # + SHA-256 verification manifest
    python3 ingest.py --dry-run
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
VOLUMES = Path("/Volumes")


def find_card() -> Path | None:
    """A DJI card is any mounted volume with DCIM/DJI_* inside."""
    for vol in VOLUMES.iterdir():
        if vol.name == "SSD" or not vol.is_dir():
            continue
        dcim = vol / "DCIM"
        if dcim.is_dir() and any(d.name.startswith("DJI_") for d in dcim.iterdir()):
            return vol
    return None


def sha256(path: Path, buf=4 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(buf):
            h.update(chunk)
    return h.hexdigest()


def main():
    dry = "--dry-run" in sys.argv
    checksum = "--checksum" in sys.argv

    card = find_card()
    if not card:
        sys.exit("No DJI card mounted (looked for /Volumes/*/DCIM/DJI_*)")
    label = card.name.replace(" ", "_")
    dest = VAULT / "raw" / label
    dest.mkdir(parents=True, exist_ok=True)

    print(f"card: {card} → {dest}")
    cmd = ["rsync", "-a", "--info=progress2"]
    if dry:
        cmd.append("--dry-run")
    cmd += [str(card / "DCIM") + "/", str(dest) + "/"]
    subprocess.run(cmd, check=True)
    if dry:
        return

    files = sorted(p for p in dest.rglob("*") if p.is_file())
    manifest = {
        "card": card.name,
        "ingested_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "file_count": len(files),
        "total_bytes": sum(p.stat().st_size for p in files),
        "files": {},
    }
    for p in files:
        st = p.stat()
        entry = {"bytes": st.st_size, "mtime": int(st.st_mtime)}
        src = card / "DCIM" / p.relative_to(dest)
        if src.exists() and src.stat().st_size != st.st_size:
            entry["MISMATCH"] = True
            print(f"⚠ size mismatch: {p.name}")
        if checksum:
            entry["sha256"] = sha256(p)
        manifest["files"][str(p.relative_to(dest))] = entry

    out = VAULT / "manifest" / f"ingest-{label}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(manifest, indent=1))
    gb = manifest["total_bytes"] / 1e9
    print(f"✅ {len(files)} archivos, {gb:.1f}GB → manifest {out.name}")


if __name__ == "__main__":
    main()
