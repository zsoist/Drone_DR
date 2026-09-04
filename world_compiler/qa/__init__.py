"""Measured acceptance helpers; absent evidence never passes."""

from .geometry_metrics import load_collision_vertices, source_vertex_agreement, summarize_errors
from .performance import evaluate_performance
from .reference_views import crop_source_ortho, render_dsm_hillshade, render_truth_debug
from .report import acceptance_verdict, write_acceptance_report

__all__ = [
    "acceptance_verdict", "crop_source_ortho", "evaluate_performance",
    "load_collision_vertices", "render_dsm_hillshade", "render_truth_debug",
    "source_vertex_agreement", "summarize_errors",
    "write_acceptance_report",
]
