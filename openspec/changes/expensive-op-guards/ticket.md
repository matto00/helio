# HEL-505: Expensive-op guards for pipeline runs, source fetches, and LLM calls

## Description

Some operations cost far more than a normal API call: pipeline runs (Spark jobs), external data-source fetches (REST/SQL/CSV pulls via `SourceRoutes`/`DataSourceRoutes` + preview routes), and — once HEL-390 lands — server-side Claude/LLM calls. A plain per-request limit is too coarse for these; they need their own tighter, concurrency-aware guards so a single user/agent can't exhaust compute or run up API spend.

## Scope (as written)

* Apply tighter, dedicated limits to the expensive endpoints: pipeline run submission (`PipelineRunSubmitRoutes`), pipeline analyze, source preview/fetch routes, and (when present) the LLM integration layer from HEL-390.
* Enforce both a rate (per user/PAT over a window) and a max in-flight concurrency per user (e.g. only K concurrent pipeline runs), returning `429` with `Retry-After` when exceeded, reusing the core limiter directive/trait.
* For LLM calls specifically, coordinate the guard hook with HEL-390's cost guardrails so this rate/concurrency layer sits in front of the model-config/spend controls rather than duplicating them.
* Make limits config-driven (env vars in CLAUDE.md table) with conservative defaults.

## Acceptance criteria

* Submitting more than the allowed concurrent pipeline runs returns `429`; completing a run frees a slot (integration test against the run registry).
* Source-fetch/preview and analyze routes enforce their tighter per-user rate; normal usage is unaffected.
* The LLM guard hook is present and documented as the integration point for HEL-390 (no duplicate spend logic).
* `sbt compile test` green.

## Out of scope

* The actual Claude/LLM cost-accounting logic (owned by HEL-390).
* The core per-request limiter (separate ticket, reused here).

## Dependencies

Builds on the core rate-limiting directive ticket (HEL-495). Relates to HEL-390 (server-side Claude integration + cost guardrails) — the expensive-op guard is the rate/concurrency front-end to that work.

## Why this ticket is being worked now (owner ruling 2026-09-23)

HEL-505 was moved from v0.12 into v0.8 and now blocks HEL-1097 ("Expensive-op guard interaction with auto-run") in epic HEL-1091 (write→run→refresh). HEL-1097's AC: "an auto-run is subject to the same guards as a manual one and cannot be used to bypass them; a burst of writes cannot exceed the per-principal run budget." The owner chose to build HEL-505 as written, not to rescope HEL-1097. See comments on HEL-505 and HEL-1097.

## Design constraint from the next tickets (verify, do not assume)

HEL-1093 will add an auto-run trigger fired from a dataset WRITE, reusing the `HookTriggerService` path, NOT `PipelineRunSubmitRoutes`. A guard implemented only as an HTTP directive on the run-submit route would therefore be bypassable by auto-run, which is exactly what HEL-1097 forbids. The guard must be designed so a non-HTTP trigger path can call the same check. Every existing run-trigger path must be enumerated and the guard's coverage of each stated explicitly.

## Premise-validation findings (see `.concertino/runs/HEL-505/evidence/premise-validation.md`)

* `PipelineRunService.submit` is the SINGLE choke point already used by all three existing trigger paths: `PipelineRunSubmitRoutes` (HTTP, `TriggerSource.Manual`), `HookTriggerService.submitNewRun` (`TriggerSource.External`), and `PipelineSchedulerService.fire` (`TriggerSource.Scheduled`). The guard belongs inside/around `submit`, not as an HTTP-only directive, or it will not cover hook/scheduler paths today and will very likely not cover HEL-1093's future auto-run path either.
* HEL-495's `RateLimitDirective` (HTTP-shaped) is directly reusable, unmodified, for the "tighter per-user rate" requirement on source-fetch/preview/analyze routes (already accepts a per-call limit override). Its underlying `RateLimiter`/`InMemoryRateLimiter` trait is what a service-layer (non-HTTP) guard on `submit` should reuse instead.
* No existing mechanism caps a single user's TOTAL concurrent pipeline runs across multiple pipelines — `hasActiveRunInternal`'s overlap guard is per-pipeline only. This is genuine new scope.
* HEL-1108 already ships a combined daily AI-spend budget (`assistant_daily_usage`, tier-gated, keyed by `ownerUserId` already threaded through `PipelineExecutionBackend.execute`). This satisfies most of the substance behind the "LLM guard hook" AC; what's still missing is a documented integration point / explicit hook for HEL-390's future server-side Claude calls specifically (chat/assistant path, not pipeline AI steps), without duplicating HEL-1108's spend logic.
* Real design fork (escalate, do not decide unilaterally): per-instance in-memory concurrency/rate tracking (matches HEL-495's existing `InMemoryRateLimiter` precedent, cheap, but only approximate across 2 Cloud Run instances) vs. a DB-backed/global counter (e.g. querying `pipeline_runs` for a user's active-run count across pipelines — no new migration needed since ownership is already derivable — genuinely global, but adds a DB round-trip to every run submission and every completion).
* Real design fork (escalate): should pipeline `analyze` get the same "tighter" rate limit as source-fetch/preview, given HEL-1092 already found `analyze_pipeline` cheap? Or should the ticket's "tighter" treatment apply only to genuinely expensive ops (pipeline run, source fetch, future LLM calls)?

## Standing constraints for this delivery

* Models: SONNET on all agents (owner ruling 2026-09-18) — already resolved into `workflow-state.md`.
* Migration ledger: highest on main is V108; V109 is free and reserved if needed. Any RLS-touching migration must follow the NO FORCE / FORCE RLS pattern V108 uses.
* New env vars go in the CLAUDE.md production table; trace whether `.github/workflows/cd-backend.yml` needs them (the manual deploy script is not what CD runs).
* Parallel lane HEL-1125 (frontend CSS checkbox fix) is running concurrently — no overlap expected.
* A guard proof must go red first: mutation-prove it, and assert the 429 plus `Retry-After` header, not just "a limiter exists".
* Standalone follow-ups: file with `origin_kind: followup` / `origin_ticket: HEL-505`, relatedTo the origin, and the `Follow-up` label.
