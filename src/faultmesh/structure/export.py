"""Build and read deterministic schema 3.0 structure exports."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from contextlib import nullcontext
from pathlib import Path

from faultmesh.project_runner.models import RunEvidenceExport
from faultmesh.structure.git_changes import compare_git, materialize_revision
from faultmesh.structure.index import build_structure_index
from faultmesh.structure.models import (
    ChangeStatus,
    CoverageOverlay,
    CoverageOverlayEntry,
    CoverageOverlayUnmatched,
    FileNode,
    ImpactNeighbor,
    StaticEdge,
    StructureCounts,
    StructureEnvelope,
    StructureExport,
    SymbolGitStatus,
    SymbolNode,
)
from faultmesh.structure.relationships import build_relationships

LIMITATIONS = [
    "Static edges are source-derived possibilities, not proof that a call occurs at runtime.",
    "Absence of an edge is not proof that no call is possible.",
    "No type inference is performed; dynamic dispatch can cause false negatives.",
    "Dynamic imports, getattr, monkeypatching, decorators, native code, and runtime mutation "
    "may not resolve.",
    "Test-file classification is a path-based heuristic.",
    "Git symbol changes use line-range overlap and source-segment hashes, not semantic "
    "equivalence.",
]


def load_v2_export(path: Path) -> RunEvidenceExport:
    return RunEvidenceExport.model_validate_json(path.read_text(encoding="utf-8"))


def build_coverage_overlay(
    v2: RunEvidenceExport,
    files: Sequence[FileNode],
    symbols: list[SymbolNode],
) -> CoverageOverlay:
    file_hashes = {item.path: item.content_sha256 for item in files}
    by_identity: dict[tuple[str, str], list[SymbolNode]] = {}
    for symbol in symbols:
        by_identity.setdefault((symbol.path, symbol.qualified_name), []).append(symbol)
    entries: list[CoverageOverlayEntry] = []
    unmatched: list[CoverageOverlayUnmatched] = []
    for case in v2.tests:
        if case.observation is None:
            continue
        for observed in case.observation.symbols:
            candidates = by_identity.get((observed.path, observed.qualified_name), [])
            if len(candidates) != 1:
                unmatched.append(
                    CoverageOverlayUnmatched(
                        run_id=case.run_id,
                        test_id=case.node_id,
                        path=observed.path,
                        qualified_name=observed.qualified_name,
                        reason="no matching structure symbol"
                        if not candidates
                        else "multiple matching structure symbols",
                    )
                )
                continue
            entries.append(
                CoverageOverlayEntry(
                    run_id=case.run_id,
                    test_id=case.node_id,
                    structure_symbol_id=candidates[0].id,
                    path=observed.path,
                    qualified_name=observed.qualified_name,
                    stale=file_hashes.get(observed.path) != observed.content_sha256,
                    phases=[phase.value for phase in observed.phases],
                    executed_lines=observed.executed_lines,
                )
            )
    return CoverageOverlay(
        entries=sorted(
            entries,
            key=lambda item: (item.run_id, item.test_id, item.structure_symbol_id),
        ),
        unmatched=sorted(
            unmatched,
            key=lambda item: (item.run_id, item.test_id, item.path, item.qualified_name),
        ),
    )


def _possible_impact(
    symbols: Sequence[SymbolNode],
    edges: Sequence[StaticEdge],
    statuses: Sequence[SymbolGitStatus],
) -> list[ImpactNeighbor]:
    symbol_ids = {item.id for item in symbols}
    changed = {
        item.symbol_id
        for item in statuses
        if item.status != ChangeStatus.UNCHANGED
    }
    result: list[ImpactNeighbor] = []
    for edge in edges:
        source = edge.source_id
        target = edge.target_id
        edge_id = edge.id
        if target is None or source not in symbol_ids or target not in symbol_ids:
            continue
        if source in changed:
            result.append(
                ImpactNeighbor(
                    changed_symbol_id=source,
                    neighbor_symbol_id=target,
                    edge_id=edge_id,
                    direction="outgoing",
                )
            )
        if target in changed:
            result.append(
                ImpactNeighbor(
                    changed_symbol_id=target,
                    neighbor_symbol_id=source,
                    edge_id=edge_id,
                    direction="incoming",
                )
            )
    return sorted(
        result,
        key=lambda item: (
            item.changed_symbol_id,
            item.neighbor_symbol_id,
            item.edge_id,
            item.direction,
        ),
    )


def build_structure_export(
    root: Path,
    *,
    base: str = "HEAD",
    head: str = "worktree",
    coverage: RunEvidenceExport | None = None,
) -> StructureExport:
    root = root.resolve()
    current = build_structure_index(root)
    git = compare_git(root, current, base=base, head=head)
    view = (
        nullcontext(root)
        if git.comparison.head_is_worktree or git.comparison.head is None
        else materialize_revision(root, git.comparison.head)
    )
    with view as source_root:
        relationships = build_relationships(source_root, git.head_index)
    symbols = sorted(
        [*git.head_index.symbols, *git.removed_symbols],
        key=lambda item: (item.path, item.start_line, item.id),
    )
    overlay = (
        build_coverage_overlay(coverage, git.head_index.files, git.head_index.symbols)
        if coverage is not None
        else None
    )
    edge_counts: dict[str, int] = {}
    for edge in relationships.edges:
        key = f"{edge.kind.value}:{edge.confidence.value}"
        edge_counts[key] = edge_counts.get(key, 0) + 1
    counts = StructureCounts(
        files=len(git.head_index.files),
        symbols=len(symbols),
        edges_by_kind_and_confidence=dict(sorted(edge_counts.items())),
        unresolved=len(relationships.unresolved),
        external_modules=len(relationships.external_modules),
        skipped=sum(item.count for item in git.head_index.skips),
        parse_errors=len(git.head_index.parse_errors),
    )
    impact = _possible_impact(symbols, relationships.edges, git.comparison.symbols)
    body = {
        "project_name": root.name,
        "files": [item.model_dump(mode="json") for item in git.head_index.files],
        "symbols": [item.model_dump(mode="json") for item in symbols],
        "edges": [item.model_dump(mode="json") for item in relationships.edges],
        "unresolved": [item.model_dump(mode="json") for item in relationships.unresolved],
        "external_modules": relationships.external_modules,
        "git": git.comparison.model_dump(mode="json"),
        "skips": [item.model_dump(mode="json") for item in git.head_index.skips],
        "parse_errors": [item.model_dump(mode="json") for item in git.head_index.parse_errors],
        "limitations": LIMITATIONS,
        "counts": counts.model_dump(mode="json"),
        "possible_impact": [item.model_dump(mode="json") for item in impact],
        "coverage_overlay": overlay.model_dump(mode="json") if overlay else None,
    }
    content_hash = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return StructureExport(
        envelope=StructureEnvelope(
            project_name=root.name,
            base_sha=git.comparison.base,
            head_sha=git.comparison.head,
            head_is_worktree=git.comparison.head_is_worktree,
            dirty=git.comparison.dirty,
            content_sha256=content_hash,
        ),
        files=git.head_index.files,
        symbols=symbols,
        edges=relationships.edges,
        unresolved=relationships.unresolved,
        external_modules=relationships.external_modules,
        git=git.comparison,
        skips=git.head_index.skips,
        parse_errors=git.head_index.parse_errors,
        limitations=LIMITATIONS,
        counts=counts,
        possible_impact=impact,
        coverage_overlay=overlay,
    )


def load_structure_export(path: Path) -> StructureExport:
    return StructureExport.model_validate_json(path.read_text(encoding="utf-8"))
