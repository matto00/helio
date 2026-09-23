## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `c06741731bf3aaedd760c407ddc55a1763fcbec6` against base
`e08cce1d05bb4476503c797de48aa4ac02cdfd65` (resolved live via
`resolve-review-base.sh`, matches the base at the start of this review).

### What I verified (with evidence)

**Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=... branch=feature/expensive-op-guards/HEL-505` before any other action.

**ACs traced to real code/tests:**
1. Concurrency cap 429 + slot-freeing: `PipelineRunRepository.insertRunIfUnderConcurrencyCap`
   (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala:137-158`),
   wired into `PipelineRunService.executeRun`'s `preExec`
   (`PipelineRunService.scala:970-996`). Integration-tested end-to-end in
   `PipelineRunGuardIntegrationSpec` — "rejects more than maxConcurrent REAL
   concurrent submissions" (8 concurrent, exactly 3 succeed) and "completing a
   run frees a slot for a subsequent submission."
2. Source-fetch/preview tighter rate limit, `analyze` excluded (C5): verified
   in `ApiRoutes.scala` (a second, independent `RateLimitDirective` instance,
   applied inside each route class's own `pathPrefix`) and
   `ApiRoutesPipelineRunGuardSpec` (429+`Retry-After` on preview/test routes,
   zero 429s across 3 `analyze` calls under a limit that would have caught the
   original external-wrap bug).
3. LLM guard hook documented, no duplicate spend logic: `ClaudeClient.scala`
   scaladoc (Decision 7) plus CLAUDE.md — doc-only, no new runtime path.
4. `sbt compile test` green: **independently re-ran the FULL suite myself**
   (`cd backend && sbt test`, fresh run, not trusting the evaluator's pasted
   number) — `4738/4738 tests passed, 317 suites, 0 failed`. Matches the
   evaluator's claim exactly.

**design.md's binding decisions, checked against the actual diff (not just design.md's prose):**
- **Decision 3's exact atomicity mechanism** (one chained `DBIO` in one
  `withUserContext` call, not two separate calls): confirmed by reading
  `PipelineRunRepository.insertRunIfUnderConcurrencyCap` — the advisory lock,
  ownership check, live count, and conditional insert are composed via a
  single `for {} yield` into one `DBIO[ConcurrencyCapResult]`, passed to
  exactly one `ctx.withUserContext(user.id.value)(action)` call. Confirmed
  `DbContext.withUserContext` wraps its single `DBIO` argument
  `.transactionally` (`DbContext.scala:50-51`), so this really is one Postgres
  transaction, not two.
- **C7's dry-run split**: rate limit runs unconditionally on `isDry` at the
  top of `executeRun` (`PipelineRunService.scala:962-968`); the concurrency
  cap is gated on `!isDry` (`PipelineRunService.scala:980`). Both halves have
  positive (not silent) tests in `PipelineRunGuardIntegrationSpec`: "dry runs
  ARE subject to the rate limit" and "dry runs are NOT subject to the
  concurrency cap even when the owner is already at the real-run cap (C7)."
- **C1-C7 in workflow-state.md**: individually traced — C1 (DB-backed,
  global: `pipeline_run_rate_window` table + `pg_advisory_xact_lock`, no
  in-memory fallback for this specific guard), C2 (atomic — see mutation-proof
  below), C3 (cleanup: `PipelineRunGuardRepository.cleanupOldWindows`
  piggybacked on `PipelineSchedulerService.tick()`), C4 (guard lives inside
  `executeRun`, reached uniformly by all three `submit` callers — confirmed
  `HookTriggerService`/`PipelineSchedulerService` both call
  `pipelineRunService.submit`, no HTTP-only directive), C5/C7 (see above), C6
  (V109 is genuinely the next free migration after V108 — confirmed via
  `ls backend/src/main/resources/db/migration/`; new table, so V108's
  NO FORCE/FORCE bracket pattern correctly does not apply, per design.md's own
  reasoning).

