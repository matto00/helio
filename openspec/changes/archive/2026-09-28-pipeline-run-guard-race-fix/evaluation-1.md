## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- Ticket's `Required` list addressed explicitly and in the specified order: probe-confirm
  before any fix (`.concertino/laws/systematic-debugging`), branch on the confirmed root
  cause, never fix by loosening the assertion/retrying/sleeping, mutation-kill the relied-upon
  guard-atomicity test.
- H1 confirmed / H2 refuted via a forced-small-pool repro (pool 2 and 3, single JVM, `nice -n
  19`, well under the 3-4-worker hardware cap) — matches design.md Decision 1's prescribed
  methodology and the ticket's own suggested probe shape. No reinterpretation of the AC: the
  driver's "unverified hypothesis" (H1) is exactly what the probe confirmed, and the report is
  explicit that H2 was independently checked and ruled out, not merely assumed absent.
  Independently verified against `PipelineRunService.executeRun` (lines 1003-1029): the
  concurrency-cap decision (`preExec`) always fully resolves to `Right(())` before
  `backend.execute()` is called, confirming `onAdmitted()`'s "fires on entry to `execute()`"
  really is a faithful post-admission-decision signal, not merely asserted.
  `PipelineRunGuardIntegrationSpec.scala:265-303` (`git diff` view).
- Tasks 1.0-3.3 in `tasks.md` are all `[x]` and each matches what the diff/`files-modified.md`
  actually shows: 1.0's git-log-and-standalone-run check, 1.1's instrumentation (added and
  later removed — confirmed absent from the final diff), 1.2/1.3's forced-pool loop and
  explicit H1 conclusion, 2.1's `awaitAllSettled` replacement, 2.2's cite-not-duplicate
  resolution of `PipelineRunRepositorySpec.scala:639-660`, 2.3's N/A-with-justification, 2.4's
  mutation-kill (see Phase 2), 3.1-3.3's gate re-runs and instrumentation-removal claim (all
  independently re-verified fresh — see Phase 2).
