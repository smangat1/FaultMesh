from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from faultmesh.inference.backends import BackendResult
from faultmesh.replay.claims import (
    ClaimChecker,
    ClaimPredicate,
    ClaimVerdictName,
    FunctionAddedAssertion,
    TypedClaim,
    build_prompt_evidence_packet,
)
from faultmesh.replay.models import ChangedFileView
from faultmesh.replay.narration_runner import (
    PersistentNarrationCache,
    build_prompt_risk_flags,
    run_staged_narration,
)
from faultmesh.replay.store import ReplayStore
from faultmesh.replay.views import export_session


def _changed_export(tmp_path: Path, suffix: str = ".py"):  # type: ignore[no-untyped-def]
    project = tmp_path / "project"
    project.mkdir()
    source = project / f"module{suffix}"
    if suffix == ".py":
        versions = [
            "def stable() -> int:\n    return 1\n",
            "def stable() -> int:\n    return 2\n",
            "def stable() -> int:\n    return 3\n\ndef added() -> int:\n    return 4\n",
        ]
    else:
        versions = [
            "export const stable = () => 1;\n",
            "export const stable = () => 2;\n",
            "export const stable = () => 3;\nexport const added = () => 4;\n",
        ]
    source.write_text(versions[0], encoding="utf-8")
    with ReplayStore(tmp_path / "store") as store:
        session = store.create_session(project, codex_version="synthetic")
        source.write_text(versions[1], encoding="utf-8")
        store.capture_checkpoint(session.id, provenance="synthetic")
        source.write_text(versions[2], encoding="utf-8")
        store.capture_checkpoint(session.id, provenance="synthetic")
        exported = export_session(store, session.id)
    records = []
    for index, record in enumerate(exported.records):
        records.append(
            record.model_copy(
                update={
                    "prompt_id": "prompt-bootstrap" if index == 0 else "prompt-range",
                    "turn_id": "turn-bootstrap" if index == 0 else "turn-range",
                    "prompt_text": (
                        "Initial recorded state" if index == 0 else "Update the module safely"
                    ),
                }
            )
        )
    return exported.model_copy(update={"records": records})


def test_prompt_range_packet_combines_file_and_python_function_evidence(
    tmp_path: Path,
) -> None:
    exported = _changed_export(tmp_path)
    packet = build_prompt_evidence_packet(
        exported,
        exported.records[1].sequence,
        exported.records[-1].sequence,
        prompt_text="Update the module safely",
    )

    file_state = next(item for item in packet.files if item.path == "module.py")
    function_state = next(item for item in packet.functions if item.path == "module.py")
    assert file_state.change == "modified"
    assert "added" not in function_state.before_functions
    assert "added" in function_state.after_functions
    assert packet.sources[-1].kind == "captured_text"


def test_non_python_function_claim_stays_unknown_with_explicit_ast_reason(
    tmp_path: Path,
) -> None:
    exported = _changed_export(tmp_path, ".ts")
    before_text = "export const stable = () => 2;\n"
    after_text = "export const stable = () => 3;\nexport const added = () => 4;\n"
    changed = ChangedFileView(
        path="module.ts",
        change="modified",
        before_sha256=hashlib.sha256(before_text.encode()).hexdigest(),
        after_sha256=hashlib.sha256(after_text.encode()).hexdigest(),
        derived_from="recorded_patch",
        file_state="reconstructed_from_current_checkout_unverified",
        reconstruction_label="reconstructed from current checkout (unverified)",
        before_text=before_text,
        after_text=after_text,
    )
    last_sequence = exported.records[-1].sequence
    exported = exported.model_copy(
        update={
            "manifests": [],
            "content_base64_by_sha256": {},
            "timeline": [
                entry.model_copy(update={"changed_files": [changed]})
                if entry.sequence == last_sequence
                else entry.model_copy(update={"changed_files": []})
                for entry in exported.timeline
            ],
        }
    )
    packet = build_prompt_evidence_packet(
        exported,
        last_sequence,
        exported.records[-1].sequence,
    )
    function_state = next(item for item in packet.functions if item.path == "module.ts")
    ast_ref = next(source.id for source in packet.sources if source.kind == "ast")
    claim = TypedClaim(
        id="claim:ts-function",
        assertion=FunctionAddedAssertion(
            predicate=ClaimPredicate.PYTHON_FUNCTION_ADDED,
            path="module.ts",
            qualified_name="added",
        ),
        evidence_refs=[ast_ref],
    )

    verdict = ClaimChecker().check(packet, claim)

    assert function_state.before_ast_complete is False
    assert function_state.after_ast_complete is False
    assert verdict.verdict is ClaimVerdictName.UNKNOWN
    assert verdict.reason_code == "referenced_source_incomplete"


