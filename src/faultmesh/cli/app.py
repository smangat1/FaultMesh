"""Typer command-line interface."""

from __future__ import annotations

import json
import shlex
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Annotated

import typer

from faultmesh import __version__
from faultmesh.analysis import ProjectAnalyzer
from faultmesh.api import AnalysisOptions, analyze_repository, reproduce_incident
from faultmesh.config import FaultMeshConfig
from faultmesh.evidence import EvidenceStore
from faultmesh.inference.backends import (
    InferenceBackend,
    LlamaCppCliBackend,
    LlamaCppServerBackend,
)
from faultmesh.project_runner import (
    ReplayComparison,
    RunOutcome,
    export_run,
    get_test_case,
    replay_failed_test,
    run_project_tests,
)
from faultmesh.project_runner.replay import open_run_store
from faultmesh.replay.adapter import capture_hook_event
from faultmesh.replay.chapters import ChapterProposalBatch, propose_chapters
from faultmesh.replay.claims import ClaimBatch, ClaimNarrator, build_evidence_packet
from faultmesh.replay.ingest import ingest_jsonl
from faultmesh.replay.models import CaptureEnvelope, ReplayExport
from faultmesh.replay.narration import (
    MODEL_PRESETS,
    ReplayNarrationExport,
    StepNarration,
    build_narration_export,
    build_no_model_narration,
    inventory_local_models,
    load_replay_document,
    suggest_likely_reason,
)
from faultmesh.replay.store import ReplayStore, default_replay_root
from faultmesh.replay.views import (
    export_session,
    load_export,
    select_checkpoint,
    select_export_checkpoint,
    timeline,
)
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


def _replay_store_path(value: Path | None) -> Path:
    return value.expanduser().resolve() if value is not None else default_replay_root()


@app.command("replay-start")
def replay_start(
    project: Annotated[Path, typer.Argument(exists=True, file_okay=False, resolve_path=True)],
    codex_version: Annotated[
        str, typer.Option(help="Exact Codex adapter version, for example codex-cli 0.165.0.")
    ],
    store: Annotated[
        Path | None, typer.Option(help="Local replay store root; defaults outside the project.")
    ] = None,
    raw_logging: Annotated[
        bool,
        typer.Option(
            "--raw-logging",
            help="Opt in to unredacted local tool input/output storage.",
        ),
    ] = False,
) -> None:
    """Select one project and start a new explicit local recording."""
    store_path = _replay_store_path(store)
    try:
        with ReplayStore(store_path) as replay_store:
            session = replay_store.create_session(
                project, codex_version=codex_version, raw_logging=raw_logging
            )
    except Exception as exc:
        typer.secho(f"FaultMesh replay start failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    hook_command = " ".join(
        [
            "faultmesh",
            "replay-hook",
            shlex.quote(session.id),
            "--store",
            shlex.quote(str(store_path)),
        ]
    )
    typer.echo(
        json.dumps(
            {
                "session": session.model_dump(mode="json"),
                "hook_command": hook_command,
                "hook_matcher": "^(Bash|apply_patch)$",
                "note": "Configure the same command for synchronous PreToolUse and PostToolUse.",
            },
            indent=2,
            sort_keys=True,
        )
    )


