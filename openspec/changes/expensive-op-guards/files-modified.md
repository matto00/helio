## Files modified — HEL-505 expensive-op guards

### New files

- `backend/src/main/resources/db/migration/V109__pipeline_run_rate_window.sql` — new table `pipeline_run_rate_window`, full RLS (owner-predicate policy), following V88's `assistant_daily_usage` pattern.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunGuardRepository.scala` — DB-backed, window-bucketed atomic rate-limit counter (`incrementRateIfUnderLimit`) + bounded cleanup (`cleanupOldWindows`).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunGuardConfig.scala` — `fromEnv()` config case class for the five new env vars.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunGuardRepositorySpec.scala` — rate-limit atomic increment/deny, window bucketing, concurrent-increment cap-holding, cleanup, and genuine dual-pool RLS enforcement tests (task 9.1).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala` — end-to-end guard coverage through `PipelineRunService.submit` (rate limit, concurrency cap, dry-run exclusion (C7), trigger-source uniformity, non-owner regression guard).
- `backend/src/test/scala/com/helio/api/ApiRoutesPipelineRunGuardSpec.scala` — route-level proof that `SourcePreviewRoutes`/`DataSourcePreviewRoutes` are wrapped with the tighter limit and `analyze` deliberately is not (C5).

### Modified files

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala` — new `insertRunIfUnderConcurrencyCap` (advisory-lock + live-count + conditional-insert composed as ONE chained `DBIO`/`withUserContext` call, per design.md Decision 3 Resolution 1); `insertRunInternal` refactored to share the new `insertRunRowAction` DBIO helper (behavior-preserving); new `PipelineRunRepository.ConcurrencyCapResult` (Inserted/CapExceeded/NotOwned) — `NotOwned` was added after a skeptic-caught regression during delivery (see root-cause note below).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — `executeRun` restructured: the rate-limit check runs first (unconditionally on `isDry`, C7); `preExec` becomes short-circuiting (`Future[Either[ServiceError, Unit]]`) and calls `insertRunIfUnderConcurrencyCap` in place of the plain `insertRun` for the non-dry path; the `Failure`/`Success` branches of the original inline `transformWith` are factored into `executeRunFailure`/`executeRunSuccess` (behavior-preserving) to keep the guard-check nesting readable; two new nullable-optional constructor params (`pipelineRunGuardRepo`, `guardConfig`).
- `backend/src/main/scala/com/helio/services/ServiceError.scala` — new `TooManyRequests(retryAfterSeconds, reason)` case.
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — `completeError` special-cases `TooManyRequests` to attach a `Retry-After` header, mirroring `RateLimitDirective`'s existing 429 shape.
- `backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala`, `DataSourcePreviewRoutes.scala` — new nullable `rateLimitDirective`/`rateLimitPerWindow` constructor params; the tighter limit is applied **inside** `pathPrefix(...)`, never wrapped externally (see root-cause note below).
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala` — comment on the `analyze` route citing HEL-1092/C5 (no functional change).
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeClient.scala` — scaladoc documenting the future LLM guard hook (Decision 7, no new code path).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — new `pipelineRunGuardRepo`/`pipelineRunGuardConfig` constructor params; a **second, independent** `RateLimitDirective`/`InMemoryRateLimiter` instance (`sourceFetchRateLimitDirective`) for the tighter source-fetch limit (see root-cause note below); threads both into `pipelineRunService` and the `SourcePreviewRoutes`/`DataSourcePreviewRoutes` mount sites.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `pipelineRunGuardRepo` once, threads it into `ApiRoutes` and `PipelineSchedulerService`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala` — new nullable `pipelineRunGuardRepo` param; `tick()` now also runs `cleanupOldWindows()` (design.md Decision 2, C3), concurrently with candidate processing, never failing the tick.
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` — `pipeline_run_rate_window` added to the `rlsTables` allowlist.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala` — new `insertRunIfUnderConcurrencyCap` describe block (boundary, cross-pipeline count, terminal-state exclusion, slot-freeing, non-owner, concurrent-race); new `seedPipelineFor(ownerId)` helper.
- `CLAUDE.md` — five new env vars added to the production env var table.
- `openspec/changes/expensive-op-guards/tasks.md` — all tasks checked off.

## Root-cause notes (systematic-debugging.md — two real defects found and fixed via the real test suite, not just new tests)

### 1. `insertRunIfUnderConcurrencyCap`'s `false` return collapsed two different outcomes

