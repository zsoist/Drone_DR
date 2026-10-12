---
ste: strict
---

# Visual AI features

## Storage and safety

Visual AI adds suggestions to `ai/<clip_id>.json` in the vault.
It does not change owner titles, covers, tags, edits, or source media.
The server uses Python standard-library code and needs no database service.
The infrastructure cost is zero.

One Gemini 2.5 Flash request reads up to eight current JPEG keyframes.
The input spans the clip and includes exact frame times.
The pipeline does not download video or extract frames for this request.
Clips without extracted frames remain pending.
Sparse frames cannot prove camera stability or locate every action.

The pipeline checks the complete insight and vector before an atomic write.
Invalid JSON, absent fields, unknown fields, invalid numbers, and provider failures preserve the previous record.
This follows PIPE-09.
Deep analysis also checks the director report before publication.
A vector belongs to the caption and tags through a SHA-256 digest.
Search ignores stale vectors.

The record keeps the current `summary`, `tags`, `subjects`, `scene_type`, `highlights`, and `travel_score` fields.
Current cards and Studio can still read these fields.
The record also stores `schema_version: 1`, `suggested: true`, `duration_s`, and `sampled_frame_times`.
The record stores provider token counts.
Keys never enter these records or API responses.

## Insight schema

The executable JSON Schema is `INSIGHT_SCHEMA` in `ai/insight_schema.py`.
The schema needs all fields below.
Objects reject extra fields.
The local validator also checks duration and sampled frame times.

```json
{
  "caption": "El dron muestra un río entre montañas.",
  "tags": ["río", "montañas"],
  "subjects": ["río"],
  "shot_type": "cenital",
  "scene_type": "naturaleza",
  "best_frame_times": [2, 8],
  "highlight_segments": [
    {"start": 2, "end": 8, "score": 0.9, "reason": "El río ocupa el encuadre."}
  ],
  "light_notes": "Luz suave.",
  "color_notes": "Verdes naturales.",
  "suggested_look": {"preset_id": "malick", "exposure_ev": -0.3},
  "quality_flags": []
}
```

| Field | Contract |
| --- | --- |
| `caption` | Spanish text, 1–600 characters |
| `tags` | 1–20 strings, each 1–80 characters |
| `subjects` | 0–20 strings, each 1–100 characters |
| `shot_type` | `órbita`, `revelación`, `cenital`, `FPV`, `travelling`, `paneo`, `ascenso`, `descenso`, `estático`, `seguimiento`, or `mixto` |
| `scene_type` | `urbano`, `naturaleza`, `costa`, `montaña`, `atardecer`, `interior`, or `mixto` |
| `best_frame_times` | 1–6 sampled timestamps, in seconds |
| `highlight_segments` | 1–8 segments; `0 <= start < end <= duration_s` |
| `score` | Finite number from 0 to 1 |
| `reason` | Spanish text, 1–240 characters |
| `light_notes`, `color_notes` | Spanish text, each 1–300 characters |
| `exposure_ev` | Finite number from -2 to 2 |
| `quality_flags` | Up to three values: `inestable`, `horizonte`, `sobreexpuesto` |

The suggested look uses an current Studio preset ID:
`none`, `nolan`, `deakins`, `malick`, `fincher`, `kodak`, `goldenhour`, `tealorange`, `cine`, `vivid`, `warm`, `moody`, or `bw`.
The UI must label the result `Sugerido` and offer accept and dismiss actions.
This backend does not accept suggestions automatically.

## Embeddings and search

Gemini `gemini-embedding-001` embeds the caption and tags with `RETRIEVAL_DOCUMENT`.
Queries use `RETRIEVAL_QUERY`.
The record stores 768 normalized values as JSON under `embedding.vector`.
The vector object also stores `model`, `dimensions`, `source_hash`, `estimated_tokens`, and `estimated_usd`.
The server computes cosine similarity directly in Python.
The server needs no Supabase service.

Lexical search removes accents and ignores letter case.
Its score is the fraction of query words found in the caption or tags.
The result score is the greater of lexical score and nonnegative cosine similarity.
Results sort by score from highest to lowest, then clip ID.
A score above zero qualifies; scores are not probabilities.

