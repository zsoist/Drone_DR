"""Reference capture gate; it never fabricates images outside Unreal."""

from __future__ import annotations

import json


def capture():
    try:
        import unreal  # noqa: F401
    except ImportError:
        return {"status": "blocked_external", "blocker": "unreal_python_module_unavailable", "captures": []}
    return {"status": "requires_loaded_hero_map", "captures": []}


if __name__ == "__main__":
    print(json.dumps(capture(), sort_keys=True))
