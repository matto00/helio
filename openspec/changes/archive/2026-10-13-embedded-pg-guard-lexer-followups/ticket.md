# HEL-1474: After HEL-1445: EmbeddedPostgres start-guard lexer gaps ($" escape, raw"…\"…//"), D7 wording + never-red labels, CONTRIBUTING note, split the 401-line guard spec, helper nits

## Description

Origin: HEL-1445 (matto00/helio#917, 719710c1), lane-reported. None of these have instances in the tree today.

1. Guard lexer gaps: the `$"` escape inside interpolated strings, and a `raw"...\"..."` literal containing `//`.
   Add red-first cases, then fix. Correct D7's wording in the archived design/spec ("raw without escapes",
   "covers each construct"), and relabel the triple-quoted, nested-splice and char-literal cases as never-red
   GUARDS (they never failed on the pre-fix tree).
2. A CONTRIBUTING.md note: specs must start embedded Postgres via `VerifiedEmbeddedPostgres.start` (the guard
   enforces it).
3. `EmbeddedPostgresStartGuardSpec` is ~401 lines, over the ~250 soft budget; split the lexer from the assertions.
4. Helper nits: only non-fatal errors are caught during the ownership check; confirm the data directory is cleaned
   up correctly when zonky's own start throws.
   Also note: when merging origin/main into the branch the lane used `-c core.hooksPath=/dev/null` on the merge
   commit (disclosed; the squash and archive commits ran the full hook chain).

## Acceptance Criteria

- AC1: Reject cases for the `$"` escape (Scala 2.13 `s"...$"..."`) and for a `raw"...\"...//..."` literal, each
  hiding a same-line direct start, exist and are shown RED against the pre-fix lexer, then GREEN after the fix.
  Reverting each one-line fix individually turns its case red again (mutation evidence).
- AC2: The triple-quoted, nested-splice and char-literal splice cases are labelled as never-red GUARDS in the spec
  (fail-closed: a mis-lex falls back to the raw scan). Each construct also gets a balanced same-line variant shown
  RED under a targeted lexer mutation, or recorded evidence that no balanced failable variant exists.
- AC3: The archived HEL-1445 design D7 wording is corrected (no "raw without escapes"; "covers each construct"
  softened; gap 3 names its concrete residual members), with a dated HEL-1474 correction note.
- AC4: CONTRIBUTING.md states that backend specs must start embedded Postgres via `VerifiedEmbeddedPostgres.start`
  and that `EmbeddedPostgresStartGuardSpec` enforces it.
- AC5: The guard is split so the lexer lives apart from the assertions; every resulting file is at or under the
  250-line soft budget, and the whole-tree scan still reports 0 raw-fallback files and 0 offenders.
- AC6: A fatal throwable during the ownership check still closes the attempt's instance and deletes its data
  directory before propagating unchanged; a test proves it.
- AC7: When zonky's own `start()` throws, the attempt's data directory is deleted; a test proves it, and the
  behaviour of zonky 2.0.7 on that path (whether a postmaster can survive) is recorded with evidence.
