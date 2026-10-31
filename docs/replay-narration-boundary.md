# Checked narration boundary

FaultMesh separates recorded facts, quote integrity and model interpretation.

## Likely reasons

A reason is always displayed as **likely reason (model inference)**. An exact citation does not make
the reason verified intent or prove that the quote entails the guess. The deterministic checker
only establishes citation integrity:

- the source is in the selected recording and session;
- non-prompt event/explanation sources precede the step being narrated;
- offsets address the normalized source exactly;
- the quoted text matches those normalized characters; and
- the source is neither redacted nor truncated.

Normalization policy `replay-citation-policy-1.0` converts CRLF/CR newlines to LF and applies
Unicode NFC. It does not trim or fold whitespace. Offsets are Python character offsets into that
normalized text. The UI must show the source text and keep entailment as
`not_deterministically_assessed`.

A recorded statement supports only attribution such as “the prompt requested X” or “the agent
wrote X.” It does not reveal hidden reasoning or prove genuine intent, causality or completion.

## Agent-summary audit

The summary auditor accepts only an exact statement span paired with one of the narrow typed
predicates checked against the same immutable packet. The span must equal the canonical rendering
of that atomic predicate; exact substring matching or proximity alone is not a semantic mapping.
The canonical span must occupy a standalone summary line, so an embedded canonical-looking clause
inside a compound sentence remains unverified. It renders supported atomic facts,
contradictions backed by complete contrary evidence, and “not supported by this recording.”

Free text never inherits a supported badge from a nearby filename. Unmapped prose and broad claims
about security, performance, completeness, correctness or intent remain unverified.

## Chapter-first app pipeline

Opening an imported desktop session uses four explicit boundaries:

1. Stage 0 makes a `replay-export-2.0` document from deterministic baseline chapters and a factual
   fallback summary. It does not build evidence packets, check per-step claims or call a model.
2. Stage A titles baseline chapters newest-first in the background. Each chapter gets one local
   model call capped at 60 output tokens. A title is labeled `model interpretation`; malformed or
   failed output leaves the deterministic template in place and records the fallback.
3. Stage B makes one session-summary call capped at 400 output tokens. Failure preserves the
   deterministic factual summary.
4. Step explanations and selection summaries are on demand. A step explanation checks that step's
   claims and uses a 150-token explanation cap. A selection checks at most 32 non-trivial steps,
   reports the checked and total counts, and uses one 400-token summary call. A recorded edit patch
   is non-trivial even when current-checkout reconstruction fails; its file claims stay unknown.

File reads and tool calls with no recorded edit, changed file, command exit or test evidence get a
deterministic “no recorded changes” note and no model call. The offline `replay-narrate` file
command retains the full per-step behavior for compatibility.

All staged model calls pass through the shared typed redactor. The persistent cache is scoped first
by the immutable session content hash. Operation keys include cache version
`replay-narration-cache-2.0`, prompt version, model configuration and:

- chapter title: chapter id plus deterministic chapter facts;
- session summary: the complete titled chapter list;
- step explanation: sequence plus evidence hash; and
- selection summary: inclusive start/end sequence.

Cache rows are committed only after a complete schema-valid result or explicit fallback exists.
Stopping chapter titling therefore leaves the last streamed mixed deterministic/model state valid.

## Measured local run — 2026-10-31

Hardware was a Mac14,15 with Apple M2, 8 GiB unified memory and arm64 macOS. The app used
Qwen2.5-3B-Instruct Q4_K_M through the managed loopback-only `llama-server`. The real Codex thread
was `019d51ad-ee48-7f70-b3af-343b854e0bab`. It was the referenced 1,601-step active session but had
grown to 1,631 imported steps and 236 deterministic chapters when measured.

| Operation | Measured time | Result |
| --- | ---: | --- |
| Import plus first chapter render | 7.310 s | 1,631 steps and 236 baseline chapters |
| Stage 0 after import | 2.892 ms | zero model calls |
| Local server startup | 5.465 s | loopback endpoint ready |
| Title all chapters plus session-summary attempt | 368.037 s | 223 model titles; 13 deterministic fallbacks; summary validation failed and kept factual fallback |
| Summarize steps 1440–1559, cold | 405.797 s | 120 total; 57 non-trivial; 32 checked; model summary |
| Same selection, persistent-cache lookup | 127.528 ms | byte-equivalent validated result |
| Explain file-edit step 1447, cold | 12.575 s | model explanation; unknown evidence stayed unknown |
| Same step, persistent-cache lookup | 57.914 ms | byte-equivalent validated result |

These are single measured runs, not benchmarks or performance guarantees. The cache timings are
runner-level persistent-cache lookups with the model server already warm. The renderer also keeps
identical selection and step results in memory, so a repeated interaction does not spawn another
CLI process during that app session.
