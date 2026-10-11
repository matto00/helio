## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: cd0910fe9910fe149efb08bc30235abd3ec05bc8. Base (live-resolved): 590ac4575ad42010e322a527fdf296e6cea77213.
Diff: one test file (`OutputHistoryRetentionInFlightSpec.scala`, 3 lines changed) plus the change's openspec artifacts.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (deterministic red on unfixed code): I checked this myself. `hel1499-red-{1,2,3}.log` each show
  `*** FAILED ***` with `0 was not equal to 1 (OutputHistoryRetentionInFlightSpec.scala:75)` and `(...:96)`, plus
  `[hel1468-guard] ScalaTest summary: failed=2 aborted=0`. These are assertion failures, not timeouts or aborts. The
  `loading project`/`set current project` lines name this worktree's `backend/`. The mutated source was not kept
  (only orig/fixed), so the exact mutation rests on `hel1499-notes.md`. The failure lines match the described
  mechanism exactly, so I accept it.
- AC2 (fixed ordering, same widening still green): `hel1499-fixed.log` and `hel1499-fixed-mutated-{1,2,3}.log` all
  show `failed=0 aborted=0`, 5 succeeded, paths in this worktree. `hel1499-fixed.scala` is byte-identical to the
  committed file.
- AC3 (service examined): `hel1499-notes.md` records the review. I re-read
  `OutputHistoryRetentionService.purgeIfDue`/`runPass`. The guard is taken by CAS. It is released on the not-due path,
  on a synchronous throw, or by `andThen` on the returned future after the `nextDue` CAS rewrite. I agree there is no
  service race. Nothing needs to be filed.
- AC4: test-only diff, minimal, no inline FQNs (`check-scala-quality.mjs`: clean), and `[hel1468-guard]` is visible
  in every run.
- Tasks 1.1–1.5 are all marked done and match the evidence. There is no scope creep.
- C1 (judge by ScalaTest output, not exit code) is honored. The executor's notes cite `failed=N` lines, and this
  report does the same.

### Phase 2: Code Review — PASS
Gates, run fresh by the evaluator in WORKTREE_PATH (`nice -n 19 sbt -batch -Dsbt.server.autostart=false ...`; MemAvailable was about 55 GB):
- `testOnly OutputHistoryRetentionInFlightSpec OutputHistoryRetentionServiceSpec`: `[hel1468-guard] failed=0 aborted=0
  unreadable=0`, Suites 2, Tests succeeded 17, failed 0 (evidence `hel1499-eval-1.log`).
- `testOnly OutputHistoryRetentionInFlightSpec` 3 more times: `failed=0`, 5 succeeded each (`hel1499-eval-{2,3,4}.log`).
- `testFull`: `[hel1468-guard] failed=0 aborted=0 unreadable=0`, Suites completed 523, aborted 0, Tests succeeded
  6923, failed 0, canceled 4 (`hel1499-eval-testFull.log`).
- `npm run check:scala-quality` (node scripts/check-scala-quality.mjs): clean, with only pre-existing soft warnings.
- The stack traces in green logs (`boom-future` at :97, `boom-sync` at :106) are the tests' deliberately injected
  failures, logged by the service's `recover`. They are not test failures.
- No sbt server was started (`-Dsbt.server.autostart=false`, `-batch`). The worktree is clean afterwards and no
  mutation was made.

Correctness: the reorder gives a happens-before edge. The increment is sequenced before `trySuccess`, and the test
thread's `Await` on the promise future then sees it. This fixes the reads at :75 and :96, and also :80 (a busy
`purgeIfDue` creates no edge to the pool thread). The payload reorder is consistency-only, since no test reads
`payloadCalls` after `payloadReached`. Line 135's `secondReached` was already safe, because the argument is evaluated
before the function body.

On the `val n` shadowing the unused `n: Instant` parameter: this is not a defect against CONTRIBUTING.md. That file has
no shadowing or naming rule; its only "shadowing" mention is about route mounting. scalac emitted no warning, and the
mechanical quality check is clean. The parameter was already unused before this change, and the local is a two-token
scope. It is a mild readability wart because the name now means an `Int` call ordinal instead of an `Instant`. See
Non-blocking Suggestions.

### Phase 3: UI Review — N/A
Backend test-only change; no Phase 3 trigger paths touched.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `OutputHistoryRetentionInFlightSpec.scala:57` and `:61`: rename the local `val n` to `call` (or similar). This avoids
  reusing the shadowed `n: Instant` parameter name for an `Int`. Cosmetic only.
- For future mutation proofs, also save the mutated source (as `hel1499-orig.scala`/`hel1499-fixed.scala` were saved)
  so the red does not depend on the notes' prose description.
