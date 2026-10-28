import base64
import hashlib
import json
from pathlib import Path

def make_fixtures():
    fixtures_dir = Path("tests/fixtures/replay")
    fixtures_dir.mkdir(parents=True, exist_ok=True)

    # 1. Content bytes
    calc_v1 = "def calculate(x: int) -> int:\n    # Initial stub\n    return 0\n"
    calc_v2 = "def calculate(x: int) -> int:\n    # Corrected computation\n    if x < 0:\n        raise ValueError('x must be positive')\n    return x * 2 + 42\n"

    sha_v1 = hashlib.sha256(calc_v1.encode("utf-8")).hexdigest()
    sha_v2 = hashlib.sha256(calc_v2.encode("utf-8")).hexdigest()

    b64_v1 = base64.b64encode(calc_v1.encode("utf-8")).decode("ascii")
    b64_v2 = base64.b64encode(calc_v2.encode("utf-8")).decode("ascii")

    diff_calc = """--- calc.py\n+++ calc.py\n@@ -1,3 +1,5 @@\n def calculate(x: int) -> int:\n-    # Initial stub\n-    return 0\n+    # Corrected computation\n+    if x < 0:\n+        raise ValueError('x must be positive')\n+    return x * 2 + 42\n"""

    # V2 Enriched Export
    v2_doc = {
        "schema_version": "replay-export-2.0",
        "exported_at": "2026-10-28T16:30:00Z",
        "sanitized": True,
        "session": {
            "schema_version": "replay-session-1.0",
            "id": "synthetic-session-c3-demo",
            "created_at": "2026-10-28T16:00:00Z",
            "stopped_at": "2026-10-28T16:30:00Z",
            "status": "stopped",
            "project_root_sha256": "4" * 64,
            "codex_version": "codex-cli 0.165.0-alpha.1.2",
            "raw_logging": False,
            "limits": {
                "max_file_bytes": 524288,
                "max_snapshot_bytes": 33554432,
                "max_files": 2000,
                "max_store_bytes": 536870912,
                "max_text_field_bytes": 65536,
            },
        },
        "records": [
            {
                "schema_version": "replay-record-1.0",
                "id": "rec-01",
                "session_id": "synthetic-session-c3-demo",
                "sequence": 1,
                "source_identity": "src-01",
                "source_offset": 0,
                "source_sequence": 1,
                "record_type": "initial",
                "captured_at": "2026-10-28T16:00:00Z",
                "source_timestamp": None,
                "provenance": "initial_snapshot",
                "completeness": "complete",
                "attribution_status": "not_applicable",
                "turn_id": None,
                "tool_use_id": None,
                "tool_name": None,
                "checkpoint_id": "cp-01",
                "manifest_id": "man-01",
                "before_manifest_id": None,
                "after_manifest_id": "man-01",
                "partial": False,
                "truncated": False,
                "redaction_applied": False,
                "tool_input": None,
                "tool_response": None,
                "gap_reason": None,
                "test_refs": [],
            },
            {
                "schema_version": "replay-record-1.0",
                "id": "rec-02",
                "session_id": "synthetic-session-c3-demo",
                "sequence": 2,
                "source_identity": "src-02",
                "source_offset": 120,
                "source_sequence": 2,
                "record_type": "post_tool",
                "captured_at": "2026-10-28T16:05:00Z",
                "source_timestamp": None,
                "provenance": "tool_boundary",
                "completeness": "complete",
                "attribution_status": "tool_boundary",
                "turn_id": "turn-1",
                "tool_use_id": "call_patch_calc_01",
                "tool_name": "apply_patch",
                "checkpoint_id": "cp-02",
                "manifest_id": "man-02",
                "before_manifest_id": "man-01",
                "after_manifest_id": "man-02",
                "partial": False,
                "truncated": False,
                "redaction_applied": False,
                "tool_input": {"patch": diff_calc},
                "tool_response": {"status": "success"},
                "gap_reason": None,
                "test_refs": ["test-ev-failed"],
            },
        ],
        "manifests": [
            {
                "schema_version": "snapshot-manifest-1.0",
                "id": "man-01",
                "files": [
                    {
                        "path": "calc.py",
                        "content_sha256": sha_v1,
                        "size": len(calc_v1),
                        "mtime_ns": 1000,
                        "parse_ok": True,
                        "parse_error": None,
                    }
                ],
                "skipped": [],
                "partial": False,
            },
            {
                "schema_version": "snapshot-manifest-1.0",
                "id": "man-02",
                "files": [
                    {
                        "path": "calc.py",
                        "content_sha256": sha_v2,
                        "size": len(calc_v2),
                        "mtime_ns": 2000,
                        "parse_ok": True,
                        "parse_error": None,
                    }
                ],
                "skipped": [],
                "partial": False,
            },
        ],
        "content_base64_by_sha256": {
            sha_v1: b64_v1,
            sha_v2: b64_v2,
        },
        "tests": [
            {
                "schema_version": "structured-test-evidence-1.0",
                "id": "test-ev-failed",
                "session_id": "synthetic-session-c3-demo",
                "observed_at": "2026-10-28T16:05:05Z",
                "state": "fail",
                "suite_scope": "tests/test_calc.py",
                "source": "structured_pytest",
                "command_record_id": "rec-02",
                "command_exit_code": 1,
                "associated_manifest_id": "man-02",
                "association": "content_identity",
                "counts": {"passed": 3, "failed": 1, "errors": 0, "skipped": 0},
                "tests": [
                    {
                        "node_id": "tests/test_calc.py::test_negative_input_raises",
                        "state": "fail",
                        "duration_ms": 14,
                        "error_text": "ValueError: x must be positive\n    at calc.py:5 in calculate",
                    }
                ],
                "output_missing": False,
                "partial": False,
            }
        ],
        "timeline": [
            {
                "sequence": 1,
                "record_id": "rec-01",
                "record_type": "initial",
                "captured_at": "2026-10-28T16:00:00Z",
                "completeness": "complete",
                "attribution_status": "not_applicable",
                "tool_name": None,
                "tool_use_id": None,
                "before_manifest_id": None,
                "after_manifest_id": "man-01",
                "changed_files": [],
                "changed_symbols": [],
                "test_evidence": [],
                "prompt_or_tool_evidence_redacted": False,
                "gap_reason": None,
            },
            {
                "sequence": 2,
                "record_id": "rec-02",
                "record_type": "post_tool",
                "captured_at": "2026-10-28T16:05:00Z",
                "completeness": "complete",
                "attribution_status": "tool_boundary",
                "tool_name": "apply_patch",
                "tool_use_id": "call_patch_calc_01",
                "before_manifest_id": "man-01",
                "after_manifest_id": "man-02",
                "changed_files": [
                    {
                        "path": "calc.py",
                        "change": "modified",
                        "before_sha256": sha_v1,
                        "after_sha256": sha_v2,
                        "unified_diff": diff_calc,
                    }
                ],
                "changed_symbols": [
                    {
                        "path": "calc.py",
                        "qualified_name": "calculate",
                        "kind": "function",
                        "change": "modified",
                        "before_content_sha256": sha_v1,
                        "after_content_sha256": sha_v2,
                        "verified": True,
                    }
                ],
                "test_evidence": [
                    {
                        "schema_version": "structured-test-evidence-1.0",
                        "id": "test-ev-failed",
                        "session_id": "synthetic-session-c3-demo",
                        "observed_at": "2026-10-28T16:05:05Z",
                        "state": "fail",
                        "suite_scope": "tests/test_calc.py",
                        "source": "structured_pytest",
                        "command_record_id": "rec-02",
                        "command_exit_code": 1,
                        "associated_manifest_id": "man-02",
                        "association": "content_identity",
                        "counts": {"passed": 3, "failed": 1, "errors": 0, "skipped": 0},
                        "tests": [
                            {
                                "node_id": "tests/test_calc.py::test_negative_input_raises",
                                "state": "fail",
                                "duration_ms": 14,
                                "error_text": "ValueError: x must be positive\n    at calc.py:5 in calculate",
                            }
                        ],
                        "output_missing": False,
                        "partial": False,
                    }
                ],
                "prompt_or_tool_evidence_redacted": False,
                "gap_reason": None,
            },
        ],
        "limitations": [
            "Local replay environment; no commands are reexecuted or patched live into disk.",
            "Private absolute paths are excluded by store redaction.",
        ],
        "baseline_chapters": [
            {
                "id": "base-ch-1",
                "start_sequence": 1,
                "end_sequence": 2,
                "title": "Initial workspace and calculate() patch",
                "evidence_refs": ["rec-01", "rec-02"],
                "source": "deterministic_baseline",
                "title_status": "baseline",
            }
        ],
        "chapters": [
            {
                "id": "model-ch-1",
                "start_sequence: ": 1,
                "start_sequence": 1,
                "end_sequence": 2,
                "title": "Fix calculate validation logic for negative inputs",
                "evidence_refs": ["rec-01", "rec-02"],
                "source": "model",
                "title_status": "model_interpretation",
            }
        ],
        "chapter_run": {
            "schema_version": "replay-chapter-run-1.0",
            "chapters": [],
            "raw_model_output": None,
            "parsed_model_output": None,
            "error": None,
            "fallback_used": False,
            "backend": "local-gguf",
            "model": "qwen2.5-coder-7b",
            "latency_ms": 120,
        },
        "narration": [
            {
                "sequence": 2,
                "packet": {
                    "schema_version": "replay-evidence-packet-1.0",
                    "session_id": "synthetic-session-c3-demo",
                    "checkpoint_id": "cp-02",
                    "sequence": 2,
                    "before_manifest_id": "man-01",
                    "after_manifest_id": "man-02",
                    "record_complete": True,
                    "selection_truncated": False,
                    "redaction_present": False,
                    "files": [
                        {"path": "calc.py", "before_sha256": sha_v1, "after_sha256": sha_v2, "change": "modified"}
                    ],
                    "functions": [
                        {"path": "calc.py", "before_functions": ["calculate"], "after_functions": ["calculate"], "before_ast_complete": True, "after_ast_complete": True}
                    ],
                    "sources": [
                        {"id": "user-prompt-1", "kind": "user_prompt", "session_id": "synthetic-session-c3-demo", "sequence": 2, "content_sha256": sha_v1, "text": "Handle negative inputs in calculate function", "redacted": False, "truncated": False}
                    ],
                    "evidence_hash": "e" * 64,
                },
                "claims": {
                    "schema_version": "replay-claims-run-1.0",
                    "final_claims": [
                        {
                            "id": "claim-supported-calc",
                            "assertion": {
                                "predicate": "file_changed",
                                "path": "calc.py",
                                "before_sha256": sha_v1,
                                "after_sha256": sha_v2,
                                "change": "modified",
                            },
                            "evidence_refs": ["rec-02"],
                            "statement": "calc.py was modified from hash-v1 to hash-v2",
                        },
                        {
                            "id": "claim-contradicted-path",
                            "assertion": {
                                "predicate": "file_changed",
                                "path": "missing_util.py",
                                "before_sha256": None,
                                "after_sha256": None,
                                "change": "added",
                            },
                            "evidence_refs": ["rec-02"],
                            "statement": "missing_util.py was added to repository",
                        },
                        {
                            "id": "claim-unknown-pytest",
                            "assertion": {
                                "predicate": "structured_pytest_counts",
                                "test_evidence_id": "test-ev-failed",
                                "passed": 10,
                                "failed": 0,
                                "errors": 0,
                                "skipped": 0,
                            },
                            "evidence_refs": ["test-ev-failed"],
                            "statement": "All 10 tests passed without errors",
                        },
                    ],
                    "final_source": "first",
                    "verdicts": [
                        {
                            "claim_id": "claim-supported-calc",
                            "verdict": "supported",
                            "reason_code": "exact_file_fact",
                            "reason": "calc.py before/after hashes match recorded boundary.",
                            "evidence_refs": ["rec-02"],
                            "checker_version": "replay-checker-1.0",
                        },
                        {
                            "claim_id": "claim-contradicted-path",
                            "verdict": "contradicted",
                            "reason_code": "complete_path_absence",
                            "reason": "Path missing_util.py does not exist in recorded manifest man-02.",
                            "evidence_refs": ["rec-02"],
                            "checker_version": "replay-checker-1.0",
                        },
                        {
                            "claim_id": "claim-unknown-pytest",
                            "verdict": "unsupported_or_unknown",
                            "reason_code": "structured_test_counts_contradiction",
                            "reason": "Pytest reported 1 failure; 10 passing claim cannot be verified.",
                            "evidence_refs": ["test-ev-failed"],
                            "checker_version": "replay-checker-1.0",
                        },
                    ],
                    "fallback_used": False,
                    "repair_attempts": 0,
                    "backend": "local-gguf",
                    "model": "qwen2.5-coder-7b",
                    "latency_ms": 90,
                },
                "reason": {
                    "schema_version": "replay-reason-run-1.0",
                    "raw_model_output": '{"text":"Added guard against negative numbers to prevent invalid calculation","citations":[]}',
                    "parsed_reason": {
                        "text": "Added guard against negative numbers to prevent invalid calculation",
                        "citations": [],
                    },
                    "checked_reason": {
                        "label": "likely reason (model inference)",
                        "text": "Added guard against negative numbers to prevent invalid calculation",
                        "citations": [
                            {
                                "citation": {
                                    "source_id": "user-prompt-1",
                                    "start": 0,
                                    "end": 44,
                                    "quote": "Handle negative inputs in calculate function",
                                },
                                "integrity": "verified",
                                "reason_code": "exact_quote_match",
                                "source_text": "Handle negative inputs in calculate function",
                                "policy_version": "citation-policy-1.0",
                            }
                        ],
                        "citation_status": "valid",
                        "entailment_status": "not_deterministically_assessed",
                        "verified_intent": False,
                    },
                    "error": None,
                    "fallback_used": False,
                    "backend": "local-gguf",
                    "model": "qwen2.5-coder-7b",
                    "latency_ms": 75,
                },
                "summary_audit": {
                    "schema_version": "replay-summary-audit-1.0",
                    "summary_text": "calc.py was modified and all tests passed.",
                    "statements": [
                        {
                            "statement": {
                                "start": 0,
                                "end": 20,
                                "exact_text": "calc.py was modified",
                                "claim": {
                                    "id": "claim-supported-calc",
                                    "assertion": {
                                        "predicate": "file_changed",
                                        "path": "calc.py",
                                        "before_sha256": sha_v1,
                                        "after_sha256": sha_v2,
                                        "change": "modified",
                                    },
                                    "evidence_refs": ["rec-02"],
                                    "statement": "calc.py was modified",
                                },
                            },
                            "span_valid": True,
                            "canonical_mapping_valid": True,
                            "atomic_boundary_valid": True,
                            "claim_verdict": {
                                "claim_id": "claim-supported-calc",
                                "verdict": "supported",
                                "reason_code": "exact_file_fact",
                                "reason": "Verified",
                                "evidence_refs": ["rec-02"],
                                "checker_version": "replay-checker-1.0",
                            },
                            "display_status": "supported",
                        },
                        {
                            "statement": {
                                "start": 25,
                                "end": 41,
                                "exact_text": "all tests passed",
                                "claim": {
                                    "id": "claim-tests-pass",
                                    "assertion": {
                                        "predicate": "command_exit",
                                        "record_id": "rec-02",
                                        "exit_code": 0,
                                    },
                                    "evidence_refs": [],
                                    "statement": "all tests passed",
                                },
                            },
                            "span_valid": True,
                            "canonical_mapping_valid": False,
                            "atomic_boundary_valid": True,
                            "claim_verdict": None,
                            "display_status": "not_supported_by_this_recording",
                        },
                    ],
                    "supported_claims": [],
                    "auditor_version": "replay-summary-auditor-1.0",
                    "limitations": [],
                },
            }
        ],
    }

    # 2. V1 No-model Export with Partial / Missing evidence
    v1_doc = {
        "schema_version": "replay-export-1.0",
        "exported_at": "2026-10-28T15:00:00Z",
        "sanitized": True,
        "session": {
            "schema_version": "replay-session-1.0",
            "id": "synthetic-session-c3-nomodel",
            "created_at": "2026-10-28T14:45:00Z",
            "stopped_at": "2026-10-28T15:00:00Z",
            "status": "stopped",
            "project_root_sha256": "5" * 64,
            "codex_version": "codex-cli 0.165.0-alpha.1.2",
            "raw_logging": False,
            "limits": {
                "max_file_bytes": 524288,
                "max_snapshot_bytes": 33554432,
                "max_files": 2000,
                "max_store_bytes": 536870912,
                "max_text_field_bytes": 65536,
            },
        },
        "records": [
            {
                "schema_version": "replay-record-1.0",
                "id": "rec-p1",
                "session_id": "synthetic-session-c3-nomodel",
                "sequence": 1,
                "source_identity": "src-p1",
                "source_offset": 0,
                "source_sequence": 1,
                "record_type": "initial",
                "captured_at": "2026-10-28T14:45:00Z",
                "source_timestamp": None,
                "provenance": "initial_snapshot",
                "completeness": "complete",
                "attribution_status": "not_applicable",
                "turn_id": None,
                "tool_use_id": None,
                "tool_name": None,
                "checkpoint_id": "cp-p1",
                "manifest_id": "man-p1",
                "before_manifest_id": None,
                "after_manifest_id": "man-p1",
                "partial": False,
                "truncated": False,
                "redaction_applied": False,
                "tool_input": None,
                "tool_response": None,
                "gap_reason": None,
                "test_refs": [],
            },
            {
                "schema_version": "replay-record-1.0",
                "id": "rec-p2",
                "session_id": "synthetic-session-c3-nomodel",
                "sequence": 2,
                "source_identity": "src-p2",
                "source_offset": 80,
                "source_sequence": 2,
                "record_type": "checkpoint",
                "captured_at": "2026-10-28T14:48:00Z",
                "source_timestamp": None,
                "provenance": "observed_checkpoint",
                "completeness": "partial",
                "attribution_status": "observed_checkpoint",
                "turn_id": None,
                "tool_use_id": None,
                "tool_name": None,
                "checkpoint_id": "cp-p2",
                "manifest_id": "man-p2",
                "before_manifest_id": "man-p1",
                "after_manifest_id": "man-p2",
                "partial": True,
                "truncated": False,
                "redaction_applied": False,
                "tool_input": None,
                "tool_response": None,
                "gap_reason": "Skipped non-UTF-8 binary file during snapshot.",
                "test_refs": [],
            },
        ],
        "manifests": [
            {
                "schema_version": "snapshot-manifest-1.0",
                "id": "man-p1",
                "files": [
                    {
                        "path": "server.py",
                        "content_sha256": sha_v1,
                        "size": len(calc_v1),
                        "mtime_ns": 1000,
                        "parse_ok": True,
                        "parse_error": None,
                    }
                ],
                "skipped": [],
                "partial": False,
            },
            {
                "schema_version": "snapshot-manifest-1.0",
                "id": "man-p2",
                "files": [
                    {
                        "path": "server.py",
                        "content_sha256": sha_v1,
                        "size": len(calc_v1),
                        "mtime_ns": 1000,
                        "parse_ok": True,
                        "parse_error": None,
                    }
                ],
                "skipped": [{"path": "data.bin", "reason": "non-UTF-8 binary"}],
                "partial": True,
            },
        ],
        "content_base64_by_sha256": {
            sha_v1: b64_v1,
        },
        "tests": [],
        "timeline": [
            {
                "sequence": 1,
                "record_id": "rec-p1",
                "record_type": "initial",
                "captured_at": "2026-10-28T14:45:00Z",
                "completeness": "complete",
                "attribution_status": "not_applicable",
                "tool_name": None,
                "tool_use_id": None,
                "before_manifest_id": None,
                "after_manifest_id": "man-p1",
                "changed_files": [],
                "changed_symbols": [],
                "test_evidence": [],
                "prompt_or_tool_evidence_redacted": False,
                "gap_reason": None,
            },
            {
                "sequence": 2,
                "record_id": "rec-p2",
                "record_type": "checkpoint",
                "captured_at": "2026-10-28T14:48:00Z",
                "completeness": "partial",
                "attribution_status": "observed_checkpoint",
                "tool_name": None,
                "tool_use_id": None,
                "before_manifest_id": "man-p1",
                "after_manifest_id": "man-p2",
                "changed_files": [],
                "changed_symbols": [],
                "test_evidence": [],
                "prompt_or_tool_evidence_redacted": False,
                "gap_reason": "Skipped non-UTF-8 binary file during snapshot.",
            },
        ],
        "limitations": [
            "No model narration recorded in replay-export-1.0.",
            "Partial snapshot due to binary file skipping.",
        ],
    }

    (fixtures_dir / "fixture_replay_v2_enriched.json").write_text(json.dumps(v2_doc, indent=2), encoding="utf-8")
    (fixtures_dir / "fixture_replay_v1_nomodel.json").write_text(json.dumps(v1_doc, indent=2), encoding="utf-8")
    print("Fixtures written successfully.")

if __name__ == "__main__":
    make_fixtures()
