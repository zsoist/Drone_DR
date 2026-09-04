"""Confined staging and atomic promotion for derived worlds."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path


_ID = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class WorldPaths:
    """All writable paths for one build, rooted exactly below ``vault/worlds``."""

    vault: Path
    scene_id: str
    hero_id: str
    output_root: Path = field(init=False)
    scene_root: Path = field(init=False)
    target: Path = field(init=False)

    def __post_init__(self) -> None:
        vault = Path(self.vault).resolve()
        if not _ID.fullmatch(self.scene_id):
            raise ValueError("invalid scene id")
        if not re.fullmatch(r"hero_[0-9a-f]{16}", self.hero_id):
            raise ValueError("invalid hero id")
        output_root = (vault / "worlds").resolve()
        scene_root = (output_root / self.scene_id).resolve()
        target = (scene_root / self.hero_id).resolve()
        if scene_root.parent != output_root or target.parent != scene_root:
            raise ValueError("world path escapes output root")
        object.__setattr__(self, "vault", vault)
        object.__setattr__(self, "output_root", output_root)
        object.__setattr__(self, "scene_root", scene_root)
        object.__setattr__(self, "target", target)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def atomic_world_build(
    paths: WorldPaths,
    validator: Callable[[Path], bool] | None = None,
) -> Iterator[Path]:
    """Yield isolated staging and promote it only after successful validation."""
    paths.scene_root.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".staging-{paths.hero_id}-", dir=paths.scene_root)
    ).resolve()
    if staging.parent != paths.scene_root or not staging.name.startswith(".staging-"):
        shutil.rmtree(staging, ignore_errors=True)
        raise ValueError("unsafe staging path")
    try:
        yield staging
        if validator is not None and not validator(staging):
            raise ValueError("validation failed")
        if paths.target.exists():
            raise FileExistsError(f"accepted world already exists: {paths.target.name}")
        _fsync_directory(staging)
        os.replace(staging, paths.target)
        _fsync_directory(paths.scene_root)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
