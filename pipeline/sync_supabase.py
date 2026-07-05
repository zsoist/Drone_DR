"""Mirror local vault metadata → Supabase (free tier). Media stays on the Mac.

Reads creds from /Volumes/SSD/_system/claude/.api-keys.env:
  SUPABASE_DRONE_URL, SUPABASE_DRONE_SERVICE_KEY, SUPABASE_DRONE_DB_URL

Steps:
  --schema   apply supabase/schema.sql via psql (one-time / on change)
  (default)  upsert flights + tracks + ai + models + properties via PostgREST
  --embed    also generate OpenAI embeddings for semantic search

Idempotent (upsert). Dependency-free (urllib + psql). Free-tier budgeted:
  metadata is tiny (<5MB total); embeddings ~$0.001 for the whole archive.
"""
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

VAULT = Path("/Volumes/SSD/drone-vault")
ROOT = Path("/Volumes/SSD/work/forge-projects/aerobrain")
KEYS = Path("/Volumes/SSD/_system/claude/.api-keys.env")


def load_keys() -> dict:
    out = {}
    for line in KEYS.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"')
    return out


def require(keys, *names):
    missing = [n for n in names if not keys.get(n)]
    if missing:
        sys.exit(f"Faltan credenciales en {KEYS}: {', '.join(missing)}\n"
                 f"Añádelas (Drone → Settings → API Keys / Database) y reintenta.")


def upsert(url, key, table, rows, on_conflict):
    if not rows:
        return
    body = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?on_conflict={on_conflict}",
        data=body, method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status not in (200, 201, 204):
            raise RuntimeError(f"{table}: HTTP {r.status}")
    print(f"  ↑ {table}: {len(rows)} filas")


def embed(texts, key):
    body = json.dumps({"model": "text-embedding-3-small", "input": texts}).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return [d["embedding"] for d in json.loads(r.read())["data"]]


def main():
    keys = load_keys()

    if "--schema" in sys.argv:
        require(keys, "SUPABASE_DRONE_DB_URL")
        migs = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
        if not migs:
            sys.exit("no hay migraciones en supabase/migrations/")
        print(f"aplicando {len(migs)} migración(es) vía psql (idempotentes)…")
        for m in migs:
            r = subprocess.run(["psql", keys["SUPABASE_DRONE_DB_URL"],
                                "-v", "ON_ERROR_STOP=1", "-f", str(m)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit(f"psql falló en {m.name}:\n{r.stderr[-800:]}")
            print(f"  ✓ {m.name}")
        print("✅ schema aplicado (PostGIS + pgvector + tablas + RLS + RPCs)")
        if "--embed" not in sys.argv and len(sys.argv) == 2:
            return

    require(keys, "SUPABASE_DRONE_URL")
    svc = keys.get("SUPABASE_DRONE_SECRET_KEY") or keys.get("SUPABASE_DRONE_SERVICE_KEY")
    if not svc:
        import sys as _s
        _s.exit("Falta SUPABASE_DRONE_SECRET_KEY (sb_secret_…) para escribir datos.")
    url = keys["SUPABASE_DRONE_URL"].rstrip("/")

    flights = json.loads((VAULT / "manifest" / "flights.json").read_text())["flights"]
    frows = []
    for f in flights:
        frows.append({
            "clip_id": f["clip_id"], "date": f.get("date"), "time": f.get("time"),
            "tier": f.get("tier"), "duration_s": f.get("duration_s"),
            "resolution": f.get("resolution"), "fps": f.get("fps"),
            "size_bytes": f.get("size_bytes"), "has_srt": f.get("has_srt"),
            "has_proxy": f.get("has_proxy"), "label": f.get("label"),
            "archived": f.get("archived", False), "raw_rel": f.get("raw_rel"),
            "frame_count": f.get("frame_count"), "stats": f.get("stats") or {},
            "ai": f.get("ai"),
        })
    upsert(url, svc, "flights", frows, "clip_id")

    # tracks
    trows = []
    for tf in sorted((VAULT / "tracks").glob("*.flight.json")):
        cid = tf.stem.replace(".flight", "")
        if any(f["clip_id"] == cid for f in flights):
            t = json.loads(tf.read_text())
            trows.append({"clip_id": cid, "points": t.get("points", [])})
    for i in range(0, len(trows), 20):  # lotes: tracks pueden ser grandes
        upsert(url, svc, "tracks", trows[i:i + 20], "clip_id")

    # ai
    arows = []
    if (VAULT / "ai").exists():
        for af in sorted((VAULT / "ai").glob("DJI_*.json")):
            a = json.loads(af.read_text())
            if any(f["clip_id"] == a.get("clip_id") for f in flights):
                arows.append({
                    "clip_id": a["clip_id"], "summary": a.get("summary"),
                    "scene_type": a.get("scene_type"), "tags": a.get("tags") or [],
                    "travel_score": a.get("travel_score"), "deep": a.get("deep", False),
                    "highlights": a.get("highlights") or [], "data": a})
    if "--embed" in sys.argv and arows:
        require(keys, "OPENAI_API_KEY")
        texts = [f"{r['summary'] or ''} {' '.join(r['tags'])} {r['scene_type'] or ''}" for r in arows]
        print(f"  embeddings OpenAI para {len(texts)} análisis…")
        vecs = embed(texts, keys["OPENAI_API_KEY"])
        for r, v in zip(arows, vecs):
            r["embedding"] = v
    upsert(url, svc, "ai_analysis", arows, "clip_id")

    # models
    mrows = []
    if (VAULT / "models").exists():
        for md in sorted((VAULT / "models").iterdir()):
            mf = md / "meta.json"
            if mf.is_dir() or not mf.exists():
                continue
            m = json.loads(mf.read_text())
            mrows.append({"clip_id": m["clip_id"], "qa": m.get("qa") or {},
                          "corners": m.get("corners"), "dsm_min": m.get("dsm_min"),
                          "dsm_max": m.get("dsm_max"), "has_dsm": m.get("has_dsm", False),
                          "meta": m})
    upsert(url, svc, "models", mrows, "clip_id")

    # properties
    prows = []
    if (VAULT / "properties").exists():
        for pf in sorted((VAULT / "properties").glob("*.json")):
            p = json.loads(pf.read_text())
            prows.append({"slug": p["slug"], "titulo": p.get("titulo"),
                          "precio": p.get("precio"), "ubicacion": p.get("ubicacion"), "data": p})
    upsert(url, svc, "properties", prows, "slug")

    print(f"✅ sync completo · {len(frows)} vuelos · {len(trows)} tracks · "
          f"{len(arows)} AI · {len(mrows)} modelos · {len(prows)} propiedades")


if __name__ == "__main__":
    main()
