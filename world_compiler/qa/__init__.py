"""Measured acceptance helpers; absent evidence never passes."""

from .geometry_metrics import summarize_errors
from .performance import evaluate_performance
from .report import acceptance_verdict, write_acceptance_report

__all__ = ["acceptance_verdict", "evaluate_performance", "summarize_errors", "write_acceptance_report"]
