# Deliberately buggy bounded increment

The existing example tests cover ordinary and already-out-of-range values, but omit the
`value == maximum` transition. The docstring supplies an objective upper-bound oracle. FaultMesh's
heuristic backend proposes that property and Hypothesis finds the missing boundary case.

The correction is `if value < maximum:`. The example is deliberately seeded; it is not presented as
a previously unknown real-world bug.

