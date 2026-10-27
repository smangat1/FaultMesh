# Typed-input synthetic acceptance fixtures

These tiny projects validate FaultMesh's bounded text and `list[int]` plumbing. They are synthetic
acceptance fixtures, not benchmark evidence and not evidence that a model finds bugs in arbitrary
Python projects.

Each scenario has an isolated `buggy` and `corrected` project root with the same relative source
path. Model or deterministic-proposal runs must target only one root at a time so the Scout never
receives a reference implementation, corrected variant, evaluator assertion, or defect label.

- `text_length`: an off-by-one result-length violation for bounded text.
- `list_multiset`: a duplicate-loss violation for a sorted integer-list result.
- `list_order`: a nondecreasing-order violation for an integer-list result.

Every target has a docstring contract. Acceptance tests inject proposals using the public closed
DSL, verify buggy and corrected roots with their own freshly indexed content hashes, replay the
shrunk counterexample, and exercise generated pytest artifacts.
