## Why

Pipeline runs (Spark jobs), source fetches, and future LLM calls cost far more than an ordinary
API call. HEL-505 was pulled forward from v0.12 into v0.8 because it now blocks HEL-1097: an
upcoming auto-run trigger (HEL-1093, fired from a dataset write) must be subject to the same
per-user budget as a manual run, and cannot bypass it.

## What Changes

- Add a DB-backed, globally-consistent (not per-instance-approximate) concurrency cap and rate
  limit on pipeline-run submission, enforced inside `PipelineRunService.submit` — the single
  choke point already shared by all three existing trigger paths (`PipelineRunSubmitRoutes`
  manual HTTP submit, `HookTriggerService` external/future-auto-run trigger,
  `PipelineSchedulerService` cron trigger) — so no trigger path, present or future, can bypass
  either guard **for a real (non-dry) run**. See the dry-run deviation below.
- Exceeding either cap returns `429` with `Retry-After`; the route handler / trigger service never
  reaches Spark execution for a rejected submission.
- **Deviation from the design's original claim, found and required by design-gate review**
  (design.md Decision 3, C7): dry-run submissions (`isDry = true`) are excluded from the
  **concurrency cap only** — they remain fully subject to the rate limit above, identically to
  real runs. Making dry runs visible to the concurrency cap would require restructuring the
  dry-run persistence path's established single-statement, insert-on-success invariants
  (HEL-509/HEL-873), judged out of this ticket's scope. A user could in principle run many
  concurrent dry runs, bounded only by the rate limit's submission-count cap, not by
  `PIPELINE_RUN_MAX_CONCURRENT`.
- Wrap source-fetch/preview routes (`SourcePreviewRoutes`, `DataSourcePreviewRoutes`) with a
  tighter per-user rate limit, reusing the existing HEL-495 `RateLimitDirective` unmodified (its
  `rateLimit(limit)` already accepts a per-call override).
- **Deviation from the ticket's literal AC** (owner-approved 2026-09-23): pipeline `analyze` does
  **not** get a tighter limit. HEL-1092 established that `analyze` walks the pipeline DAG
  symbolically without reading rows, so it stays on the default HEL-495 per-request limit.
- Document (not implement) the LLM guard hook: a short doc note plus reuse of the same
  `RateLimitDirective` pattern is the integration point a future HEL-390 chat/assistant route
  wraps itself with, upstream of `ClaudeConfig`'s own token/spend budgets. No new spend logic.
  HEL-1108's `assistant_daily_usage` already covers pipeline AI-step spend; this hook is only for
  the not-yet-built server-side chat route.
- New env vars, config-driven with conservative defaults, documented in `CLAUDE.md`'s prod table.

## Capabilities

### New Capabilities

- `pipeline-run-guard`: DB-backed per-owner concurrency cap and rate limit on pipeline-run
  submission, enforced uniformly across every trigger path via `PipelineRunService.submit`. The
  rate limit covers every submission (dry and real) identically; the concurrency cap covers real
  (non-dry) submissions only — see the dry-run deviation under "What Changes" above.

### Modified Capabilities

- `rate-limiting-directive`: no requirement text changes — reused as-is on source-fetch/preview
  routes via its existing per-route-override mechanism. Not listed as a delta; see design.md for
  why this doesn't need a spec change.

## Impact

- New Flyway migration (V109) for the DB-backed guard's counter table(s), following V108's
  NO FORCE / FORCE RLS bracket pattern and V88's (`assistant_daily_usage`) atomic-upsert
  precedent.
- `com.helio.services.pipelines.PipelineRunService.submit` — new pre-execution guard check.
- `com.helio.api.routes.sources.{SourcePreviewRoutes,DataSourcePreviewRoutes}` — wrapped with a
  tighter `rateLimitDirective.rateLimit(...)`.
- `CLAUDE.md` prod env var table; `.github/workflows/cd-backend.yml` traced for whether the new
  vars need propagating (expected: no — they have safe defaults, same treatment as
  `RATE_LIMIT_REQUESTS_PER_WINDOW`).
