## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket ACs addressed, none silently reinterpreted:
  - Concurrency cap: `PipelineRunRepository.insertRunIfUnderConcurrencyCap` (429 + `Retry-After`,
    slot freed via `updateRunTerminal`, integration-tested in `PipelineRunGuardIntegrationSpec`
    "completing a run frees a slot...").
  - Source-fetch/preview tighter rate limit: wired via a *second, independent*
    `RateLimitDirective`/`InMemoryRateLimiter` (`sourceFetchRateLimitDirective` in `ApiRoutes.scala`)
    applied inside each route class's own `pathPrefix`.
  - LLM guard hook: documented (not implemented) on `ClaudeClient.scala`'s scaladoc, per Decision 7.
  - `sbt compile test` green — independently re-run, confirmed (see Phase 2).
- Two owner-approved deviations from the ticket's literal text (`analyze` excluded — C5; dry runs
  excluded from the concurrency cap only, not the rate limit — C7) are both stated explicitly in
  proposal.md, design.md, tasks.md's Standing Constraints, code comments at the exact decision
  sites (`PipelineRoutes.scala`'s `analyze` route, `PipelineRunService.scala`'s `preExec`), and
  `files-modified.md` — exactly the "must be stated explicitly" requirement C5/C7 impose. Not a
  missed AC; a documented, ruled-on scope narrowing.
- Task list (27 items) all marked done and each item's implementation was independently located and
  matches its description (not just checked off) — verified in Phase 2 below file-by-file.
