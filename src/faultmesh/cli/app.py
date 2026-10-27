"""Typer command-line interface."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal, cast

import typer

from faultmesh import __version__
from faultmesh.analysis import ProjectAnalyzer
from faultmesh.api import AnalysisOptions, analyze_repository, reproduce_incident
from faultmesh.benchmark.phase2 import Arm, Phase2PilotOptions, run_phase2_pilot
from faultmesh.config import FaultMeshConfig
from faultmesh.evidence import EvidenceStore
from faultmesh.project_runner import (
    ReplayComparison,
    RunOutcome,
    export_run,
    get_test_case,
    replay_failed_test,
    run_project_tests,
)
from faultmesh.project_runner.replay import open_run_store
from faultmesh.spectate.engine import (
    SpectateEngine,
    SpectateError,
    default_limits,
    run_until_stdin_close_or_signal,
    stdout_sink,
)
from faultmesh.structure import build_structure_export, load_structure_export, load_v2_export
from faultmesh.telemetry import configure_json_logging

app = typer.Typer(
    no_args_is_help=True,
    help="Evidence-driven, offline-first bug discovery and reproduction for Python.",
)
benchmark_app = typer.Typer(no_args_is_help=True, help="Bounded reproducible benchmarks.")
app.add_typer(benchmark_app, name="benchmark")


@benchmark_app.command("phase2-pilot")
def phase2_pilot(
    manifest: Annotated[
        Path, typer.Option(exists=True, dir_okay=False, resolve_path=True)
    ],
    raw_out: Annotated[Path, typer.Option(resolve_path=True)],
    arms: Annotated[str, typer.Option()],
    seeds: Annotated[str, typer.Option()],
    max_properties: Annotated[int, typer.Option(min=1)],
    max_examples: Annotated[int, typer.Option(min=1)],
    confirmation_runs: Annotated[int, typer.Option(min=1)],
    max_model_calls: Annotated[int, typer.Option(min=1)],
    max_repairs: Annotated[int, typer.Option(min=0)],
    timeout_seconds: Annotated[int, typer.Option(min=1)],
    split: Annotated[str, typer.Option(help="development, heldout, or all")] = "all",
    model_path: Annotated[Path | None, typer.Option(resolve_path=True)] = None,
    llama_cli: Annotated[str, typer.Option()] = "llama-completion",
) -> None:
    """Run the locked phase-2 proposal pilot without changing its budgets."""

    allowed_arms = {
        "slm-only",
        "baseline-only",
        "combined",
        "heuristic-ablation",
    }
    parsed_arms = tuple(part.strip() for part in arms.split(",") if part.strip())
    if not parsed_arms or any(part not in allowed_arms for part in parsed_arms):
        raise typer.BadParameter(f"arms must be drawn from {sorted(allowed_arms)}")
    try:
        parsed_seeds = tuple(int(part.strip()) for part in seeds.split(",") if part.strip())
    except ValueError as exc:
        raise typer.BadParameter("seeds must be comma-separated integers") from exc
    if split not in {"development", "heldout", "all"}:
        raise typer.BadParameter("split must be development, heldout, or all")
    try:
        summary, report_path = run_phase2_pilot(
            Phase2PilotOptions(
                manifest=manifest,
                raw_out=raw_out,
                arms=cast(tuple[Arm, ...], parsed_arms),
                seeds=parsed_seeds,
                max_properties=max_properties,
                max_examples=max_examples,
                confirmation_runs=confirmation_runs,
                max_model_calls=max_model_calls,
                max_repairs=max_repairs,
                timeout_seconds=timeout_seconds,
                split=cast(Literal["development", "heldout", "all"], split),
                model_path=model_path,
                llama_cli=llama_cli,
            )
        )
    except Exception as exc:
        typer.secho(f"Phase 2 pilot failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            {"raw": str(raw_out), "summary": str(summary), "report": str(report_path)},
            indent=2,
        )
    )


@app.command()
def analyze(
    repository: Annotated[Path, typer.Argument(exists=True, file_okay=False, resolve_path=True)],
    model: Annotated[
        str | None, typer.Option(help="llama-server, llama-cli, or heuristic")
    ] = None,
    focus: Annotated[Path | None, typer.Option(help="Project-relative path to inspect")] = None,
    allow_local_execution: Annotated[
        bool,
        typer.Option(
            "--allow-local-execution",
            help="UNSAFE: execute this trusted repository in a host subprocess instead of Docker.",
        ),
    ] = False,
    llama_endpoint: Annotated[str | None, typer.Option()] = None,
    llama_model: Annotated[str | None, typer.Option()] = None,
    model_path: Annotated[Path | None, typer.Option()] = None,
    json_logs: Annotated[
        bool, typer.Option("--json-logs", help="Emit structured progress events to stderr.")
    ] = False,
) -> None:
    """Analyze a repository and persist evidence plus verified incident artifacts."""
    if json_logs:
        configure_json_logging()
    try:
        summary = analyze_repository(
            repository,
            AnalysisOptions(
                focus=focus,
                model=model,
                allow_local_execution=allow_local_execution,
                llama_endpoint=llama_endpoint,
                llama_model=llama_model,
                model_path=model_path,
            ),
        )
    except Exception as exc:
        typer.secho(f"FaultMesh analysis failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(
        json.dumps(
            {
                "investigation_id": summary.investigation_id,
                "indexed_functions": len(summary.project_index.functions),
                "hypotheses": summary.hypothesis_ids,
                "incidents": [incident.id for incident in summary.incidents],
                "evidence_database": str(summary.evidence_database),
                "sandbox": summary.sandbox,
                "model_calls": len(summary.inference),
            },
            indent=2,
        )
    )


@app.command("inspect")
def inspect_repository(
    repository: Annotated[Path, typer.Argument(exists=True, file_okay=False, resolve_path=True)],
    focus: Annotated[Path | None, typer.Option()] = None,
) -> None:
    """Print the non-executing AST index as JSON."""
    index = ProjectAnalyzer().analyze(repository, focus=focus)
    typer.echo(index.model_dump_json(indent=2))


@app.command()
def reproduce(
    incident_id: Annotated[str, typer.Argument()],
    repository: Annotated[
        Path, typer.Option(exists=True, file_okay=False, resolve_path=True)
    ] = Path("."),
    allow_local_execution: Annotated[bool, typer.Option("--allow-local-execution")] = False,
) -> None:
    """Replay a saved concrete counterexample."""
    try:
        result = reproduce_incident(
            repository, incident_id, allow_local_execution=allow_local_execution
        )
    except Exception as exc:
        typer.secho(f"FaultMesh replay failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(result.model_dump_json(indent=2))
    if result.reproduction_rate < 1.0 or result.fingerprint_matched is False:
        raise typer.Exit(code=2)


@app.command()
def report(
    incident_id: Annotated[str, typer.Argument()],
    repository: Annotated[
        Path, typer.Option(exists=True, file_okay=False, resolve_path=True)
    ] = Path("."),
    format: Annotated[str, typer.Option(help="markdown or json")] = "markdown",
) -> None:
    """Print a persisted incident report."""
    config = FaultMeshConfig.load(repository)
    with EvidenceStore(repository / config.artifact_directory / "evidence.sqlite3") as store:
        incident = store.get_incident(incident_id)
    if not incident.artifacts:
        raise typer.BadParameter("incident has no report artifacts")
    if format == "markdown":
        typer.echo(Path(incident.artifacts.markdown_report).read_text(encoding="utf-8"))
    elif format == "json":
        typer.echo(Path(incident.artifacts.incident_json).read_text(encoding="utf-8"))
    else:
        raise typer.BadParameter("format must be 'markdown' or 'json'")


@app.command("run-tests")
def run_tests(
    config: Annotated[
        Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)
    ],
    observe: Annotated[
        bool, typer.Option("--observe", help="Record per-test executed source evidence.")
    ] = False,
) -> None:
    """Run an existing pytest suite in its configured Docker environment."""
    try:
        result = run_project_tests(config, observe=observe)
    except Exception as exc:
        typer.secho(f"FaultMesh test run failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(result.model_dump_json(indent=2))
    if result.outcome == RunOutcome.FAILED:
        raise typer.Exit(code=1)
    if result.outcome != RunOutcome.PASSED:
        raise typer.Exit(code=2)


@app.command("test-run")
def test_run(
    run_id: Annotated[str, typer.Argument()],
    config: Annotated[
        Path, typer.Option(exists=True, dir_okay=False, resolve_path=True)
    ],
) -> None:
    """Print one durable project test run without executing it again."""
    try:
        with open_run_store(config) as store:
            result = store.get(run_id)
    except Exception as exc:
        typer.secho(f"FaultMesh run lookup failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(result.model_dump_json(indent=2))


@app.command("test-cases")
def test_cases(
    run_id: Annotated[str, typer.Argument()],
    config: Annotated[
        Path, typer.Option(exists=True, dir_okay=False, resolve_path=True)
    ],
) -> None:
    """List exact pytest node IDs stored for one run."""
    try:
        with open_run_store(config) as store:
            cases = store.list_tests(run_id)
    except Exception as exc:
        typer.secho(f"FaultMesh test list failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            [
                {
                    "node_id": case.node_id,
                    "outcome": case.outcome.value,
                    "failure_fingerprint": case.failure_fingerprint,
                    "observation_status": (
                        case.observation.status.value if case.observation is not None else None
                    ),
                }
                for case in cases
            ],
            indent=2,
            sort_keys=True,
        )
    )


@app.command("test-evidence")
def test_evidence(
    run_id: Annotated[str, typer.Argument()],
    node_id: Annotated[str, typer.Argument()],
    config: Annotated[
        Path, typer.Option(exists=True, dir_okay=False, resolve_path=True)
    ],
) -> None:
    """Print one test's failure and observed source evidence without executing it."""
    try:
        case = get_test_case(config, run_id, node_id)
    except Exception as exc:
        typer.secho(f"FaultMesh evidence lookup failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(case.model_dump_json(indent=2))


@app.command("export-run")
def export_test_run(
    run_id: Annotated[str, typer.Argument()],
    config: Annotated[
        Path, typer.Option(exists=True, dir_okay=False, resolve_path=True)
    ],
) -> None:
    """Print deterministic versioned JSON for a future read-only adapter."""
    try:
        exported = export_run(config, run_id)
    except Exception as exc:
        typer.secho(f"FaultMesh export failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(json.dumps(exported.model_dump(mode="json"), indent=2, sort_keys=True))


@app.command("replay-test")
def replay_test(
    run_id: Annotated[str, typer.Argument()],
    node_id: Annotated[str, typer.Argument()],
    config: Annotated[
        Path, typer.Option(exists=True, dir_okay=False, resolve_path=True)
    ],
) -> None:
    """Rerun exactly one recorded failed pytest node in the original image."""
    try:
        replayed = replay_failed_test(config, run_id, node_id)
    except Exception as exc:
        typer.secho(f"FaultMesh test replay failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(replayed.model_dump_json(indent=2))
    comparison = replayed.replay.comparison if replayed.replay is not None else None
    if comparison == ReplayComparison.SAME_FAILURE:
        return
    if comparison in {
        ReplayComparison.DIFFERENT_FAILURE,
        ReplayComparison.PASSED_ON_REPLAY,
    }:
        raise typer.Exit(code=1)
    raise typer.Exit(code=2)


@app.command("structure")
def structure_command(
    project: Annotated[Path, typer.Argument(exists=True, file_okay=False, resolve_path=True)],
    base: Annotated[str, typer.Option(help="Git base revision.")] = "HEAD",
    head: Annotated[str, typer.Option(help="Git head revision or worktree.")] = "worktree",
    out: Annotated[Path | None, typer.Option(help="Write schema 3.0 JSON to this file.")] = None,
    coverage: Annotated[
        Path | None,
        typer.Option(
            exists=True,
            dir_okay=False,
            resolve_path=True,
            help="Optional schema 2.0 RunEvidenceExport coverage overlay.",
        ),
    ] = None,
) -> None:
    """Build a non-executing project structure and Git-change export."""
    try:
        v2 = load_v2_export(coverage) if coverage is not None else None
        exported = build_structure_export(project, base=base, head=head, coverage=v2)
    except Exception as exc:
        typer.secho(f"FaultMesh structure failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    serialized = json.dumps(exported.model_dump(mode="json"), indent=2, sort_keys=True) + "\n"
    if out is None:
        typer.echo(serialized, nl=False)
        return
    if out.exists() and out.is_dir():
        raise typer.BadParameter("--out must be a file path")
    out.write_text(serialized, encoding="utf-8")
    typer.echo(
        json.dumps(
            {"content_sha256": exported.envelope.content_sha256, **exported.counts.model_dump()},
            sort_keys=True,
        )
    )


@app.command("structure-summary")
def structure_summary(
    export_file: Annotated[
        Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)
    ],
) -> None:
    """Read a schema 3.0 export and print counts without touching its project."""
    try:
        exported = load_structure_export(export_file)
    except Exception as exc:
        typer.secho(f"FaultMesh structure summary failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            {"content_sha256": exported.envelope.content_sha256, **exported.counts.model_dump()},
            sort_keys=True,
        )
    )


@app.command("spectate")
def spectate_command(
    watch_root: Annotated[
        Path, typer.Argument(exists=True, file_okay=False, resolve_path=True)
    ],
    max_files: Annotated[int, typer.Option(min=1)] = 2_000,
    max_file_bytes: Annotated[int, typer.Option(min=1)] = 512 * 1024,
    max_diff_lines: Annotated[int, typer.Option(min=1)] = 2_000,
    max_events_per_second: Annotated[int, typer.Option(min=1)] = 200,
    max_line_length: Annotated[int, typer.Option(min=1)] = 20_000,
    max_stdout_line_bytes: Annotated[int, typer.Option(min=512)] = 1024 * 1024,
    debounce_ms: Annotated[int, typer.Option(min=0)] = 250,
    poll_ms: Annotated[int, typer.Option(min=1)] = 100,
    coverage: Annotated[
        Path | None,
        typer.Option(
            exists=True,
            dir_okay=False,
            resolve_path=True,
            help="Optional V2 evidence export used only for stale-hash facts.",
        ),
    ] = None,
) -> None:
    """Emit local-only stable Python source changes as newline-delimited JSON."""
    defaults = default_limits()
    limits = defaults.model_copy(
        update={
            "max_files": max_files,
            "max_file_bytes": max_file_bytes,
            "max_diff_lines": max_diff_lines,
            "max_events_per_second": max_events_per_second,
            "max_line_length": max_line_length,
            "max_stdout_line_bytes": max_stdout_line_bytes,
            "debounce_ms": debounce_ms,
            "poll_ms": poll_ms,
        }
    )
    evidence_hashes: dict[str, set[str]] = {}
    if coverage is not None:
        exported = load_v2_export(coverage)
        for case in exported.tests:
            if case.observation is None:
                continue
            for observed in case.observation.symbols:
                evidence_hashes.setdefault(observed.path, set()).add(
                    observed.content_sha256
                )
    try:
        engine = SpectateEngine(
            watch_root,
            limits=limits,
            sink=stdout_sink,
            evidence_hashes=evidence_hashes,
        )
        typer.echo(
            f"FaultMesh spectate watching {watch_root.name}; no tests are rerun.",
            err=True,
        )
        run_until_stdin_close_or_signal(engine)
    except (OSError, SpectateError, ValueError) as exc:
        typer.secho(f"FaultMesh spectate failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc


@app.command()
def version() -> None:
    typer.echo(__version__)


if __name__ == "__main__":
    app()

