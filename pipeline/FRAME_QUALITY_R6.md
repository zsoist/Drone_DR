# Frame and highlight contracts

`ai/frame_api.py` checks JSON from all GET routes.
Each frame has `quality.status`, `quality.reason`, `quality.reasons`, and `quality.mean_luminance`.
The status is `ok` or `rejected`.
The `eligible` field is available.
Lists contain only approved frames. The URL is `null` when the image fails.

In the flight manifest, `thumbnail` and `thumb_url` describe each image for recent flights and trip journals.
Search, collections, recaps, and scene posters use the same policy.
The server redirects each legacy thumbnail URL to an approved frame.
If a legacy image fails, the server returns a neutral SVG with `X-Frame-Quality: rejected`.
GET requests do not write files or call a vision provider.

For a property, the response has `gallery`, `gallery_n`, and `cover`.
The gallery uses only the linked `clip` and `clips` values.
Different clips take priority. Frames from one clip must be at least 20 seconds apart.
The maximum is six frames. The response has fewer frames when evidence is insufficient.

The policy for privacy is conservative.
Clip evidence of text, signs, people, or quality problems rejects all frames from that clip.
The policy also rejects dark and unreadable images. Absent files fail the check.
This policy does not do OCR or face detection.

The Guaduas property has no eligible gallery frames under this policy.
It needs more approved source footage or a separate review of individual frames.

## Local highlights

`ai/highlight_peaks.py` reads at most 600 stored JPEG files per clip.
It measures image differences at a size of 48 by 27 pixels.
It uses peaks in image changes with the stored vision scores and best-frame times.
The scores of old segments give secondary evidence only. They do not establish a highlight alone.

Each highlight includes its observed peak time, previous frame time, difference, threshold, and vision score.
The maximum is four segments per clip. Segments last three to six seconds.
Selected peaks must be at least 20 seconds apart.
Uniform changes and static images produce no highlights and `synthetic: true`. Absent evidence gives the same result.

Sparse images cannot prove continuous motion between samples.
The insight from the provider stays separate from the derived public intervals.

## Data repair

Run the command with the project Python interpreter:

```sh
/Volumes/SSD/_system/venv/bin/python3 ai/backfill_frame_quality.py \
  --limit 130 \
  --backup-dir /Volumes/SSD/tmp/agents/aerobrain/W6/round6-backup \
  --dry-run
```

Remove `--dry-run` to write the results.
The command makes backups before writes and checks for concurrent changes.
It repairs local highlights, property galleries, and summaries. It preserves owner highlights and the original provider evidence.
The command makes no paid calls. Its JSON report gives the cost, counts, and galleries with insufficient frames.