- No scope creep: the `PipelineRunService.executeRun` refactor (extracting `executeRunFailure`/
  `executeRunSuccess`, and `PipelineRunRepository`'s `insertRunRowAction` extraction) is
  behavior-preserving and directly required by the guard-check restructuring design.md Decision 3
  mandates (short-circuiting `preExec`), not a drive-by refactor.
- No regressions to existing behavior: the executor's own two found-and-fixed regressions
  (non-owner silent-no-op collapsing into 429; `SourcePreviewRoutes`/`DataSourcePreviewRoutes`
  external-wrap leaking onto `analyze` + double-counting a shared bucket) were verified fixed —
  the full 4738-test suite is green (independently re-run, see Phase 2), and the specific regression
  tests exist and assert the correct (fixed) behavior (`PipelineRunGuardIntegrationSpec`'s
  "a non-owner (editor grantee) real run still resolves normally, NEVER as a 429"and
  `ApiRoutesPipelineRunGuardSpec`'s "analyze... exceeds it with zero 429s").
- No API/schema changes needed or made — no new HTTP endpoints, no changed response shapes for the
  success path; `schemas/`/`openspec/specs/` outside this change's own artifacts are untouched,
  consistent with a guard-only change.
- Planning artifacts (design.md, tasks.md) reflect the final implemented behavior exactly — cross-
  checked design.md Decisions 1–8 against the actual diff line-by-line (Phase 2); no divergence
  found.
- All 7 non-retired `workflow-state.md` CONSTRAINTS honored, individually verified against the diff:
  - C1 (DB-backed, global, both rate+concurrency): confirmed — `pipeline_run_rate_window` table +
    `pg_advisory_xact_lock`, no in-memory fallback for this guard.
  - C2 (atomic, never read-then-write): confirmed — single chained `DBIO` in ONE
    `ctx.withUserContext` call (see Phase 2 detail + independent mutation-proof re-run).
  - C3 (cleanup, no unbounded growth): confirmed — `cleanupOldWindows` piggybacked on
    `PipelineSchedulerService.tick()`, non-failing.
  - C4 (non-blocking, reachable from all 3 trigger paths): confirmed — guard lives inside
    `executeRun`, reached identically regardless of `triggerSource`; no actor-blocking work added.
  - C5 (`analyze` excluded): confirmed, both by code inspection (no rate-limit wrap on the `analyze`
    route) and a dedicated regression test.
  - C6 (V109, NO FORCE/FORCE RLS bracket where applicable): confirmed — V109 claimed, new table
    (not an ALTER of an existing RLS'd table), so the bracket pattern doesn't apply per design.md's
    own reasoning; `ENABLE`/`FORCE ROW LEVEL SECURITY` present.
  - C7 (dry runs excluded from concurrency cap only): confirmed by code (`!isDry` guards the
    concurrency-cap call; the rate-limit check runs unconditionally above it) and by a positive
    regression test, not silence.

### Phase 2: Code Review — PASS

**Gates (fresh re-run, not trusted from the executor's report):**
- `cd backend && sbt test` — re-run from scratch in `WORKTREE_PATH`: **4738/4738 passed**, 317
  suites, 0 failed/canceled. Matches the executor's claim.
- `npm run check:scala-quality` — clean (180 informational file-size soft-warnings only, none in
  new/modified guard files besides the two new test specs, which are within budget or already
  flagged as pre-existing soft-warning territory the same way most of this repo's test files are).
  No inline-FQN violations reported.
- Frontend gates not applicable — no `frontend/**` files in the diff.

**Independent mutation-proof re-verification (not just trusting the narration):** re-ran mutation
#1 from `files-modified.md` myself — changed `count < maxConcurrent` to `count <= maxConcurrent` in
`PipelineRunRepository.insertRunIfUnderConcurrencyCap`, ran
`sbt "testOnly ...PipelineRunRepositorySpec -- -z \"never exceed the concurrency cap\""`:
**RED, `4 was not equal to 3`** — exactly the failure narrated. Reverted the file (confirmed via
`git status --porcelain` showing no diff afterward) and re-ran the same test: **GREEN**. This
confirms the mutation-proof evidence is real, not narrated-only.

**Specific verification checklist from the assignment:**
1. **Concurrency cap is ONE chained DBIO in ONE `withUserContext` call** — confirmed by reading
   `PipelineRunRepository.scala:96-158`: `concurrencyLockAction` → `pipelineOwnedAction` →
   `nonTerminalCountAction.flatMap(...)` are composed via `for {} yield` into a single `DBIO`,
   passed to exactly one `ctx.withUserContext(user.id.value)(action)` call. No separate repository
   calls. This is also what my independent mutation re-run (above) exercised the race-serialization
   of — a genuine, not merely inspected, confirmation.
2. **Dry runs excluded from concurrency cap, subject to rate limit, both halves tested** —
   confirmed in `PipelineRunService.scala`: the rate-limit check runs unconditionally before
   `preExec`; the concurrency-cap call is gated on `!isDry`. Both halves have real, not merely
   inferential, tests: `PipelineRunGuardIntegrationSpec`'s "dry runs ARE subject to the rate limit,
   identically to real runs" (rate-limit half) and "dry runs are NOT subject to the concurrency cap
   even when the owner is already at the real-run cap (C7)" (exclusion half, filling the cap with 5
   concurrent real submissions racing the same advisory lock, then asserting the dry run still
   succeeds) — a positive assertion of the exclusion, not silence, as C7 requires.
3. **`analyze` unaffected by the tighter limiter** — confirmed by code (no rate-limit wrap on the
   `analyze` route in `PipelineRoutes.scala`; `SourcePreviewRoutes`/`DataSourcePreviewRoutes`'s
   rate-limit directive is applied *inside* their own `pathPrefix`, not externally, so it can never
   catch a request `analyze` matches) and by `ApiRoutesPipelineRunGuardSpec`'s dedicated regression
   test asserting zero 429s across 3 `analyze` calls under a limit low enough (1) to have 429'd on
   the 2nd call had the original (now-fixed) external-wrap bug still been present.
4. **429 carries `Retry-After` for both new guard rejections** — for the pipeline-run guard
   (rate + concurrency), `ServiceResponse.completeError`'s new `TooManyRequests` case attaches
   `respondWithHeader(\`Retry-After\`(retryAfterSeconds))` before completing; `retryAfterSeconds > 0`
   is asserted at the service layer in every `PipelineRunGuardIntegrationSpec` rejection test. For
   source-fetch/preview, `ApiRoutesPipelineRunGuardSpec` asserts the header directly at the HTTP
   layer (`header("Retry-After") should not be empty`) alongside `StatusCodes.TooManyRequests`.
   **Minor gap (non-blocking, see suggestions):** there is no HTTP-route-level test hitting
   `PipelineRunSubmitRoutes` itself and asserting the `Retry-After` header on a real 429 response —
   coverage for the pipeline-run guard's header stops at the service layer (`retryAfterSeconds`
   value) plus direct code inspection of `ServiceResponse.completeError`, not an end-to-end route
   assertion. The code path is correct (mechanically verified) and shares implementation with the
   already-route-tested source-fetch case, so this is a coverage suggestion, not a defect.
5. **New env vars documented in CLAUDE.md's prod table** — confirmed: all five new vars
   (`PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`, `PIPELINE_RUN_RATE_WINDOW_SECONDS`,
   `PIPELINE_RUN_MAX_CONCURRENT`, `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS`,
   `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`) are present with Required/Description columns citing
   HEL-505, matching the existing table's shape.

**Other code-quality notes:**
- DRY: `insertRunRowAction` extracted once and shared between `insertRunInternal` (pre-existing) and
  the new `insertRunIfUnderConcurrencyCap`, rather than duplicated. `pipelineOwnedAction` (pre-
  existing) reused for the new method's ACL check.
- `ConcurrencyCapResult` (sealed trait: `Inserted`/`CapExceeded`/`NotOwned`) is a deliberate,
  well-justified type-safety improvement over a bare `Boolean` — it's exactly what prevented (and
  documents) the non-owner regression.
- RLS: `pipeline_run_rate_window` (V109) follows V88's `assistant_daily_usage` precedent exactly —
  single unqualified `USING` policy (defaults to `ALL` commands in Postgres, matching V88's own
  established pattern), `ENABLE`/`FORCE ROW LEVEL SECURITY`, added to `RlsPolicyGuardSpec`'s
  allowlist. `PipelineRunGuardRepositorySpec` includes genuine dual-pool (non-BYPASSRLS app role)
  RLS tests — cross-user read/write both proven blocked, not merely a superuser-pool check
  (MISTAKES.md's documented hazard).
- Error handling: `TooManyRequests` is mapped consistently through the existing `ServiceResponse`
  machinery; no silent failures found.
- No dead code / no leftover TODOs found in the new/modified files.
- No over-engineering: the LLM guard hook is genuinely doc-only, no unused env var or dead code path
  introduced for HEL-390's not-yet-built route, per Decision 7 and Non-Goals.
- Minor, non-blocking: `PipelineRunGuardRepository.scala` inlines `java.sql.Timestamp.from(...)`
  rather than importing `java.sql.Timestamp` — a literal reading of CONTRIBUTING.md's "never inline
  a fully-qualified name" prose rule, though `check:scala-quality`'s actual mechanical checker (the
  standard's own enforcement mechanism) does not flag this pattern and ran clean. Not a blocking
  finding since the canonical mechanical gate is the authority here and passed.

### Phase 3: UI Review — PASS

Triggered by `ApiRoutes.scala` being in the diff. This is fundamentally a backend-only guard/rate-
limit change with no new frontend code and no changed response shape for any success path — the
only user-observable delta is a much tighter 429 threshold under sustained heavy submission, which
isn't exercised by a normal single-flow interaction and is already extensively covered by the
backend's own integration tests (Phase 2). Ran a proportionate live-server check:

- Started servers via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` — both
  healthy.
- Loaded `/`, `/sources`, `/pipelines` in the actual running app (Playwright).
- Zero console errors on any page.
- Network requests (`/api/auth/me`, `/api/pipelines`, `/api/dashboards`) all returned `200 OK` —
  no unexpected 429s or regressions from the new `ApiRoutes.scala` wiring (second `RateLimitDirective`
  instance, new constructor params) under normal single-request usage.
- No breakpoint/accessibility findings applicable — no UI markup changed.

### Overall: PASS

### Non-blocking Suggestions

1. Add an HTTP-route-level test (e.g. in a `PipelineRunSubmitRoutes`-facing spec) asserting the
   `Retry-After` header is actually present on a real 429 HTTP response for the pipeline-run guard's
   rejection (both the rate-limit and concurrency-cap cases) — today this is proven correct by code
   inspection plus a service-layer `retryAfterSeconds > 0` assertion, but not by an end-to-end route
   assertion the way the source-fetch case already has in `ApiRoutesPipelineRunGuardSpec`.
2. Consider importing `java.sql.Timestamp` at the top of `PipelineRunGuardRepository.scala` instead
   of the two inline `java.sql.Timestamp.from(...)` usages, for literal consistency with
   CONTRIBUTING.md's "Imports & Qualifiers" prose (the mechanical `check:scala-quality` gate does not
   flag this pattern, so this is stylistic only).
