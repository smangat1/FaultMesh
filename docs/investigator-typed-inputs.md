# Investigator typed-input support

This phase broadens the bounded investigation DSL beyond integers. It validates plumbing and
synthetic acceptance fixtures; it does **not** measure whether a small language model finds more
real bugs. That comparative question belongs to the preregistered phase 2 pilot.

## Finite support contract

The verifier supports pure synchronous top-level functions with named positional or keyword-only
parameters. Methods, async functions, generators, variadics, arbitrary objects, nested containers,
and dependency-heavy setup remain unsupported.

Input strategies are a closed discriminated union:

- `integers`: inclusive `minimum` and `maximum` (the existing behavior).
- `text`: an explicit unique-character `alphabet` of at most 64 Unicode scalar values plus an
  inclusive length domain from 0 through 256.
- `integer_lists`: inclusive element bounds plus an inclusive list-length domain from 0 through 64.

Annotation validation is structural. New properties accept exactly `str` for text and exactly
`list[int]` for integer lists, as emitted by `ast.unparse`; `typing.List[int]`, `Sequence[int]`,
tuples, nested lists, and aliases are not accepted. Existing schema 1.0 integer properties retain
their historical support for `int` or an absent annotation. No annotation is evaluated and no
target module is imported during indexing or specification validation.

The closed oracle set retains `no_exception`, the integer result-bound variants, and
`result_between_args`, and adds:

- `result_length_le_arg`
- `result_length_eq_arg`
- `result_list_nondecreasing`
- `result_list_preserves_multiset`

Length oracles require a result with the same supported type as their named text/list input.
Integer-list oracles require a bounded runtime `list[int]`; the multiset comparison uses element
counts, so duplicate loss is a violation. A wrong or unsupported return type is a harness
diagnostic, not a target bug.

## Contract grounding and versions

Typed properties use property schema `1.1` and must carry a specific docstring fragment in
`contract_citation`. The semantic validator normalizes whitespace/case and verifies that citation
against the freshly indexed target docstring. A property inferred only from a name or
implementation is unsupported and is never executed or promoted to an incident.

Property schema `1.0` remains accepted for the historical integer DSL. Its serialized shape is
preserved: optional 1.1 fields are omitted rather than emitted as `null`. The outer evidence,
incident, replay, and database versions remain unchanged because their JSON containers already
store a versioned `PropertySpec`; no database columns or ownership rules changed.

## Search, replay, and safety

Search generation and replay call the same domain predicate. It requires the exact declared
argument names, rejects booleans as integers, checks every text character, list element and length,
applies integer-only constraints, and caps serialized input at 16,384 UTF-8 bytes. Unknown fields,
malformed bounds, incompatible oracles, and unsupported prose preconditions fail before target
import. Text/list lengths belong in strategies; the precondition compiler continues to accept only
integer comparisons and the historical all-integer range sentence.

Target loading remains inside the configured sandbox after path containment and scan-time SHA-256
checks. Docker stays the default; host execution remains an explicit unsafe opt-in. Timeouts,
confirmation trials, fingerprints, inconclusive/flaky states, and offline/no-network container
controls are unchanged. The DSL contains no callbacks, predicates, generated Python, shell
commands, `eval`, or `exec`.

Generated pytest artifacts implement the same oracle semantics, including `Counter` equality for
duplicate-preserving multiset checks. Corrected acceptance variants are re-indexed independently
and replayed with their own fresh target/evidence hashes; the stale-hash guard is never bypassed.

## Synthetic acceptance fixtures

`examples/typed_acceptance` contains isolated buggy/corrected roots for text length, integer-list
multiset preservation, and nondecreasing order. They are deterministic acceptance fixtures, not a
benchmark or model answer key. Tests inject schema-valid proposals and exercise validation,
shrinking, replay, persistence, reporting, and generated regressions without changing the narrow
heuristic backend.

The locked real-Docker results and honest local-model rejects are recorded in
[`validation/investigator-typed-inputs-smoke.md`](validation/investigator-typed-inputs-smoke.md).