- No scope creep: `git diff` against the resolved review base
  (`9e1f7998ee838a3c1576212e4c69d45bdf816b1d...HEAD`) touches exactly one non-planning file —
  `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
  — plus the expected `openspec/changes/pipeline-run-guard-race-fix/**` planning artifacts.
  `PipelineRunService.scala` and `PipelineRunRepository.scala` are untouched, confirmed by
  `git diff --name-only` myself (not just trusting the executor's own claim).
- No regressions: full `sbt test` (see Phase 2) is 4831/4831 green.
- API contracts: none affected (no production code touched; ticket's own proposal.md correctly
  scopes this as "no spec-level requirement changes either way").
- Planning artifacts reflect final implemented behavior: design.md's Decision 3 (H1 fix shape,
  cite-not-duplicate for 2.2) and Decision 4 (mutation-kill required even for a cited
  pre-existing test) are both implemented exactly as decided, including both design-gate REFUTE
  rounds' corrections (round 1's cite-vs-add rescoping, round 2's mutation-kill-applies-to-cited-
  test-too fix).
- `workflow-state.md`'s `CONSTRAINTS` field is `[]` (no non-retired entries) — nothing to
  check there. The ticket's own "Standing constraints (from driver)" section was cross-checked
  directly: no migration added (V110 remains latest, matching "probably not needed"), no
  "owner ruling" language used anywhere in the diff/commit/files-modified.md, a follow-up
  decision was made explicitly ("None filed" with stated rationale) rather than silently
  skipped, and the "never fix by loosening the assertion, adding retries, or sleeping" and
  "a guard test must be failable by mutation" constraints are both addressed — see Phase 2 for
  the detailed correctness analysis of each.

### Phase 2: Code Review — PASS

Issues: none blocking. One non-blocking robustness gap noted below.

**Gates re-run fresh, independently, in `WORKTREE_PATH` (not trusted from the executor's
report):**
- `sbt "testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec"` → 10/10 passed
  (matches claim).
- `sbt "testOnly com.helio.infrastructure.persistence.pipelines.PipelineRunRepositorySpec"` →
  38/38 passed (matches claim, including "concurrent submissions for the same owner never
  exceed the concurrency cap").
- Full `sbt test` → **4831/4831 passed, 0 failed, 0 regressions** (exact match to the
  executor's claimed count). Ran to completion in 5m24s.
- `npm run check:scala-quality` → clean (186 pre-existing informational soft-budget warnings,
  unrelated to this diff; `PipelineRunGuardIntegrationSpec.scala` was already over the 250-line
  soft budget at 331 lines pre-change, now 355 — a pre-existing, informational-only condition,
  not a new violation this diff introduces as a hard failure).
- No `frontend/**` files changed by this diff, so the frontend gate set (lint/format/test/build)
  is not applicable per the evaluator's own trigger rule.

**`git diff` confirms the diff is exactly what's claimed:** test-only
(`PipelineRunGuardIntegrationSpec.scala`), zero bytes changed in `PipelineRunService.scala` or
`PipelineRunRepository.scala` — confirmed via `git diff --name-only
9e1f7998ee838a3c1576212e4c69d45bdf816b1d...HEAD`, not the executor's own assertion.

**`awaitAllSettled`/`CountDownLatch`/`onAdmitted` mechanism — verified correct for every
realistic code path in this test:**
- `attempts = 8`, `CountDownLatch(attempts)`. Each of the 8 `service.submit(...)` calls is
  wrapped once: an admitted submission counts down via `onAdmitted()` (fired synchronously on
  entry to `execute()`, strictly before blocking on `gate`); a rejected submission counts down
  via its own `.andThen { case Success(Left(_: ServiceError.TooManyRequests)) => ... }`.
- No double-counting: an admitted submission's outer `Future` cannot complete (and so its
  `andThen` cannot fire) until `gate.success(())` is called, which happens strictly *after*
  `awaitAllSettled` returns — so by the time that `andThen` does fire, it sees
  `Success(Right(_))`, which falls into the `case _ => ()` no-op branch. Each of the 8
  submissions therefore counts down exactly once via exactly one of the two paths.
- **One real, if narrow, gap**: the `andThen`'s wildcard `case _ => ()` also swallows a
  `Failure(exception)` (the submission's `Future` failing outright, e.g. an unexpected DB
  error) and a `Success(Left(_))` of any `ServiceError` subtype other than `TooManyRequests`.
  Neither counts down the latch. In the *committed* test (normal `Some(10)` pool,
  `rateLimitPerWindow = 100` against 8 attempts, no artificial throttling), this path is not
  realistically reachable — `submit`'s only plausible `Left` for this fixture is the
  concurrency-cap rejection. Critically, this gap **fails safe, not silent**: if it were ever
  hit, `awaitAllSettled`'s `latch.await(5, TimeUnit.SECONDS) shouldBe true` would time out and
  the test would fail loudly with the `withClue` message naming how many submissions never
  settled — it would never proceed to `gate.success(())` and produce a false pass. This is a
  non-blocking suggestion (see below), not a Change Request, because it cannot mask a defect or
  loosen the assertion; it can only turn an already-unexpected condition into a slower, still-
  correctly-red failure.
- Confirmed against `PipelineRunService.executeRun` (`PipelineRunService.scala:1002-1049`):
  `preExec` (the guard's admission decision, including the DB insert) fully resolves to
  `Right(())` before `backend.execute(...)` is invoked — so `onAdmitted()` firing on entry to
  the test's `execute()` override is a faithful "this submission's admission decision has
  settled" signal, exactly as the design doc and the code's own comment claim.

**"Never fix by loosening the assertion, adding retries, or sleeping" — honored, does not cross
the line.** `latch.await(5, TimeUnit.SECONDS)` is a bounded wait on a genuine synchronization
primitive (a `CountDownLatch`), not a retry or a sleep:
- It is not a retry: there is no re-attempt of a failed action anywhere in this path — each
  submission signals its own settlement exactly once, and the test waits once for all 8 signals.
- It is not the same kind of "sleep" the removed `awaitQueuedCount` used
  (`Thread.sleep(20)` in a poll loop that inferred settlement from an indirect, staleable
  signal — a DB row count). `awaitAllSettled` never infers anything from polling state; it
  blocks on a direct signal fired by the exact code paths (`onAdmitted`/the submission's own
  `Future`) that constitute "this submission's decision has settled."
- The final assertion (`results.count(_.isRight) shouldBe maxConcurrent`, plus the rejection-
  count and `retryAfterSeconds` checks) is byte-for-byte unchanged from before this fix — still
  strict, nothing loosened.
- The 5-second timeout is solely a safety valve against an indefinite hang if something is
  fundamentally broken; it plays no role in the correctness of the concurrency-cap assertion
  itself (that assertion's correctness depends on the latch reaching zero via genuine signals,
  not on the timeout). This is the correct fix shape for a test-coordination race, not a
  reintroduction of timing-dependence.

**Mutation-kill claim (2.4) — cross-checked against the actual guard code, found credible.**
Read `PipelineRunRepository.insertRunIfUnderConcurrencyCap`
(`PipelineRunRepository.scala:128-159`) directly: the lock acquisition
(`_ <- concurrencyLockAction(user.id.value)`), the ownership check, the live non-terminal count,
and the conditional insert are composed into ONE `DBIO` `for`-comprehension, run under a single
`ctx.withUserContext` transaction. The method's own doc comment (lines 100-108) explicitly states
the advisory lock is what prevents two concurrent transactions from both reading the pre-insert
count under READ COMMITTED before either commits. Replacing
`_ <- concurrencyLockAction(user.id.value)` with `_ <- DBIO.successful(())` — the described
mutation — removes exactly that serialization: under `PipelineRunRepositorySpec.scala:639-660`'s
12 concurrent `Future.sequence` writers (each opening its own transaction), multiple writers
could then read the same pre-insert count before any of them commits and each independently
decide "under cap," over-admitting. This is a textbook TOCTOU race reintroduced by exactly the
described one-line change, and "4 was not equal to 3" (the claimed failure) is exactly the
expected shape of that failure against `attempts=12, maxConcurrent=3`. The claim is credible;
I did not need to (and per this role's guardrails, must not) apply the mutation myself to reach
that conclusion.

**Cited pre-existing test (2.2) — citation verified accurate.** Read
`PipelineRunRepositorySpec.scala:600-660` directly: `"concurrent submissions for the same owner
never exceed the concurrency cap"` (lines 639-660) drives exactly 12 concurrent
`insertRunIfUnderConcurrencyCap` calls via real `Future.sequence`, asserts
`results.count(_ == Inserted) shouldBe maxConcurrent` and the complementary `CapExceeded` count,
with zero gate/polling machinery — an accurate, independent atomicity proof as claimed.

**No leftover debug instrumentation:** grepped the final file for `println`, `nanoTime`,
`scribe.`, `iter=`, `TODO`, `FIXME` — zero hits. The claimed removal (task 3.3) is confirmed.

**CONTRIBUTING.md Imports & Qualifiers rule:** new imports (`java.util.concurrent.{CountDownLatch,
TimeUnit}`, `scala.util.Success`) are added at the top of the file; no inline FQNs introduced in
the new code. `npm run check:scala-quality` (the mechanical enforcement of this rule) passed
clean.

**DRY / readable / modular:** `awaitAllSettled` and `onAdmitted` are small, single-purpose, and
the doc comments explain *why* (the settlement-vs-row-count distinction), not just *what*. No
duplication introduced; the mechanism reuses the existing `GatedExecutionBackend`/
`newGatedService` scaffolding rather than inventing a parallel one.

**Type safety / error handling:** no untyped escape hatches. The `andThen` pattern match is
exhaustive over `Try[Either[ServiceError, RunResultResponse]]` (no `MatchError` risk — `case _`
covers everything not explicitly matched), consistent with Scala's total-match requirement;
see the non-blocking suggestion below for the one behavioral (not type-safety) gap in that
`case _`.

### Phase 3: UI Review — N/A

This is a backend-only debugging/investigation ticket. `git diff --name-only` against the
resolved review base shows no `frontend/**` files, no changes to
`backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**` changes, and no
`openspec/specs/**` changes — none of Phase 3's triggers match. No dev servers were started;
Phase 3 is explicitly not applicable rather than silently skipped.

### Overall: PASS

### Non-blocking Suggestions

1. `PipelineRunGuardIntegrationSpec.scala:290-293` — the settlement `andThen`'s `case _ => ()`
   silently no-ops on a `Failure(exception)` or a `Success(Left(_))` of any `ServiceError` other
   than `TooManyRequests`, rather than counting down (or explicitly documenting why those cases
   are intentionally excluded). This is not realistically reachable in the committed test's
   fixture (normal pool, generous rate limit) and fails safe (the test times out and fails loud
   via `awaitAllSettled`'s `withClue` rather than passing falsely), so it is not a Change
   Request — but a future maintainer adding pool-throttling back to this test (as the temporary
   probe did) could reintroduce a `Failure` path that silently eats 5 seconds before failing.
   Consider either counting down on any settlement outcome (`case _ => settled.countDown()`
   after the `TooManyRequests`-specific branch) or adding a one-line comment noting the
   assumption that no other outcome is reachable here.