The server caches up to 128 query vectors in memory.
A new query can call the vector API when clip vectors exist.
A provider failure returns lexical results.
GET requests never write files or generate clip analysis or summaries.

## HTTP contract

All paths below use GET and return JSON with the current private authentication gate.
Loopback preview access follows the current preview rules.
POST requests remain blocked in preview mode.
No new public resources are added.

Invalid search parameters return HTTP 400 with `{"error":"parámetros inválidos"}`.
Unknown clips or trips return HTTP 404 with `{"error":"no encontrado"}`.
Unauthenticated requests return HTTP 401 through the central gate.
Known clips without insights return HTTP 200 with `status: "pending"`.

### Search

`GET /api/search?q=<text>&limit=12`

The request needs `q` with 1–400 characters after outer spaces are removed.
`limit` is optional and ranges from 1 to 50.
The current POST search route also uses local vectors and returns this result shape.

```json
{
  "q": "río",
  "mode": "hybrid",
  "results": [{
    "clip_id": "DJI_example",
    "score": 0.91,
    "mode": "semantic",
    "caption": "Un río entre montañas.",
    "tags": ["río"],
    "matched_moment": {
      "clip_id": "DJI_example",
      "time_s": 8,
      "frame_time_s": 8,
      "frame_url": "/data/frames/DJI_example/f_0005.jpg",
      "score": 0.9,
      "selection": "ai"
    }
  }]
}
```

Top-level `mode` is `hybrid` or `tags`.
Result `mode` is `semantic` or `tags`.
`time_s` is the highlight start for the closest lexical reason, then the highest highlight score.
The search uses clip-level vectors; moment selection does not use separate moment vectors.

`frame_time_s` gives the nearest current JPEG.
It is null when only a thumbnail is available.
`frame_url` then points to `/data/thumbs/<clip_id>.jpg`.

### Collections

`GET /api/collections`

```json
{
  "collections": [{
    "id": "shot_type:cenital",
    "kind": "shot_type",
    "label": "cenital",
    "clip_ids": ["DJI_example"],
    "count": 1,
    "cover": {"clip_id":"DJI_example","time_s":8,"frame_time_s":8,
              "frame_url":"/data/frames/DJI_example/f_0005.jpg","score":0.9,"selection":"ai"}
  }]
}
```

`kind` is `place`, `month`, `subject`, or `shot_type`.
Subjects group without accents or letter case.
Month IDs use `month:YYYY-MM`.
Place IDs use `place:<latitude>,<longitude>` with two decimal places.

Place groups follow the current Viajes rule: newest-first anchors and a 30 km radius.
Exact saved trip names override the coordinate label.
Archived clips are excluded from all collections and searches.
Place collections keep a valid cover clip from the owner.
That cover uses `selection: "owner"`.
Other covers are suggestions.

### Clip insight

`GET /api/clip/<clip_id>/insight`

```json
{"clip_id":"DJI_example","status":"ready","suggested":true,"insight":{}}
```

`insight` contains the complete schema above.
A pending result uses `status: "pending"` and `insight: null`.
Clip IDs accept ASCII letters, numbers, underscores, and hyphens, up to 120 characters.

### Flight summary

`GET /api/flight/<clip_id>/summary`

```json
{
  "id":"DJI_example", "kind":"flight", "suggested":true,
  "clip_ids":["DJI_example"], "distance_m":327.5, "max_altitude_m":52.4,
  "best_moment":{}, "status":"ready", "summary":"Primera frase. Segunda frase."
}
```

A flight ID is a clip ID, as in the current Flight Deck.
Distance and maximum relative altitude come from recorded telemetry.
Absent measurements are null.
`best_moment` uses the same moment shape as search.

### Trip recap

`GET /api/trip/<trip_id>/recap`

URL-encode the Viajes coordinate ID, for example `4.91%2C-73.78`.
Use the place collection ID without its `place:` prefix.
A trip covers the geographic group across dates, not one calendar day.

