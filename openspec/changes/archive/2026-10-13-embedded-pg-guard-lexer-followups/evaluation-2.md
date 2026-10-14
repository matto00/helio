## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `18db453d3cbb07408c42f28d82288820f6629b15` (on top of `6fee572ed`, which cycle 1 reviewed).
Diff base, resolved live with `resolve-review-base.sh`: `c830aa87588c21ca0a0e46ec9fddba48f41d6a1b`.

### Phase 1: Spec Review — PASS

**CR1 (archived D7 claimed the three cases went red): resolved.**
- `openspec/changes/archive/2026-10-10-embedded-postgres-port-race-guard/design.md:97` now says only four splice cases were shown red: `*/*`, glob, `//` and the paren-less start.
- This matches `c5-guard-red-green.txt:17`.
- It also says the triple-quoted, nested-splice and char-literal cases were never red and are fail-closed guards.
- The line carries the dated `_Corrected by HEL-1474 (2026-10-13)._` note.

**CR2 (zonky Follow-up ticket): resolved. I checked Linear myself.**
- HEL-1586 exists, in Backlog.
- It has the `Follow-up` label and is relatedTo HEL-1474 and HEL-1445.
- Its description cites zonky 2.0.7 `EmbeddedPostgres.java:275/:283/:335`, the delete-under-a-live-postmaster effect, and the proof file.
- `proof/zonky-start-failure.txt` now records the ticket ID.

**Other points:**
- The STATS raw-fallback count is still logged but not asserted. The orchestrator left this out of scope on purpose, to be noted in the PR. It was a non-blocking suggestion, it predates HEL-1474, and it is not part of any AC.
- AC1-AC7 still hold. Cycle 1 verified them, and the cycle-2 delta does not touch the lexer, the helper, any test case or the spec delta.
- `workflow-state.md` has no CONSTRAINTS entries.

Issues: none.

### Phase 2: Code Review — PASS

**The cycle-2 backend change is comments and whitespace only.** `git diff 6fee572ed..HEAD -- backend` shows 2 files with +6 and -2 lines:
- A 5-line comment in `EmbeddedPostgresGuardLexerSpec.scala` explains why the nested-splice variant has a second line.
- The doubled parenthetical at `EmbeddedPostgresStartGuard.scala:23` is fixed, and the doubled blank line at `:50-51` is removed.
- No executable line changed.

**Gates, re-run fresh in WORKTREE_PATH** with `nice -n 19` and `sbt -batch -Dsbt.server.autostart=false -J-Xmx3g`:
- `testOnly com.helio.testkit.*`: exit 0. 4 suites and 27 tests succeeded. The hel1468-guard summary is `failed=0 aborted=0 unreadable=0`.
  - STATS: `files-scanned=651 raw-fallback-files=0 offenders=0`.
- Repo checks all exit 0, with no warnings for the testkit files: `check:scala-quality`, `check:test-temp-dir-hygiene`, `check:openspec`, `check:spec-structure`, `format:check`, `check:no-credential-leak` and `check:repo-integrity`.
- Line counts are 111, 106, 144 and 124, all within the 250 budget.
- **Full-suite note:** I did not repeat the 8-shard `testFull` this cycle.
  - In cycle 1 it was green on `6fee572ed`: 612 suites and 8,063 tests passed.
  - The only executable-code change since then is none at all (comments and whitespace only).
  - The changed files were recompiled and their suites re-run above.

**Nested-splice documentation (cycle 1 non-blocking suggestion): addressed.**
- The spec comment and `proof/guard-mutations.txt` now explain why the second line is needed.
- They also state that the tail `}" // "` is deliberately not well-formed Scala.

**Commit hygiene:**
- No rendered Concertino file is in the commit.
- `evaluation-1.md` was committed into the change directory, which is expected.

Issues: none.

### Phase 3: UI Review — N/A

This is a test-only backend change. It touches no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` path.

### Overall: PASS

### Non-blocking Suggestions
- Note in the PR body that the whole-tree STATS test logs but does not assert `raw-fallback-files == 0`. In cycle 1, the `triple` mutation reached 222 fallback files and that test stayed green. This gap predates HEL-1474.
