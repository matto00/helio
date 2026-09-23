## Standing Constraints

- [C1] Pipeline-run rate limit AND concurrency cap are both DB-backed and global across Cloud Run instances (not per-instance in-memory) -- owner ruling overrides the orchestrator's split-recommendation.
- [C2] Guard checks must be atomic under concurrent writers -- an atomic upsert or row lock, never read-then-write -- so two Cloud Run instances incrementing the same window/slot cannot both pass the check.
- [C3] Old rate-limit windows/counters must be cleaned up (no unbounded table growth).
- [C4] The guard check must stay off blocking Pekko actor execution paths, and must be callable from all three existing run-trigger paths (PipelineRunSubmitRoutes, HookTriggerService, PipelineSchedulerService) via PipelineRunService.submit -- never an HTTP-only directive.
- [C5] Pipeline analyze is deliberately EXCLUDED from the tighter per-user rate limit (HEL-1092: analyze walks the DAG symbolically, no row reads) and stays on the default HEL-495 limiter -- a documented deviation from the ticket's literal AC text; must be stated explicitly in proposal.md and the PR body so no gate/reviewer flags it as a missed AC.
- [C6] If a new migration is needed for the DB-backed guard state, claim V109 (next free after V108) and follow V108's NO FORCE / FORCE RLS pattern if the table is tenant-scoped -- remember Flyway runs as the non-BYPASSRLS helio role in prod and dev/CI mask RLS failures (MISTAKES.md).
- [C7] Dry runs (isDry=true) are EXCLUDED from the pipeline-run CONCURRENCY cap only -- they remain fully subject to the rate limit. Design-gate skeptic round 1 found insertDryRun/onDryRunSuccess writes an already-terminal row only AFTER execution, so a live dry run cannot occupy a non-terminal pipeline_runs row without restructuring HEL-509/HEL-873's established single-statement dry-run persistence invariants -- judged out of this ticket's scope. Must be stated explicitly in the PR body (design.md Decision 3, Risks) so it is never mistaken for an oversight.

## 1. Migration: pipeline_run_rate_window (V109)

