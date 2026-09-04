"""Completion hypotheses remain reversible, seeded, and explicitly generated."""

from __future__ import annotations

from dataclasses import dataclass

from world_compiler.evidence.truth_field import TruthClass

from .validator import ObservationCheck, RefutationReport, validate_hypothesis


@dataclass(frozen=True)
class CompletionHypothesis:
    hypothesis_id: str
    method: str
    seed: int
    bounds: tuple[float, float, float, float, float, float]
    constraints: tuple[str, ...] = ()
    provenance: TruthClass = TruthClass.GENERATED_CONSTRAINED


@dataclass(frozen=True)
class CompletionDecision:
    selected: CompletionHypothesis
    reports: tuple[RefutationReport, ...]


def select_hypothesis(
    hypotheses: list[CompletionHypothesis],
    observations: dict[str, list[ObservationCheck]],
) -> CompletionDecision:
    reports = tuple(
        validate_hypothesis(hypothesis, observations.get(hypothesis.hypothesis_id, []))
        for hypothesis in sorted(hypotheses, key=lambda row: row.hypothesis_id)
    )
    report_by_id = {report.hypothesis_id: report for report in reports}
    accepted = [
        hypothesis
        for hypothesis in hypotheses
        if not report_by_id[hypothesis.hypothesis_id].rejected
    ]
    if not accepted:
        raise ValueError("all completion hypotheses were refuted")
    selected = sorted(
        accepted,
        key=lambda row: (-report_by_id[row.hypothesis_id].score, row.hypothesis_id),
    )[0]
    return CompletionDecision(selected, reports)
