# HEL-1386: check-scala-quality: inline-FQN guard is blind inside s"${...}" interpolation (string blanking hides it)

## Description

origin_kind: followup
origin_ticket: HEL-1247

`scripts/check-scala-quality.mjs` blanks string literals before matching inline fully-qualified names. An FQN inside an
interpolation splice, e.g. `s"...${java.util.UUID.randomUUID()}..."`, is blanked with the string and never matched. That
is how HEL-1247's cycle-1 inline `java.util.UUID` passed the pre-commit hook; the evaluator caught it instead. HEL-1332
already fixed "2 interpolation sites" by hand, but the guard itself still can't see them.

## Acceptance criteria

* The guard scans the code inside `${...}` splices of s/f/raw-interpolated strings (nested braces handled) while still
  ignoring plain string text.
* Selftest cases (in the existing `check:scala-quality` selftest): an FQN inside `${}` is flagged; the same text in a
  plain string literal is not; `$ident` without braces is handled.
* Red first: the new selftest case fails on the current guard.
* Fix any existing violations it newly finds in the same change, or add them to the content-keyed baseline if that
  approach is still in use (HEL-1282).

## Driver notes (claims, verified at Planning)

* HEL-1446 (#1022, e056f4708) widened the guard to the whole `scala.` namespace. Verified on main.
* `backend/src/test/scala/com/helio/services/sharing/ShareTokenGenerationSpec.scala:45` and `:56` mention
  `scala.util.Random` only inside plain string literals; `:56` is a security assertion. Both MUST stay unflagged and the
  file MUST stay untouched. Verified: both are plain `"..."` literals.
* The guard has no content-keyed baseline today; newly found violations are fixed with imports.
