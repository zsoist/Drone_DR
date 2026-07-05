"""Processing-tier policy: decides how much compute each clip deserves.

Tiers (what process.py does per tier):
  "full"     → proxy 1080p + keyframes + track + thumb   (más caro: ~1-2 min/clip)
  "standard" → keyframes + track + thumb                 (barato: segundos)
  "skim"     → track + thumb solamente                   (casi gratis)

`meta` llega con:
  duration_s   float  — duración del clip (ej. 222.7)
  size_bytes   int    — tamaño del original (ej. 3_500_000_000)
  has_srt      bool   — si hay telemetría GPS
  stats        dict   — del SRT: distance_m, max_rel_alt_m, bbox... ({} si no hay)
  resolution   str    — "3840x2160"
  fps          float  — 59.94
"""


def processing_tier(meta: dict) -> str:
    """Return "full" | "standard" | "skim" for this clip.

    TODO(human): implementa la política de tiers.
    """
    raise NotImplementedError("TODO(human)")
