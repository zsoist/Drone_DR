#!/bin/bash
# Build the Apple Metal/MPS OpenSplat binary used by premium splat jobs.
# Safe to rerun. It builds into splat/OpenSplat/build-mps and leaves the
# known-good CPU binary in splat/OpenSplat/build untouched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="/Volumes/SSD/drone-vault/manifest/jobs.db"
SPLAT_ROOT="$ROOT/splat/OpenSplat"
LIBTORCH="$ROOT/splat/libtorch"
BUILD="$SPLAT_ROOT/build-mps"

python3 - <<PY
import sqlite3, sys
db = "$DB"
try:
    con = sqlite3.connect(db, timeout=5)
    rows = con.execute(
        "select kind, label, id from jobs "
        "where status='running' and kind in ('3d','splat')").fetchall()
except Exception as e:
    print(f"ERROR: no se pudo leer {db}: {e}", file=sys.stderr)
    sys.exit(2)
if rows:
    for kind, label, jid in rows:
        print(f"BUSY: {kind} {label} {jid}", file=sys.stderr)
    sys.exit(3)
PY

xcode-select --print-path | grep -q "/Applications/Xcode.app" || {
  echo "ERROR: xcode-select no apunta al Xcode completo." >&2
  echo "Run: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer" >&2
  exit 4
}

xcrun --find metal >/dev/null
xcodebuild -downloadComponent MetalToolchain

mkdir -p "$BUILD"
cd "$BUILD"
cmake -DCMAKE_PREFIX_PATH="$LIBTORCH" -DGPU_RUNTIME=MPS ..
make -j"$(sysctl -n hw.logicalcpu)"

grep -q "GPU_RUNTIME:STRING=MPS" CMakeCache.txt
test -x ./opensplat
DYLD_LIBRARY_PATH="$ROOT/splat/libtorch/lib" ./opensplat --help >/dev/null
echo "OpenSplat MPS listo: $BUILD/opensplat"
