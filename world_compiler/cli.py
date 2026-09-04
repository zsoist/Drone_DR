"""Command-line interface for local, privacy-preserving world compilation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from world_compiler.builder import BuildRequest, build_world
from world_compiler.config import DEFAULT_PROFILE, DEFAULT_SIZE_M, DEFAULT_VAULT


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m world_compiler")
    subcommands = parser.add_subparsers(dest="command", required=True)
    build = subcommands.add_parser("build")
    build.add_argument("--scene", required=True)
    build.add_argument("--version")
    build.add_argument("--size", type=float, default=DEFAULT_SIZE_M)
    build.add_argument("--center", default="auto")
    build.add_argument("--profile", default=DEFAULT_PROFILE)
    build.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    build.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.center != "auto":
        try:
            x, z = (float(value) for value in args.center.split(",", 1))
        except (TypeError, ValueError) as error:
            raise SystemExit("--center must be auto or X,Z in AeroBrain meters") from error
        center: str | tuple[float, float] = (x, z)
    else:
        center = "auto"
    summary = build_world(args.vault, BuildRequest(
        args.scene, args.version, args.size, center, args.profile
    ), dry_run=args.dry_run)
    print(json.dumps(summary, sort_keys=True, separators=(",", ":")))
    return 0
