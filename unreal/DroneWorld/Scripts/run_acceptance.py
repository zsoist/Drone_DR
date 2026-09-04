"""Performance gate contract; missing editor/GPU measurements cannot pass."""

from __future__ import annotations

import json


def run():
    try:
        import unreal  # noqa: F401
    except ImportError:
        return {
            "status": "blocked_external",
            "blocker": "unreal_python_module_unavailable",
            "avg_fps": None,
            "one_percent_low_fps": None,
            "vram_mib": None,
            "route_completed": None,
        }
    return {
        "status": "requires_loaded_hero_map",
        "avg_fps": None,
        "one_percent_low_fps": None,
        "vram_mib": None,
        "route_completed": None,
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
