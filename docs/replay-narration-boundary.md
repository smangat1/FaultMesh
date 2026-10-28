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
predicates checked against the same immutable packet. It renders supported atomic facts,
contradictions backed by complete contrary evidence, and “not supported by this recording.”

Free text never inherits a supported badge from a nearby filename. Unmapped prose and broad claims
about security, performance, completeness, correctness or intent remain unverified.
