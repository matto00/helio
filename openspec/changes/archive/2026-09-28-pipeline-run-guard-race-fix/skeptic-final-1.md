## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `pwd -P` = `/home/matt/Development/helio`; `assert-cwd.sh` returned
  `READY ambient=/home/matt/Development/helio branch=bug/pipeline-run-guard-concurrency-race/HEL-1184`
  before any other read/write.
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `files-modified.md`,
  `evaluation-1.md`, all three `skeptic-design-*.md` rounds, and `workflow-state.md` in full,
  plus `HEAD` (`a29787eccb00133dbc55bcdae53d41a2e2584b3b`) in full via `git diff`.
- Resolved the review base live (never a cached value):
  `scripts/concertino/resolve-review-base.sh` → `9e1f7998ee838a3c1576212e4c69d45bdf816b1d`
  (matches `workflow-state.md`'s `main`/`origin`, and matches the exact PR HEAD, `9e1f7998`,
  from the session's own git-status banner). `git diff 9e1f7998...HEAD --stat` confirms exactly
  one non-planning file touched:
  `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
  (65 lines changed) plus the expected `openspec/changes/pipeline-run-guard-race-fix/**`
  planning artifacts. Zero bytes touched in `PipelineRunService.scala` or
  `PipelineRunRepository.scala` — confirmed myself, not trusted from either report.
- Read the full diff of the one modified file directly (not summarized) and traced every line
  against `files-modified.md`'s narrative — matches exactly.

**Independent gate re-runs (fresh, not trusted from either report):**
- `sbt "testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec"` → **10/10
  passed** (includes "rejects more than maxConcurrent REAL concurrent submissions").
- `sbt "testOnly com.helio.infrastructure.persistence.pipelines.PipelineRunRepositorySpec"` →
  **38/38 passed** (includes "concurrent submissions for the same owner never exceed the
  concurrency cap").
- Full `sbt test` → **4831/4831 passed, 0 failed**, run to completion in 5m48s. Exact match to
  both the executor's and evaluator's claimed counts, reproduced independently in this session
  rather than accepted on narrative.

### Scrutiny point 1 — H1-over-H2, ruled out or merely not found?

Ruled out, not merely un-found. Two independent lines of evidence, both re-verified myself:
- The failing-test-level probe (230 total forced-small-pool iterations, pool 2/3, single JVM,
  `nice -n 19`) actively looked for the H2 signature (two admission decisions racing each other
  with an inconsistent/stale count *while the gate was held*) and found it in exactly zero of
  230 iterations — every over-admission traced to a straggler settling *after* `gate.success(())`,
  which is the H1 signature, not the H2 one. These are distinguishable failure shapes, not one
  inferred from the absence of the other.
- The repository-level test (`PipelineRunRepositorySpec.scala:639-660`, 12 concurrent writers,
  zero gate/polling confound) provides an independent, higher-contention channel that would
  plausibly also show H2 if it existed — clean git history, clean standalone pass (38/38, I
  re-ran it), and (critically) a mutation-kill that went **red on the very first, non-looped run**
  when the lock acquisition was dropped. That immediate red is itself strong evidence the 12
  `Future.sequence` writers really do produce overlapping DB transactions in practice (a
  guard that only ever saw serialized/non-overlapping calls would not reliably break on the very
  first attempt merely from removing a lock that was never actually contended). I read
  `PipelineRunRepository.insertRunIfUnderConcurrencyCap` (lines 129-159) directly: lock → owner
  check → live count → conditional insert are one `DBIO` chain under one `ctx.withUserContext`
  transaction, exactly as both reports describe, and exactly what the described mutation
  (`concurrencyLockAction` → `DBIO.successful(())`) would break.
- H1 call is sound.

### Scrutiny point 2/3 — `awaitAllSettled`/latch/`onAdmitted` correctness and the 5s wait

Read the diff and the production control-flow (`PipelineRunService.executeRun`,
lines 959-1049) myself, independent of both reports' narration:
- `preExec` (the guard's lock+count+insert decision) always fully resolves to `Right(())`
  before `backend.execute()` is ever invoked (line 1031's `preExec.flatMap` gate). So
  `onAdmitted()`, fired at the top of the test's `GatedExecutionBackend.execute()` override,
  strictly before `gate.map(...)`, is a faithful "this submission's admission decision has
  settled: Admitted" signal — not an approximation.
- In this exact test's fixture (`rateLimitPerWindow = 100`, `maxConcurrent = 3`, 8 attempts,
  same user, no artificial throttling), `submit()` can only resolve `Right(...)` (admitted,
  counted by `onAdmitted`) or `Left(TooManyRequests)` (rejected, counted by the `andThen`'s
  first case). I checked `runPipeline`/`executeRun` for any other reachable `Left` in this path
  (`NotFound`, `Forbidden` require a different pipeline/user; `RateLimitExceeded` is unreachable
  at `rateLimitPerWindow=100` against 8 calls) — none apply here. The evaluator's finding that
  the wildcard `case _ => ()` would swallow a `Failure`/other-`Left` outcome is correct as a
  latent gap, but I independently confirm it is unreachable in the committed fixture and, if it
  were ever hit, `awaitAllSettled`'s `latch.await(5, TimeUnit.SECONDS) shouldBe true` would
  return `false` and the test would fail loudly with the `withClue` count — never a false pass.
  I agree with the evaluator's judgment here on independent inspection, not merely by accepting
  it.
- On whether the 5s bounded wait is a disguised retry/sleep/loosened-assertion (the ticket's
  explicit prohibition), forming my own view rather than adopting the evaluator's: the
  `awaitQueuedCount` helper it replaces was the actual sleep/poll (`Thread.sleep(20)` in a loop,
  inferring settlement from an indirect, staleable DB row count — the literal root cause).
  `awaitAllSettled` blocks on a `CountDownLatch` fed directly by the real settlement events
  (`onAdmitted`, and each submission's own `Future` resolving) — it does not infer, poll, or
  retry anything; it waits once for a fixed set of direct signals. The final assertion
  (`results.count(_.isRight) shouldBe maxConcurrent`, the rejection count, `retryAfterSeconds`)
  is unchanged and unweakened. The timeout is a hang-guard, not part of the correctness
  argument — if the latch never reaches zero because of a real regression, the test fails, it
  does not retry or pass. This is a bounded wait on a genuine synchronization primitive, not a
  prohibited retry/sleep/loosened-assertion. I concur with the evaluator's conclusion, reached
  independently against the diff and the ticket's own wording of the prohibition.

### Scrutiny point 4 — is citing (not duplicating) `PipelineRunRepositorySpec` sufficient?

Yes, and this was adversarially tested across the design gate's own three rounds before this
code was written — I read all three `skeptic-design-*.md` reports directly (not summarized).
Round 1 flagged the exact concern this scrutiny point raises (does this existing test satisfy
"a deterministic interleaving test," or does it merely rely on incidental JVM scheduling to
produce contention?) and required the design to state explicitly which. Round 2 caught a real,
separate gap (the mutation-kill requirement had been silently scoped only to "newly added"
tests, excluding the cited pre-existing one) and required it be broadened — which the
implementation then correctly did (files-modified.md 2.4, independently re-verified above).
Round 3 re-confirmed both fixes were applied correctly with no new gap. My own reading of the
guard's code confirms the design's underlying argument is sound: the guard's correctness claim
is "correct under ANY interleaving" (that is what the advisory lock buys), so a plain
`Future.sequence` burst against 12 concurrent writers is a legitimate, not merely convenient,
proof of that property — it does not need to *control* the interleaving, only to *produce*
genuine concurrent contention, which the mutation-kill's immediate-red result empirically
confirms it does. I found no gap the three design-gate rounds missed.

### Scrutiny point 5 — regression risk to the other 9 tests in the file

None. `newGatedService`/`GatedExecutionBackend`'s new `onAdmitted` parameter is optional with a
no-op default (`() => ()`), preserving the old call signature. I grepped the full file: only the
one test under review (`"rejects more than maxConcurrent REAL concurrent submissions..."`, the
sole call site of `newGatedService`) uses `onAdmitted`/`GatedExecutionBackend`/`awaitAllSettled`
at all. The other 9 tests use the plain `newService` helper and are untouched by this diff. The
independent 10/10 fresh run above (all 10 tests, not just the target one) confirms no collateral
breakage.

### Scrutiny point 6 — diff minimality and commit hygiene

`git diff --stat` against the resolved base shows exactly one non-planning file touched, 65
lines. No production code, no unrelated files. Commit `a29787ec` is `HEL-1184`-prefixed, its body
accurately narrates the probe, the confirmed root cause, the fix, the cited-test verification,
and the mutation-kill result — every claim in it I was able to independently re-verify against
the diff and a fresh test run matched. It carries the `Co-Authored-By`/`Claude-Session` trailer.
Branch name follows the `[bug]/[description]/[ticket-id]` convention.

### Gate-defect check (mtime-ordering acceptance)

`evaluation-1.md` does not rely on mtime ordering or disclose any evidence-directory mtime
unsoundness; its load-bearing claims (test counts, `git diff --name-only`, direct code reads)
are all self-authenticating (counts, line citations, diffs) and I independently reproduced the
numeric ones myself rather than accepting them at face value. No gate defect to record on this
axis.

### Verdict: CONFIRM

Every scrutiny point in the assignment was independently re-derived from ground truth (fresh
gate re-runs matching both reports' exact counts, direct reads of the production guard code, the
test diff, and all three design-gate skeptic rounds) rather than accepted from either the
executor's or evaluator's narrative. H1 is genuinely probe-confirmed and H2 genuinely ruled out
(not merely unfound); the new settlement mechanism is correct for every reachable path in this
test and fails loud, not silent, on the one unreachable path; the 5s latch wait is a bound on a
real synchronization signal, not a disguised retry/sleep; the cited pre-existing repository test
is a legitimate, adversarially-tested substitute for a new "deterministic interleaving test";
there is no regression risk to the file's other tests; and the diff/commit are minimal and
accurately described. This ships.

### Non-blocking notes

- The evaluator's own non-blocking suggestion (make the `andThen`'s `case _` explicit about
  which outcomes it assumes, or count down on any settlement rather than only
  `TooManyRequests`) is reasonable defensive hardening for a future maintainer who reintroduces
  pool-throttling to this test, but is correctly not a Change Request — it cannot mask a defect
  or loosen the assertion today.
