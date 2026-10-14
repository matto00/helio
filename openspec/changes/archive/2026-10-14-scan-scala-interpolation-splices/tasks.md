## Standing Constraints

- [C1] Inside an interpolated literal, `$"` is an escaped quote (string text), handled next to `$$`; pin with a green selftest case. (Under C5: honoured by pass 2, pinned at pass-2 level with a splice FQN after a `$"`; pass 1 keeps base's report of text after `$"`, see design Decision 6.)
- [C2] A `${...}` splice on the line that opens an unclosed `"""` literal is CHECKED as code (rest of that literal's text blanked); pin with a selftest case.
- [C4] No regression vs the base guard: any line the base guard flagged must still be flagged (code after a closing `"""` of a multi-line literal, and code after a `'"'` char literal), proven by a base-vs-HEAD comparison.
- [C5] Owner reframe ("old OR new"): pass 1 = the base guard's (609e62b6d) string-blanking FQN detection, behaviour byte-identical; pass 2 = splice scan reporting only FQNs inside `${...}`; a line is flagged if either pass flags it (HEAD superset of base by construction). Pass 2 must not flag plain string text.
- [C3] Char literals like `'}'`/`'"'` inside splice code are a documented known limit in the guard header (superseded under C5: pass 2 skips simple char literals; pass-2 limits are in the header).

## 1. Red first

- [x] 1.1 Add the new selftest cases (tasks 3.x) to `scripts/check-scala-quality.selftest.mjs` BEFORE touching the guard; run `node scripts/check-scala-quality.selftest.mjs` and save the transcript showing the splice red cases FAIL on the unmodified guard (persist as evidence)

## 2. Guard

- [x] 2.1 Keep the base string-blanking detection as pass 1 (`scanBase`, behaviour unchanged) and add pass 2, the cross-line splice-only scanner in `scripts/scala-code-only.mjs` (design Decisions 1-5), unioned per line; verify with the selftest
- [x] 2.2 Report the column from pass 1 when it flags the line (unchanged `indexOf`), else from the match index in pass 2's splice-only view; verify the selftest column case (pass-2-only hit)
- [x] 2.3 Update the guard header's "Known guard limits" comment (drop the `${...}` limit); verify by reading the diff
- [x] 2.4 Run `node scripts/check-scala-quality.mjs` over the repo; fix every newly flagged site with a top-of-file import (no baseline); verify exit 0 and `git diff --stat` leaves `ShareTokenGenerationSpec.scala` untouched

## 3. Tests

- [x] 3.1 Red: FQN in `s"${...}"`, `f"${...}"`, `raw"${...}"`, a nested-brace splice, a splice holding a nested string literal, a single-line `s"""${...}"""`; verify each is flagged exactly once
- [x] 3.2 Green: the same `${java.util.UUID...}` text in a plain literal; `s"$java.util.UUID"`; `s"$$java.time.Instant"`; `foo("java.time.Instant")`; `src should not include "scala.util.Random"`; verify none flagged
- [x] 3.3 Robustness: unterminated literal/splice does not throw; verify a selftest case
- [x] 3.4 Mutation: disable splice copying in the guard, show the selftest goes red, restore; save the transcript as evidence
- [x] 3.5 `npm run check:scala-quality` exits 0 with the selftest pass count printed from this worktree's path