The response extends the flight shape with `kind: "trip"` and these fields:

```json
{
  "route":[{"clip_id":"DJI_example","coordinates":[[-73.78,4.91],[-73.781,4.911]]}],
  "best_frames":[]
}
```

Route coordinates use longitude, then latitude.
Each route remains separate, so the map does not connect separate flights.
`best_frames` contains up to six distinct moment objects.
AI frames come first; other sampled frames fill empty positions when available.
`selection: "sample"` gives these extra frames.
Fewer available frames produce a shorter list.

## Summary cache

DeepSeek generates short Spanish summaries from telemetry and stored captions.
The writer takes the first two complete sentences from a checked JSON list.
It accepts packed sentences and preserves decimal measurements.
Invalid or incomplete output preserves the previous cache file.
The model sees at most twelve clip captions and no full GPS route.

Files live under `ai/summaries/<kind>-<identity_hash>.json`.
The source digest includes telemetry, captions, moments, and route data.
An unchanged digest avoids another provider request.
Changed input makes GET return `status: "pending"` and `summary: null` until a writer refreshes the cache.
GET does not serve an old summary with new measurements.

Media ingest generates an insight when extracted frames and a Gemini key exist.
The upload and SD import paths cache summaries after the index update.
AI failures leave media ingest successful and print a pending message without credentials.
The explicit analyze job refreshes the insight and summary caches.
Backfill also refreshes dependent caches.

## Backfill procedure

<!-- ste:procedural -->

1. Set `AEROBRAIN_VAULT` to the target vault.
2. Set `TMPDIR` to `/Volumes/SSD/tmp/agents/aerobrain/W6` for scratch files.
3. Run the dry command below.
4. Review the selected clip IDs and cost estimate.
5. Remove `--dry-run` to process only the selected clips.
6. Check the exit code and the printed token counts.
7. Run the command again to retry pending records.

```bash
/Volumes/SSD/_system/venv/bin/python3 ai/backfill_insights.py --limit 3 --dry-run
/Volumes/SSD/_system/venv/bin/python3 ai/backfill_insights.py --limit 3
```

<!-- ste:descriptive -->

The command needs `--limit` from 1 to 1000.
Dry run makes no API calls and writes no files.
The command skips completed clips with current summary caches.
It also refreshes affected trip summaries.

A trip summary can use current captions from other clips in that trip.
It does not analyze those other clips.
The exit code is nonzero when any selected operation fails.
Development did not run a paid backfill for the full library.

## Costs and checks sample

The first estimate is $0.005 per selected clip plus $0.002 per affected trip.
It is not a price quote.
Gemini vision cost uses measured input and output tokens at $0.30 and $2.50 per million tokens.
These rates come from [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

Vector cost uses an estimated token count at $0.15 per million tokens.
The estimate uses one token per three characters because `embedContent` returns no token count.
The model and rate originate from the [Gemini vector release](https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/).

The CLI prices DeepSeek token counts at peak Flash rates: $0.006 cached input, $0.30 uncached input, and $1.20 output per million tokens.
These conservative rates come from [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).
Actual off-peak charges can be lower.
The current `deepseek-chat` alias returned `deepseek-flash` during checks.

One copied clip, `DJI_20260718180839_0156_D`, supplied 68.8 seconds of footage.
Two vision requests tested this same clip.
The second request checked the quality flag definitions.
Its vision call used 2,248 input tokens and 495 output tokens: $0.00191190 at the published rates.
The vector estimate was $0.00001755.

Final flight and trip summaries used 930 input tokens and 147 output tokens, with 128 cached input tokens.
Those summaries cost about $0.00041777 at peak rates.
The final successful path cost about $0.00234722.

Work on the summary format made extra requests on this same copied clip.
Four early responses lack complete token records; their exact cost is unknown.
Later failed responses have token records in the W6 scratch logs.
These estimates are not measured account debits.
The real vault and production services were unchanged.

The known calls cost about $0.00585167 at these rates, with retries and diagnostic calls.
Four other failed summary calls have unknown cost.
The W6 `cost-report.json` artifact lists the measured token counts and price estimates.