**RLS / MISTAKES.md hazard (dev/CI mask RLS under superuser/BYPASSRLS):**
`PipelineRunGuardRepositorySpec` runs a genuine dual-pool harness — a
`helio_app_test` role that is `NOSUPERUSER` with no `BYPASSRLS` grant — and
asserts "RLS: ownerB's context cannot see ownerA's rate-window row" and
"...cannot increment/overwrite ownerA's rate-window row via a direct write"
under that non-privileged pool, distinct from a `withSystemContext` control
test that confirms the privileged pool *does* see the row. This is exactly
the behavioral test MISTAKES.md asks for, not merely the structural
`RlsPolicyGuardSpec` catalog check (which I also independently re-ran, along
with confirming `V109__pipeline_run_rate_window.sql`'s
`ENABLE`/`FORCE ROW LEVEL SECURITY` + single `USING` policy is byte-for-byte
the same shape as V88's `assistant_daily_usage`).

**Independent gate re-runs (fresh, not trusted from either report):**
- `cd backend && sbt test` (full suite): 4738/4738 passed, 317 suites — ran
  myself, ~4m49s.
- `npm run check:scala-quality`: clean, 180 soft (informational) warnings,
  none new besides file-size soft-warnings on the two new spec files
  (within the repo's existing convention for test files).
- Targeted specs (`PipelineRunGuardRepositorySpec`,
  `ApiRoutesPipelineRunGuardSpec`, `PipelineRunGuardIntegrationSpec`,
  `RlsPolicyGuardSpec`): 126/126 passed in isolation.

**Independent mutation-proof reproduction (not just re-reading the narration):**
Reproduced the evaluator's own mutation myself, from a cold read of the code
(not copying their exact diff): changed `count < maxConcurrent` to
`count <= maxConcurrent` in `insertRunIfUnderConcurrencyCap`, ran
`PipelineRunRepositorySpec -- -z "never exceed the concurrency cap"` →
**RED, `4 was not equal to 3`** (exact match to both the executor's and
evaluator's claimed output). Reverted (`git status --porcelain` clean
afterward), re-ran → **GREEN**.

I also ran my own separate exploratory probe (not part of the ticket's own
evidence): restructured `insertRunIfUnderConcurrencyCap` to use two separate
`withUserContext` calls instead of one chained `DBIO`, to try to
independently falsify the atomicity claim via the same concurrency test. On a
single run this did NOT go red — but the executor's own `files-modified.md`
(mutation-proof item 2) discloses that this exact class of mutation is
timing-dependent and went red in only 2 of 3 of their own runs. My single
inconclusive run is consistent with that disclosed flakiness, not evidence
against it, and I weight the code-level fact I verified directly (this really
is composed as one chained `DBIO` in one transaction today) above an
underpowered single-shot probe of a known-flaky race window. I record this
for transparency rather than as a finding — the honest disclosure of
mutation-proof #2's own flakiness in `files-modified.md`, rather than
presenting it as clean, is itself a mark in favor of the delivered evidence's
credibility.

**Non-goals / out-of-scope respected:** `RateLimitDirective`/
`InMemoryRateLimiter` (the core limiter) has zero diff — confirmed via
`git diff` on those files. HEL-390's actual Claude cost-accounting logic is
untouched; HEL-1108's `assistant_daily_usage` is untouched.

**CLAUDE.md documentation**: all five new env vars
(`PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`, `PIPELINE_RUN_RATE_WINDOW_SECONDS`,
`PIPELINE_RUN_MAX_CONCURRENT`, `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS`,
`SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`) present with Required/Description
columns matching the existing table's shape, and `PipelineRunGuardConfig`'s
defaults (10/60/3/15/30) match design.md Decision 8 exactly.

**UI / design judgment**: skipped — `git diff --stat -- frontend/` is empty;
this is a backend-only change (no `frontend/**` files in the diff), so the
design-standard/screenshot review this gate exists for does not apply.

### Verdict: CONFIRM

This ships. Every AC traces to real, independently-reproduced evidence; every
design.md decision (including the load-bearing single-chained-DBIO atomicity
mechanism and the C5/C7 deviations) matches the actual diff line-for-line; the
RLS hazard MISTAKES.md warns about is tested behaviorally under a
non-BYPASSRLS role, not just structurally; and both the full test suite and
the mutation-proof claim reproduce cleanly from a cold start.

### Non-blocking notes

1. The evaluator's own "Minor gap" note stands: there is no HTTP-route-level
   test hitting `PipelineRunSubmitRoutes` directly and asserting the
   `Retry-After` header on a real 429 (coverage stops at the service layer's
   `retryAfterSeconds > 0` assertion plus code inspection of
   `ServiceResponse.completeError`, which is shared with the already
   route-tested source-fetch case). Low risk given the shared implementation,
   but a genuine coverage gap for a future follow-up.
2. `PipelineRunGuardRepository.scala` inlines `java.sql.Timestamp.from(...)`
   twice rather than importing `java.sql.Timestamp` at the top — a literal
   reading of CONTRIBUTING.md's "no inline FQNs" prose, though the mechanical
   `check:scala-quality` gate (the standard's actual enforcement mechanism)
   does not flag this pattern and ran clean. Stylistic only.
