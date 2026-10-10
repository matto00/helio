## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `2baefd86d1d4fd5d97594c6302fc88a1cea6d0ed` against the live-resolved base
`5ba82b39f5de50eb414b9f95f4f06bf4b89634cb`. The cycle-2 delta is `874f276..2baefd86d`.

### Phase 1: Spec Review — PASS
Issues: none.

- Every cycle-1 finding still holds. The delta does not touch the clock pinning, the 1800 assertion, or the sweep.
- **Test title change is name-only.** The only Scala hunk in `874f276..HEAD` is
  `PipelineRunGuardIntegrationSpec.scala:218`. It changes the title from "...+ a positive retryAfterSeconds" to
  "...+ the exact retryAfterSeconds of the pinned window". The body is unchanged.
- **Trimmed probes still carry the load-bearing lines.** Every non-comment line in both files is an exact copy of a
  line in the committed 874f276 originals. I checked this with a `grep -xF` per line, and nothing was found that is
  not in the original. Neither file contains ANSI escapes.
  - `probe-red.txt`:
    - a 3-line header describing the probe edit;
    - wall times showing sub1 and sub2 finished 1301 and 1215 ms before the boundary, and sub3 started 100 ms after it;
    - two rows, `(2026-10-10 00:26:50, 2)` and `(2026-10-10 00:27:00, 1)`, one 10s window apart and each within limit 2;
    - the failure "expected Left(TooManyRequests), got Right";
    - the hel1468-guard line (failed=1) and the summary showing 1 failed.
  - `probe-green.txt`:
    - the same header;
    - wall times again crossing the boundary (sub3 at -100 ms);
    - a single pinned row `(2025-12-31 16:30:00 PST = 2026-01-01T00:30Z, 2)`;
    - `retryAfterSeconds=10`;
    - the hel1468-guard line (failed=0) and `Tests: succeeded 1, failed 0`.
  - These lines are enough for C1.
- **Hygiene is resolved.**
  - `testfull.done` and `loop-exit.txt` were removed.
  - `loop.txt` now says that `loop-logs/*.log` are gitignored and not retained, and that exit codes were not used as
    the judge.
  - I re-verified those logs myself in cycle 1: 0 bad-pattern hits, 21/21 with 10 tests passed, and 21/21 with the
    hel1468-guard line.
- **C2 still holds.** No `EmbeddedPostgres` line appears in the Scala diff.

### Phase 2: Code Review — PASS
Issues: none.

- **Gates (my own fresh run on 2baefd86d, in WORKTREE_PATH).** I ran `nice -n 19 sbt -J-Xmx3g testFull`:
  - result: `Tests: succeeded 6537, failed 0, canceled 4`;
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`;
  - 0 matches for `TESTS FAILED`, `*** FAILED` or `RUN ABORTED`;
  - the renamed test ran and passed;
  - no sbt server was left behind.
- I did not re-run the cycle-1 mutation. The cycle-2 Scala change is title-only, so the wiring guard at `:228`
  (`shouldBe 1800L`, which fails with 3321 when `guardClock` is dropped) is unchanged.

### Phase 3: UI Review — N/A
This is a test-only backend change.

### Overall: PASS

### Non-blocking Suggestions
- `probe-red.txt` still shows the old test title in its captured failure line, as recorded output. This is correct as
  evidence (it is what ran at the time), and no change is needed.
