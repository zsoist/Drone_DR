"""Serializable semantic nodes for editable downstream worlds."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class SceneNode:
    node_id: str
    semantic_class: str
    geometry_role: str
    editable: bool = True


@dataclass(frozen=True)
class SceneGraph:
    version: int
    nodes: tuple[SceneNode, ...]

    def as_dict(self) -> dict:
        return {"version": self.version, "nodes": [asdict(node) for node in self.nodes]}