def test_prompt_risk_flags_are_deterministic_and_file_cited(tmp_path: Path) -> None:
    exported = _changed_export(tmp_path)
    record = exported.records[-1]
    risky_paths = [
        (".env.local", "modified"),
        ("config/settings.yaml", "modified"),
        ("tests/test_module.py", "modified"),
        ("docs/removed.md", "deleted"),
        ("docs/a.md", "modified"),
        ("scripts/b.sh", "modified"),
        ("infra/c.tf", "modified"),
        ("assets/d.json", "modified"),
    ]
    changed = [
        ChangedFileView(path=path, change=change, file_state="unknown")
        for path, change in risky_paths
    ]
    timeline = [
        entry.model_copy(update={"changed_files": changed})
        if entry.sequence == record.sequence
        else entry
        for entry in exported.timeline
    ]
    exported = exported.model_copy(update={"timeline": timeline})

    flags = build_prompt_risk_flags(exported)
    by_kind = {flag.kind: flag for flag in flags}

    assert set(by_kind) == {
        "files_deleted",
        "secret_or_config_touched",
        "test_files_changed",
        "wide_blast_radius",
    }
    assert by_kind["files_deleted"].files == ["docs/removed.md"]
    assert ".env.local" in by_kind["secret_or_config_touched"].files
    assert by_kind["test_files_changed"].source == "deterministic rule"


@dataclass
class PromptCheckBackend:
    packet: Any
    prompts: list[str] = field(default_factory=list)

    def generate(self, prompt: str, json_schema: dict[str, Any]) -> BackendResult:
        return self.generate_with_limit(prompt, json_schema, max_output_tokens=999)

    def generate_with_limit(
        self,
        prompt: str,
        json_schema: dict[str, Any],
        *,
        max_output_tokens: int,
    ) -> BackendResult:
        del max_output_tokens
        self.prompts.append(prompt)
        properties = json_schema.get("properties", {})
        if "claims" in properties:
            file_state = next(item for item in self.packet.files if item.path == "module.py")
            ref = next(
                source.id
                for source in self.packet.sources
                if source.kind == "file" and source.id.startswith("file:module.py:range-after")
            )
            value: object = {
                "schema_version": "replay-claims-1.0",
                "claims": [{
                    "id": "claim:file",
                    "assertion": {
                        "predicate": "file_changed",
                        "path": "module.py",
                        "before_sha256": file_state.before_sha256,
                        "after_sha256": file_state.after_sha256,
                        "change": file_state.change,
                    },
                    "evidence_refs": [ref],
                    "statement": "The module changed.",
                }],
            }
        elif "sentences" in properties:
            value = {
                "sentences": [
                    "Recorded prompts describe the session.",
                    "Recorded file evidence is checked separately.",
                    "Unknown details remain unknown.",
                ],
                "prompts": [{
                    "prompt_id": "prompt-range",
                    "text": "The request asked for a bounded module update.",
                }],
            }
        elif "title" in properties:
            value = {"title": "Module update"}
        else:
            value = {}
        return BackendResult(
            text=json.dumps(value),
            backend="synthetic",
            model="synthetic-3b",
            hardware="test",
            latency_ms=1,
        )


def test_staged_prompt_claim_is_redacted_cached_and_symbolically_supported(
    tmp_path: Path,
) -> None:
    exported = _changed_export(tmp_path)
    secret = "password=synthetic-phase4-secret"
    exported = exported.model_copy(
        update={
            "records": [
                record.model_copy(update={"prompt_text": secret})
                for record in exported.records
            ]
        }
    )
    packet = build_prompt_evidence_packet(
        exported,
        exported.records[1].sequence,
        exported.records[-1].sequence,
        prompt_text=secret,
    )
    backend = PromptCheckBackend(packet)
    cache_dir = tmp_path / "cache"
    with PersistentNarrationCache(cache_dir) as cache:
        first = run_staged_narration(exported, backend, cache=cache)

    check = next(
        item for item in first.prompt_claim_checks if item.prompt_id == "prompt-range"
    )
    assert check.label == "Model interpretation + symbolic check"
    assert check.claims.verdicts[0].verdict is ClaimVerdictName.SUPPORTED
    assert "synthetic-phase4-secret" not in "\n".join(backend.prompts)
    assert "[redacted: password]" in "\n".join(backend.prompts)

    cached_backend = PromptCheckBackend(packet)
    with PersistentNarrationCache(cache_dir) as cache:
        second = run_staged_narration(exported, cached_backend, cache=cache)
    assert second == first
    assert cached_backend.prompts == []