- **Root cause:** `insertRunIfUnderConcurrencyCap` originally returned a plain `Boolean`. A non-owner (e.g. an editor grantee triggering someone else's pipeline) and a genuinely-at-cap owner both produced `false`, and `executeRun`'s `preExec` treated any `false` as `TooManyRequests`. This broke the pre-existing, already-tested "editor-grantee-triggered run resolves normally despite no persisted run row" behavior (`insertRun`'s existing silent-no-op-for-non-owner semantics), since a non-owner now incorrectly got a 429.
- **Probe:** ran the full pre-existing `PipelineRunServiceSpec` (`sbt testOnly com.helio.services.pipelines.PipelineRunServiceSpec`) after wiring the concurrency cap in.
- **Probe output:** `"an editor-grantee-triggered real run resolves normally despite no persisted run row" *** FAILED ***` — the service returned `Left(TooManyRequests(...))` instead of `Right(...)`.
- **Fix:** `insertRunIfUnderConcurrencyCap` now returns `PipelineRunRepository.ConcurrencyCapResult` (`Inserted` / `CapExceeded` / `NotOwned`) so `executeRun` can treat `NotOwned` exactly like the old silent no-op (proceed) and only `CapExceeded` as a real rejection. Verified: the full `PipelineRunServiceSpec` (87 tests) and `PipelineRunRepositorySpec` (38 tests) are green again.

### 2. Wrapping `SourcePreviewRoutes`/`DataSourcePreviewRoutes` externally leaked the rate-limit check onto unrelated routes, and shared the general limiter's bucket

- **Root cause (two compounding issues), found by `ApiRoutesPipelineRunGuardSpec`:**
  1. Wrapping the whole `.routes` value with `rateLimitDirective.rateLimit(...)` **outside** the class's own `pathPrefix(...)` match caused the check to run for every request that merely *reached* that point in `ApiRoutes`'s outer `concat`, including requests (`/api/pipelines/:id/analyze`) this class's own prefix ultimately rejects — Pekko directives run before the inner route's match/reject is known.
  2. Reusing the SAME `RateLimitDirective`/`InMemoryRateLimiter` instance as the general `/api` default (line ~736) meant one matched preview request incremented **one shared bucket twice** (once via the outer default check, once via the inner tighter check), silently halving the configured tighter limit.
- **Probe:** `sbt testOnly com.helio.api.ApiRoutesPipelineRunGuardSpec`.
- **Probe output (before fix):** `analyze` — never intentionally wrapped — returned 429; `DataSourcePreviewRoutes`'s 2nd request (limit=2) already 429'd instead of the 3rd.
- **Fix:** the rate-limit directive is now applied **inside** each class's own `pathPrefix(...)` (so an unrelated path is rejected before the check ever runs), and `ApiRoutes` constructs a **second, independent** `RateLimitDirective`/`InMemoryRateLimiter` (`sourceFetchRateLimitDirective`) so the tighter budget is genuinely separate from the general default's. Verified: all 4 tests in `ApiRoutesPipelineRunGuardSpec` pass.

## Mutation-proof evidence (tasks.md 8.7 — "must go red first")

Each mutation was applied, its target test run to confirm RED, then reverted and confirmed GREEN again (see full transcript in the executor's return below for the pasted command output):

1. **Concurrency-cap limit comparison** (`count < maxConcurrent` → `count <= maxConcurrent`): `PipelineRunRepositorySpec`'s "concurrent submissions for the same owner never exceed the concurrency cap" went RED (`4 was not equal to 3`), then GREEN after revert.
2. **Concurrency-cap atomicity** (composed single `DBIO`/`withUserContext` → two separate `withUserContext` calls, reintroducing the read-then-write race): the same test went RED in 2 of 3 runs (timing-dependent, as expected for a race), then consistently GREEN after revert.
3. **Rate-limit `WHERE` clause** (`request_count < $limit` → `<= $limit`): `PipelineRunGuardRepositorySpec`'s "cap boundary is exact" test went RED (`false was not equal to true`), then GREEN after revert.

## `.github/workflows/cd-backend.yml` trace (tasks.md 7.3)

Confirmed against the live file: no `RATE_LIMIT_*` var (the existing HEL-495 pair) is set there today, matching design.md's expectation — none of the five new HEL-505 env vars need propagating either. All five apply their documented conservative defaults in production exactly as `RATE_LIMIT_REQUESTS_PER_WINDOW`/`RATE_LIMIT_WINDOW_SECONDS` already do.