- [x] 1.1 Claim migration V109 (confirm no other lane has claimed it since Setup). Create `V109__pipeline_run_rate_window.sql`: table `pipeline_run_rate_window(user_id UUID NOT NULL REFERENCES users(id), window_start TIMESTAMPTZ NOT NULL, request_count INT NOT NULL, PRIMARY KEY (user_id, window_start))`.
- [x] 1.2 `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + an owner-predicate policy (`user_id = current_setting('app.current_user_id')::uuid`), following V88's `assistant_daily_usage` pattern exactly (design.md Decision 4).
- [x] 1.3 Add `pipeline_run_rate_window` to `RlsPolicyGuardSpec`'s `rlsTables` allowlist (CONTRIBUTING.md's 4-step "Adding a new ACL'd table" checklist).

## 2. Pipeline-run guard: rate limit

- [x] 2.1 New `PipelineRunGuardRepository` (or equivalent), mirroring `AssistantDailyUsageRepository`'s shape: an `incrementRateIfUnderLimit(userId, limit, windowSeconds): Future[Option[Long /* retryAfterSeconds on rejection */]]` (or a clearer two-value result type) implementing design.md Decision 2's window-bucketed atomic upsert, INCLUDING the `limit < 1` short-circuit (checked in application code before issuing SQL, mirroring `AssistantDailyUsageRepository.incrementIfUnderCap`). Routed through `DbContext.withUserContext`. Applies identically regardless of `isDry`.
- [x] 2.2 Add a `ServiceError.TooManyRequests(retryAfterSeconds: Long, reason: String)` case (or reuse an existing equivalent if one exists — check first) and map it to HTTP 429 + `Retry-After` + `ErrorResponse` in `ServiceResponse`/route error translation, matching `RateLimitDirective`'s existing 429 shape.
- [x] 2.3 Implement the required cleanup for `pipeline_run_rate_window` row growth (design.md Decision 2) — a periodic delete of rows older than a small multiple of the window, piggybacked on an existing tick (e.g. `PipelineSchedulerService.tick()`) or run opportunistically. Document the chosen mechanism and why.
- [x] 2.4 Call the rate-limit check unconditionally (both dry and real) at the very top of `executeRun`, before `preExec`/`backend.execute` — the only pipeline-run guard check dry runs are subject to (C7).

## 3. Pipeline-run guard: concurrency cap (real runs only — C7)

- [x] 3.1 New `PipelineRunRepository.insertRunIfUnderConcurrencyCap(runId, pipelineId, startedAt, user, triggerSource, triggeredByTokenId, maxConcurrent): Future[Boolean]`, composing design.md Decision 3's three steps — `pg_advisory_xact_lock(hashtext('pipeline-run-concurrency:' || userId))`, the pipeline-owned check (mirror `pipelineOwnedAction`), the live count of non-terminal (`status NOT IN ('succeeded','failed','dry_run')`) runs for pipelines owned by that user, and the conditional insert — as ONE chained `DBIO` passed to a SINGLE `ctx.withUserContext(user.id.value)(...)` call. Do NOT implement this as separate repository calls (a separate "check" call followed by a separate `insertRunInternal` call) — that reintroduces the exact read-then-write race C2 forbids, per the skeptic's round-1 finding. Returns `false` (no insert performed) when the cap is already reached.
- [x] 3.2 Restructure `executeRun`'s `preExec` (`PipelineRunService.scala:944-950`) to call `insertRunIfUnderConcurrencyCap` in place of the current plain `insertRun` call, for the non-dry path ONLY (per C7 — dry runs skip this call entirely and proceed straight to `backend.execute` after the rate-limit check in 2.4). On `false`, `executeRun` must return `Left(ServiceError.TooManyRequests(...))` immediately, WITHOUT ever calling `backend.execute` — this requires `preExec`'s type to become short-circuiting (e.g. `Future[Either[ServiceError, Unit]]`) rather than the current `Future[Unit]`. Confirm this against the actual current code before implementing (don't assume the line numbers above are still accurate — re-read the file first).
- [x] 3.3 Verify "completing a run frees a slot" holds with no separate release code — confirm every path that can terminate a REAL run (success, failure, and any error/exception path) reaches `updateRunTerminal` (or an equivalent terminal-status write) so a crashed/errored run cannot strand a slot indefinitely. If a gap is found (e.g. an exception path that never reaches a terminal write), fix it or escalate — do not ship a known leak.

## 4. Wire the guard into `PipelineRunService.submit` / `executeRun`

- [x] 4.1 Confirm both guard checks (rate limit at the top of `executeRun` per 2.4; concurrency cap inside the restructured `preExec` per 3.2) are reached for every value of `triggerSource` — `submit`'s existing three callers (`PipelineRunSubmitRoutes`, `HookTriggerService`, `PipelineSchedulerService`) require no changes themselves, since they already reach `executeRun` via `submit` → `runPipeline` → `executeRun` unconditionally.
- [x] 4.2 Confirm the check does not run on any Pekko actor's own execution thread in a blocking way (C4) — it's already `Future`-returning DB work off the actor path, same as every other repository call in this service; note explicitly in the PR why this holds.

## 5. Source-fetch/preview tighter rate limit

- [x] 5.1 Wire `SourcePreviewRoutes` and `DataSourcePreviewRoutes` with `rateLimitDirective.rateLimit(SOURCE_FETCH_RATE_LIMIT_PER_WINDOW)` (design.md Decision 6) — unmodified existing directive, just a tighter per-call limit.
- [x] 5.2 Do NOT wire pipeline `analyze`'s route with a tighter limit (design.md Decision 5, C5) — leave it on the default `RateLimitDirective` limit. Add a code comment citing HEL-1092 and this ticket's owner ruling so a future reader doesn't "fix" it as a missed AC.

## 6. LLM guard hook (documentation only)

- [x] 6.1 Add a scaladoc note on `ClaudeClient` (or the most relevant construction site) documenting that a future user-facing chat/assistant route MUST wrap itself with `rateLimitDirective.rateLimit(<tighter limit>)` upstream of `ClaudeConfig`'s own spend budgets, per design.md Decision 7 — no new code path, no new unused env var.

## 7. Config + docs

- [x] 7.1 Add a `PipelineRunGuardConfig` (or extend `RateLimitConfig`'s sibling convention) `fromEnv()` case class reading `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` (default 10), `PIPELINE_RUN_RATE_WINDOW_SECONDS` (default 60), `PIPELINE_RUN_MAX_CONCURRENT` (default 3), `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS` (default 15), `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` (default 30).
- [x] 7.2 Add all five new env vars to CLAUDE.md's production env var table (design.md Decision 8), each with the same Required/Description shape as existing rows, citing HEL-505.
- [x] 7.3 Trace `.github/workflows/cd-backend.yml` for whether any new var needs propagating — confirmed in design.md that no `RATE_LIMIT_*` var is set there today either, so the expectation is "no CD change needed" for the same reason; verify this expectation still holds against the live file and state the conclusion explicitly in the PR body.

## 8. Tests (mutation-proved, per the "guard proof must go red first" standing instruction)

- [x] 8.1 Integration test: submitting more than `PIPELINE_RUN_MAX_CONCURRENT` concurrent REAL (non-dry) runs for one user returns 429 with `Retry-After`; completing one frees a slot for a subsequent submission (the AC's own literal integration-test requirement). ALSO add an explicit test/comment confirming dry runs are NOT subject to this cap (C7) — a positive assertion of the documented exclusion, not silence.
- [x] 8.2 Integration test: submitting more than `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` runs (mix of dry and real) within one window for one user returns 429 with `Retry-After`; a different user's budget is unaffected.
- [x] 8.3 Test that both guards apply identically regardless of trigger source (manual submit route, `HookTriggerService`, `PipelineSchedulerService`) — per the pipeline-run-guard spec's "applies uniformly" requirement.
- [x] 8.4 Cross-instance test (or the closest feasible approximation in this test harness — e.g. two `PipelineRunGuardRepository`/service instances sharing one DB connection/pool, simulating two backend instances) demonstrating the DB-backed guard is NOT bypassable by routing requests through a second in-process instance, unlike the in-memory `InMemoryRateLimiter`. Cover BOTH the rate-limit table and the concurrency advisory-lock+count+insert composition — the latter is the one that actually needs a genuine concurrent-writer race test (two simultaneous submissions racing the SAME advisory lock), not just a sequential re-check.
- [x] 8.5 Source-fetch/preview integration test: tighter limit enforced; normal usage under the tighter limit is unaffected.
- [x] 8.6 Explicit test (or documented manual check) that `analyze` is NOT subject to the tighter limit (C5) — a regression guard against someone "fixing" this as a missed AC later.
- [x] 8.7 Mutation-prove each guard: temporarily break the atomicity (e.g. revert to read-then-write) or the limit comparison and confirm the test in 8.1/8.2 goes red, then confirm it's green again on the real implementation — per the standing "must go red first" instruction. Record this as evidence, not just a claim.
- [x] 8.8 `sbt compile test` green (ticket's own literal AC).

## 9. RLS verification (per MISTAKES.md — dev/CI mask RLS failures)

- [x] 9.1 Follow the repo's documented RLS-testing procedure (see MISTAKES.md's RLS entries) to verify the new table's policy actually blocks cross-user reads under the non-BYPASSRLS app pool, not just under a superuser/BYPASSRLS connection that would silently pass regardless of the policy.
