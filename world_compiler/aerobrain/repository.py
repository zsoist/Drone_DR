"""Read immutable scene/version inputs without invoking mutating pipeline builders."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .manifests import hash_file, load_object


_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_REQUIRED_ASSETS = {
    "terrain": ("dsm_lod_meta", "dsm_lod_bin"),
    "mesh": ("mesh_viewer",),
    "collision": ("collision_bin", "collision_meta"),
}
_OPTIONAL_ASSETS = (
    "dsm_lod_mask",
    "mesh_coverage",
    "mesh_coverage_meta",
    "ortho",
    "ortho_full",
    "splat",
)


class RepositoryError(ValueError):
    """An AeroBrain source violates the compiler's read-only input contract."""


@dataclass(frozen=True)
class SceneVersion:
    scene_id: str
    version_id: str
    is_active: bool
    scene_manifest_path: Path
    world_manifest_path: Path
    model_dir: Path
    scene: dict
    version: dict
    world_manifest: dict
    capabilities: frozenset[str]
    required_capabilities: frozenset[str]
    assets: dict[str, Path]
    source_hashes: dict[str, str]
    world_size_m: tuple[float, float]
    camera_reconstruction_path: Path | None
    camera_image_dir: Path | None


class WorldRepository:
    """Resolve promotable scene versions while preserving the vault byte-for-byte."""

    required_capabilities = frozenset(_REQUIRED_ASSETS)

    def __init__(self, vault: Path):
        self.vault = Path(vault).resolve()

    @staticmethod
    def _valid_id(value: str, label: str) -> str:
        value = str(value or "")
        if not _ID.fullmatch(value):
            raise RepositoryError(f"invalid {label} id")
        return value

    def _inside_vault(self, path: Path) -> Path:
        resolved = path.resolve()
        if not resolved.is_relative_to(self.vault):
            raise RepositoryError("asset path escapes vault")
        return resolved

    def _asset_path(self, model_dir: Path, raw: object) -> Path:
        value = str(raw or "")
        if not value:
            raise RepositoryError("missing asset path")
        if value.startswith("data/"):
            candidate = self.vault / value.removeprefix("data/")
            allowed_root = self.vault
        else:
            candidate = model_dir / value
            allowed_root = model_dir
        path = self._inside_vault(candidate)
        if not path.is_relative_to(allowed_root.resolve()):
            raise RepositoryError("asset path escapes vault")
        if not path.is_file():
            raise RepositoryError(f"asset does not exist: {path.name}")
        return path

    def _camera_image_directory(self, reconstruction: Path) -> Path | None:
        project = self._inside_vault(Path(reconstruction).resolve().parents[1])
        direct = self._inside_vault(project / "images")
        if direct.is_dir():
            return direct
        parent_name = re.sub(r"_aoi\d+$", "", project.name)
        if parent_name == project.name:
            return None
        inherited = self._inside_vault(project.parent / parent_name / "images")
        return inherited if inherited.is_dir() else None

    def resolve_scene(
        self, scene_id: str, version_id: str | None = None
    ) -> SceneVersion:
        scene_id = self._valid_id(scene_id, "scene")
        scene_path = self._inside_vault(
            self.vault / "manifest" / "scenes" / f"{scene_id}.json"
        )
        try:
            scene = load_object(scene_path)
        except (FileNotFoundError, ValueError) as error:
            raise RepositoryError(f"invalid scene manifest: {scene_id}") from error
        if int(scene.get("schema") or 0) < 2 or scene.get("id") != scene_id:
            raise RepositoryError("unsupported or mismatched scene manifest")

        active_version = self._valid_id(scene.get("active_version"), "active version")
        selected_id = self._valid_id(version_id or active_version, "version")
        selected = next(
            (
                row
                for row in scene.get("versions") or []
                if isinstance(row, dict) and row.get("id") == selected_id
            ),
            None,
        )
        if selected is None:
            raise RepositoryError(f"version not found: {selected_id}")
        if (
            selected.get("status") != "ready"
            or selected.get("merge_label") not in ("SINGLE", "FULL")
            or selected.get("required_artifacts_ok") is not True
        ):
            raise RepositoryError("version is not promotable")

        model_dir = self._inside_vault(self.vault / "models" / selected_id)
        manifest_path = self._inside_vault(model_dir / "scene.v2.json")
        try:
            manifest = load_object(manifest_path)
        except (FileNotFoundError, ValueError) as error:
            raise RepositoryError(f"invalid world manifest: {selected_id}") from error
        if manifest.get("version") != 2 or manifest.get("clip_id") != selected_id:
            raise RepositoryError("unsupported or mismatched world manifest")

        capability_map = manifest.get("capabilities") or {}
        capabilities = frozenset(
            name for name, available in capability_map.items() if available is True
        )
        for capability in sorted(self.required_capabilities):
            if capability not in capabilities:
                raise RepositoryError(f"missing required capability: {capability}")
        collision = manifest.get("collision") or {}
        if collision.get("status") != "ready" or int(collision.get("version") or 0) < 3:
            raise RepositoryError("collision capability is stale or unvalidated")

        raw_assets = manifest.get("assets") or {}
        assets: dict[str, Path] = {}
        for capability, names in _REQUIRED_ASSETS.items():
            for name in names:
                try:
                    assets[name] = self._asset_path(model_dir, raw_assets.get(name))
                except RepositoryError as error:
                    raise RepositoryError(
                        f"{capability} asset invalid ({name}): {error}"
                    ) from error
        for name in _OPTIONAL_ASSETS:
            raw = raw_assets.get(name)
            if raw:
                try:
                    assets[name] = self._asset_path(model_dir, raw)
                except RepositoryError as error:
                    raise RepositoryError(f"optional asset invalid ({name}): {error}") from error

        world = manifest.get("world") or {}
        try:
            width, height = (float(value) for value in world["size_m"])
        except (KeyError, TypeError, ValueError) as error:
            raise RepositoryError("world extent is missing or invalid") from error
        if width <= 0 or height <= 0:
            raise RepositoryError("world extent is missing or invalid")

        hashes = {
            "scene_manifest": hash_file(scene_path),
            "world_manifest": hash_file(manifest_path),
        }
        hashes.update(
            {f"asset:{name}": hash_file(path) for name, path in sorted(assets.items())}
        )
        camera_reconstruction = self._inside_vault(
            self.vault / "odm" / f"proj_{selected_id}" / "opensfm" / "reconstruction.json"
        )
        if camera_reconstruction.is_file():
            hashes["camera_reconstruction"] = hash_file(camera_reconstruction)
            camera_image_dir = self._camera_image_directory(camera_reconstruction)
        else:
            camera_reconstruction = None
            camera_image_dir = None
        return SceneVersion(
            scene_id=scene_id,
            version_id=selected_id,
            is_active=selected_id == active_version,
            scene_manifest_path=scene_path,
            world_manifest_path=manifest_path,
            model_dir=model_dir,
            scene=scene,
            version=selected,
            world_manifest=manifest,
            capabilities=capabilities,
            required_capabilities=self.required_capabilities,
            assets=assets,
            source_hashes=hashes,
            world_size_m=(width, height),
            camera_reconstruction_path=camera_reconstruction,
            camera_image_dir=camera_image_dir,
        )