@app.command("replay-hook", hidden=True)
def replay_hook(
    session_id: Annotated[str, typer.Argument()],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """Ingest one Codex hook event from stdin for an active selected session."""
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        typer.secho("FaultMesh replay hook input exceeded 1 MiB", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)
    try:
        event = json.loads(raw)
        with ReplayStore(_replay_store_path(store)) as replay_store:
            capture_hook_event(replay_store, session_id, event)
    except Exception as exc:
        typer.secho(f"FaultMesh replay hook failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc


@app.command("replay-stop")
def replay_stop(
    session_id: Annotated[str, typer.Argument()],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """Stop an active recording; historical evidence remains immutable."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            session = replay_store.stop_session(session_id)
    except Exception as exc:
        typer.secho(f"FaultMesh replay stop failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(session.model_dump_json(indent=2))


@app.command("replay-sessions")
def replay_sessions(
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """List local recording metadata without reading any Codex history."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            sessions = replay_store.list_sessions()
    except Exception as exc:
        typer.secho(f"FaultMesh replay list failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            [session.model_dump(mode="json") for session in sessions],
            indent=2,
            sort_keys=True,
        )
    )


@app.command("replay-ingest")
def replay_ingest(
    session_id: Annotated[str, typer.Argument()],
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
    source_name: Annotated[str | None, typer.Option(help="Stable logical source identity.")] = None,
) -> None:
    """Ingest append-only replay-capture-1.0 NDJSON without executing it."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            result = ingest_jsonl(
                replay_store, session_id, source, source_name=source_name
            )
    except Exception as exc:
        typer.secho(f"FaultMesh replay ingest failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(json.dumps(result.__dict__, indent=2, sort_keys=True))


@app.command("replay-delete")
def replay_delete(
    session_id: Annotated[str, typer.Argument()],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """Delete one whole selected recording and its unreferenced local content."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            replay_store.delete_session(session_id)
    except Exception as exc:
        typer.secho(f"FaultMesh replay delete failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(json.dumps({"deleted_session": session_id}, sort_keys=True))


@app.command("replay-timeline")
def replay_timeline(
    session_id: Annotated[str, typer.Argument()],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """Print an ordered evidence timeline without touching the original checkout."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            entries = timeline(replay_store, session_id)
    except Exception as exc:
        typer.secho(f"FaultMesh replay timeline failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            [entry.model_dump(mode="json") for entry in entries],
            indent=2,
            sort_keys=True,
        )
    )


@app.command("replay-checkpoint")
def replay_checkpoint(
    session_id: Annotated[str, typer.Argument()],
    sequence: Annotated[int, typer.Argument(min=1)],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """Select one stored checkpoint read-only; never apply or execute it."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            selected = select_checkpoint(replay_store, session_id, sequence)
    except Exception as exc:
        typer.secho(f"FaultMesh replay checkpoint failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(selected.model_dump_json(indent=2))


@app.command("replay-export")
def replay_export(
    session_id: Annotated[str, typer.Argument()],
    out: Annotated[Path, typer.Option(help="Write deterministic offline replay JSON here.")],
    store: Annotated[Path | None, typer.Option(help="Local replay store root.")] = None,
) -> None:
    """Export stored replay evidence without reading the selected checkout."""
    try:
        with ReplayStore(_replay_store_path(store)) as replay_store:
            exported = export_session(replay_store, session_id)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(exported.model_dump_json(indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        typer.secho(f"FaultMesh replay export failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            {
                "schema_version": exported.schema_version,
                "session_id": session_id,
                "records": len(exported.records),
                "path": str(out.resolve()),
            },
            sort_keys=True,
        )
    )


@app.command("replay-view-export")
def replay_view_export(
    export_file: Annotated[
        Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)
    ],
    sequence: Annotated[int, typer.Option(min=1)],
) -> None:
    """Select historical source from an offline export with no store or checkout."""
    try:
        selected = select_export_checkpoint(load_export(export_file), sequence)
    except Exception as exc:
        typer.secho(f"FaultMesh exported replay failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(selected.model_dump_json(indent=2))


@app.command("replay-model-inventory")
def replay_model_inventory(
    search_root: Annotated[
        list[Path], typer.Argument(exists=True, resolve_path=True)
    ],
    available_memory_bytes: Annotated[
        int | None,
        typer.Option(
            min=0,
            help="Optional measured available memory; omitted means not measured.",
        ),
    ] = None,
) -> None:
    """Hash local GGUF files under explicit roots without loading or downloading them."""
    inventory = inventory_local_models(
        search_root, available_memory_bytes=available_memory_bytes
    )
    typer.echo(inventory.model_dump_json(indent=2))


@app.command("replay-narrate")
def replay_narrate(
    export_file: Annotated[
        Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)
    ],
    out: Annotated[Path, typer.Option(help="Write replay-export-2.0 JSON here.")],
    backend: Annotated[
        str, typer.Option(help="none, llama-cli, or llama-server")
    ] = "none",
    preset: Annotated[
        str, typer.Option(help="small-1.5b, medium-3b, or large-7b resource caps")
    ] = "small-1.5b",
    model_path: Annotated[Path | None, typer.Option(help="Explicit local GGUF path")] = None,
    llama_executable: Annotated[str, typer.Option()] = "llama-cli",
    endpoint: Annotated[str | None, typer.Option(help="Loopback llama-server endpoint")] = None,
    model_name: Annotated[str, typer.Option(help="Server-reported local model name")] = (
        "local-model"
    ),
) -> None:
    """Add local checked narration to an offline replay export; never touch its checkout."""
    try:
        document = load_replay_document(export_file)
        if not isinstance(document, ReplayExport):
            raise ValueError("input is already an enriched replay-export-2.0 document")
        if preset not in MODEL_PRESETS:
            raise ValueError(f"unknown preset: {preset}")
        selected = MODEL_PRESETS[preset]
        inference_backend: InferenceBackend | None = None
        if backend == "llama-cli":
            if model_path is None or not model_path.is_file():
                raise ValueError("llama-cli requires an existing explicit --model-path")
            inference_backend = LlamaCppCliBackend(
                llama_executable,
                model_path,
                timeout_seconds=selected.timeout_seconds,
                context_size=selected.context_size,
                max_output_tokens=selected.max_output_tokens,
            )
        elif backend == "llama-server":
            if endpoint is None:
                raise ValueError("llama-server requires an explicit loopback --endpoint")
            inference_backend = LlamaCppServerBackend(
                endpoint,
                model=model_name,
                timeout_seconds=selected.timeout_seconds,
                max_output_tokens=selected.max_output_tokens,
            )
        elif backend != "none":
            raise ValueError("backend must be none, llama-cli, or llama-server")
        if inference_backend is None:
            enriched = build_no_model_narration(document)
        else:
            claim_narrator = ClaimNarrator(
                inference_backend,
                model_config_id=(
                    f"{backend}:{preset}:{model_path.name if model_path else model_name}"
                ),
            )
            steps: list[StepNarration] = []
            for record in sorted(document.records, key=lambda item: item.sequence):
                packet = build_evidence_packet(document, record.sequence)
                steps.append(
                    StepNarration(
                        sequence=record.sequence,
                        packet=packet,
                        claims=claim_narrator.run(packet),
                        reason=suggest_likely_reason(
                            document, record.sequence, inference_backend
                        ),
                    )
                )
            enriched = build_narration_export(
                document,
                steps=steps,
                chapter_run=propose_chapters(document, inference_backend),
            )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(enriched.model_dump_json(indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        typer.secho(f"FaultMesh replay narration failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(
        json.dumps(
            {
                "schema_version": enriched.schema_version,
                "mode": "no-model" if backend == "none" else backend,
                "steps": len(enriched.narration),
                "chapters": len(enriched.chapters),
                "path": str(out.resolve()),
            },
            sort_keys=True,
        )
    )


@app.command("replay-schema")
def replay_schema(
    contract: Annotated[
        str,
        typer.Argument(
            help="capture, export, narration-export, claims, or chapter-proposals"
        ),
    ],
) -> None:
    """Print the strict machine-readable capture or export JSON Schema."""
    if contract == "capture":
        schema = CaptureEnvelope.model_json_schema()
    elif contract == "export":
        schema = ReplayExport.model_json_schema()
    elif contract == "narration-export":
        schema = ReplayNarrationExport.model_json_schema()
    elif contract == "claims":
        schema = ClaimBatch.model_json_schema()
    elif contract == "chapter-proposals":
        schema = ChapterProposalBatch.model_json_schema()
    else:
        raise typer.BadParameter(
            "contract must be capture, export, narration-export, claims, or chapter-proposals"
        )
    typer.echo(json.dumps(schema, indent=2, sort_keys=True))


@app.command("replay-demo")
def replay_demo() -> None:
    """Run a no-model disposable capture/export/playback demonstration."""
    with tempfile.TemporaryDirectory(prefix="faultmesh-replay-demo-") as temporary:
        base = Path(temporary)
        project = base / "project"
        project.mkdir()
        source = project / "value.py"
        source.write_text("def value() -> int:\n    return 1\n", encoding="utf-8")
        store_root = base / "store"
        export_path = base / "replay.json"
        with ReplayStore(store_root) as replay_store:
            session = replay_store.create_session(
                project, codex_version="synthetic-demo-no-agent"
            )
            source.write_text("def value() -> int:\n    return 2\n", encoding="utf-8")
            later = replay_store.capture_checkpoint(session.id, provenance="synthetic_demo")
            exported = export_session(replay_store, session.id)
            export_path.write_text(exported.model_dump_json(indent=2) + "\n", encoding="utf-8")
        shutil.rmtree(project)
        earlier = select_export_checkpoint(load_export(export_path), 1)
        latest = select_export_checkpoint(load_export(export_path), later.sequence)
        typer.echo(
            json.dumps(
                {
                    "checkout_exists_during_playback": project.exists(),
                    "earlier_source": earlier.files[0].text,
                    "later_source": latest.files[0].text,
                    "model_used": False,
                    "original_checkout_written_during_playback": False,
                    "records": len(exported.records),
                    "schema_version": exported.schema_version,
                },
                indent=2,
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

