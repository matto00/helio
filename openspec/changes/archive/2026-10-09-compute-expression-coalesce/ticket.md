# HEL-1423: Compute expressions: add coalesce() (null now propagates for CSV blanks after HEL-1408)

## Description

origin_kind: followup
origin_ticket: HEL-1408

Filed per owner ruling Q5 on HEL-1408 (Matt, 2026-10-08: accept null propagation + file a coalesce() follow-up).
Since HEL-1408 (7ed15758), CSV blank cells are null, so `concat($first, " ", $last)` becomes null when either part is
blank, and the expression language has no coalesce/if.

## Acceptance criteria

* `coalesce(a, b, ...)` returns the first non-null argument; type inference = common type of the args (follow
  HEL-1315's shared function-list + parity-test pattern, and its docs/error-list sync guard).
* Red-first: concat with a blank part → null today; `concat(coalesce($first,""), " ", coalesce($last,""))` →
  expected string.
* Docs (`docs/compute-expression-grammar.md`) + spec updated.

## Related

HEL-1070 (conditional/boolean logic), HEL-1403 (unary minus / analyze-time numeric-function warnings). Not absorbed.
