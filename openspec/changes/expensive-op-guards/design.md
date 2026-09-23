## Context

`PipelineRunService.submit` is the single choke point for all three existing pipeline-run trigger
paths: `PipelineRunSubmitRoutes` (HTTP, `TriggerSource.Manual`), `HookTriggerService.submitNewRun`
(`TriggerSource.External`), and `PipelineSchedulerService.fire` (`TriggerSource.Scheduled`). Each
already threads a real `AuthenticatedUser` through to `submit` (the scheduler constructs a
synthetic one for the pipeline owner: `AuthenticatedUser(pipeline.ownerId, source = System, ...)`).
HEL-1093's future auto-run trigger is expected to reuse `HookTriggerService`, not
`PipelineRunSubmitRoutes` — so a guard implemented only as an HTTP directive on the run-submit
route would not cover the hook, scheduler, or auto-run paths.

Cloud Run runs up to 2 instances (`cd-backend.yml`'s `--max-instances`). The existing HEL-495
`InMemoryRateLimiter` is documented and accepted as a per-instance approximation for the general
`/api` limiter. **Owner ruling (2026-09-23, overriding the orchestrator's original
split-recommendation): both the pipeline-run rate limit AND its concurrency cap must be DB-backed
and globally consistent, not per-instance-approximate** — durable, shared state, correct
regardless of which instance handles a given request.

`assistant_daily_usage` (V88, HEL-703) is the established precedent for a DB-backed per-user
counter: one row per key, RLS-protected (`ENABLE`/`FORCE ROW LEVEL SECURITY` + an owner-predicate
policy), enforced via a single atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE <count> < :limit
RETURNING` statement — race-safe without an explicit application-level lock, because Postgres
serializes an `ON CONFLICT` upsert per conflicting row.

## Goals / Non-Goals

**Goals:**
- A pipeline-run concurrency cap and rate limit that hold globally across every Cloud Run
  instance and every trigger path (manual, hook/external, scheduled, and future auto-run).
- Correct under concurrent writers: two backend instances racing to submit for the same user must
  never both succeed past a cap that only one of them should pass.
- A tighter per-user rate limit on source-fetch/preview routes, reusing HEL-495's existing
  directive unmodified.
- A documented (not implemented) LLM guard hook for HEL-390's future chat/assistant route.
- Config-driven limits with conservative defaults, documented in CLAUDE.md.

**Non-Goals:**
- Re-implementing or duplicating HEL-1108's `assistant_daily_usage` AI-spend budget (pipeline AI
  steps are already covered there).
- Actual Claude/LLM cost-accounting logic (HEL-390's own scope).
- Applying a tighter limit to pipeline `analyze` (owner-approved deviation from the ticket's
  literal AC — see Decision 5).
- IP-based keying for unauthenticated requests (HEL-837's existing, separately-tracked scope;
  unrelated to this change, which only ever guards authenticated, owner-attributed operations).
- Making the general `/api` `RateLimitDirective`/`InMemoryRateLimiter` itself DB-backed. That
  directive's documented per-instance-approximation is unchanged and out of scope here; only the
  NEW pipeline-run guard is DB-backed, per the owner's ruling being scoped to that guard.

## Decisions

### Decision 1 — Guard lives inside `PipelineRunService.submit`, not an HTTP directive

A new private helper in `PipelineRunService` (or a small collaborator class,
`PipelineRunGuardRepository`, mirroring `AssistantDailyUsageRepository`'s shape) is called at the
top of `runPipeline`/`executeRun`'s pre-execution path, before any Spark work begins, for every
value of `triggerSource`. `submit`'s existing three callers (`PipelineRunSubmitRoutes`,
`HookTriggerService`, `PipelineSchedulerService`) require no changes to call the guard — they
already reach `submit`. A future HEL-1093 auto-run trigger reusing `HookTriggerService` is
automatically covered with zero additional wiring.

On rejection, `submit` returns a new `ServiceError` case (`ServiceError.TooManyRequests(retryAfterSeconds: Long, reason: String)`)
mapped by `ServiceResponse`/route error translation to HTTP 429 with a `Retry-After` header —
mirroring `RateLimitDirective`'s existing 429 response shape (`ErrorResponse` body), so the wire
contract is consistent with the general limiter's.

### Decision 2 — Rate limit: DB-backed fixed-window counter, PK bucketed by window boundary

New table `pipeline_run_rate_window`, one row per `(user_id, window_start)`, mirroring
`assistant_daily_usage`'s `(user_id, usage_date)` shape exactly — `window_start` is the epoch
truncated to the configured window size (`to_timestamp(floor(extract(epoch from now()) /
windowSeconds) * windowSeconds)`), so each new window boundary naturally creates a fresh row via
the `ON CONFLICT` insert path rather than needing in-statement reset logic:

```sql
INSERT INTO pipeline_run_rate_window (user_id, window_start, request_count)
VALUES (:userId, :bucketedWindowStart, 1)
ON CONFLICT (user_id, window_start) DO UPDATE
  SET request_count = pipeline_run_rate_window.request_count + 1
  WHERE pipeline_run_rate_window.request_count < :limit
RETURNING request_count
```

A present `RETURNING` row means allowed; an absent one means rejected (`limit` already reached for
this window) — identical control-flow shape to `AssistantDailyUsageRepository.incrementIfUnderCap`.
`Retry-After` is computed as the window's remaining seconds (`window_start + windowSeconds - now`).

**Row growth / cleanup**: unlike `assistant_daily_usage` (one row per user per UTC day, naturally
bounded), a short window (default below) means an active user accumulates one row per window they
submit a run in. The executor MUST add a bounded cleanup (a simple periodic `DELETE FROM
pipeline_run_rate_window WHERE window_start < now() - interval '1 hour'`, either piggybacked on
the existing `PipelineSchedulerService.tick()` cadence or run opportunistically on a small
probability per write) — required, not optional, per the owner's ruling. Document whichever
mechanism is chosen and why in the PR.

**`limit < 1` short-circuit (skeptic round 1, non-blocking note — adopted):** the `ON CONFLICT ...
WHERE` guard only gates the `UPDATE` branch, not a bucket's first `INSERT` — a caller with no row
yet for the current window bucket would otherwise be allowed exactly one submission even at
`limit = 0`. Mirror `AssistantDailyUsageRepository.incrementIfUnderCap`'s own `if (limit < 1)
Future.successful(false)` short-circuit, checked in application code BEFORE issuing the SQL, so a
misconfigured `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW=0` means "always capped," not "one free
submission per window."

**Applies to BOTH dry and real run submissions identically** — unlike the concurrency cap
(Decision 3 below), this check runs unconditionally on `isDry`, at the very top of `executeRun`,
before `preExec`/`backend.execute`. It has no dependency on `pipeline_runs`' status lifecycle, so
it is unaffected by the dry-run gap described in Decision 3.

### Decision 3 — Concurrency cap: advisory lock + live count against `pipeline_runs`, no second table

**Revised after design-gate skeptic round 1 (REFUTE) — see the two resolutions below; this
supersedes the original round-1 text, which left the atomicity mechanism's exact call-site
composition unresolved (change request 1) and incorrectly claimed dry runs are covered by this
guard (change request 2).**

Rather than a second counter table (which would need its own leak-on-crash handling — a run that
terminates abnormally without reaching `updateRunTerminal` would strand a counted slot forever),
the concurrency cap is derived directly from `pipeline_runs`' own live state, inside the SAME
transaction as the new run's `INSERT`:

1. `SELECT pg_advisory_xact_lock(hashtext('pipeline-run-concurrency:' || :userId))` — a
   transaction-scoped advisory lock keyed by owner id. Serializes concurrent submits from the
   SAME owner across both Cloud Run instances (different owners use different lock keys and never
   block each other); automatically released at commit/rollback, so there is nothing to leak.
2. `SELECT count(*) FROM pipeline_runs pr JOIN pipelines p ON pr.pipeline_id = p.id WHERE
   p.owner_id = :userId AND pr.status NOT IN ('succeeded','failed','dry_run')` — every row
   `insertRunInternal` writes starts at status `'queued'` and only leaves the non-terminal set via
   `updateRunTerminal`, so this count is exactly "this owner's currently in-flight **real**
   runs" (see the dry-run resolution below for why "real" is load-bearing here).
3. If the count is `< maxConcurrent`, insert the new run row (existing `insertRunInternal` logic)
   inside the SAME transaction as steps 1–2; otherwise roll back the transaction without
   inserting and return the "concurrency exceeded" rejection.

**Resolution 1 (change request 1) — the composition that makes "same transaction" concrete, not
aspirational.** `DbContext.withUserContext[R](userId)(action: DBIO[R]): Future[R]` accepts
exactly ONE `DBIO[R]` and wraps it `.transactionally` itself (`DbContext.scala:50-51`) — it is NOT
possible for two separate calls to `withUserContext`/`withSystemContext`, made from two different
methods with async DB round-trips in between, to share one Postgres transaction. Steps 1–3 above
MUST therefore be composed as ONE chained `DBIO` (via `.flatMap`) and passed to a SINGLE
`ctx.withUserContext(user.id.value)(...)` call in a new repository method —
`PipelineRunRepository.insertRunIfUnderConcurrencyCap(runId, pipelineId, startedAt, user,
triggerSource, triggeredByTokenId, maxConcurrent): Future[Boolean]` — replacing, not
supplementing, the plain `insertRun` call `executeRun`'s `preExec` currently makes for the
non-dry path (`PipelineRunService.scala:944-950`).

This requires restructuring `executeRun`'s control flow: the guard call must happen, and be
awaited, BEFORE `backend.execute` is ever invoked — today's `preExec: Future[Unit]` becomes a
`Future[Either[ServiceError, Unit]]` (or an equivalent short-circuiting shape) where a `Left`
(guard rejected) skips `backend.execute` entirely and `executeRun` returns
`Left(ServiceError.TooManyRequests(...))` immediately. This is a change to `executeRun` itself,
not merely to `submit`/`runPipeline`'s earlier pre-flight steps
(`resolveAllRootDataSourcesInternal`/`listByPipelineInternal`) — those remain exactly where they
are today; only the previously-separate "check" and "insert" collapse into one atomic call at the
point `preExec` already runs. (The advisory lock alone would NOT be sufficient without this
collapse: two concurrent transactions each independently running "count, then decide, then insert"
as separate `withUserContext` calls can still both read the pre-insert count before either commits
under READ COMMITTED — the lock only helps if it is held across the count AND the insert as one
unit, which requires them to be one composed `DBIO`.)

Because there is no fixed "next slot free at" time (unlike the rate window), the concurrency 429's
`Retry-After` is a conservative configured constant advisory
(`PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS`, default below), not a computed value — documented
as an advisory estimate, not a guarantee.

**Resolution 2 (change request 2, C7) — dry runs are excluded from the concurrency cap, not the
rate limit.** `insertDryRun`/`insertDryRunInternal` (`PipelineRunRepository.scala:139-159`) writes
a row with status `'dry_run'` — already terminal per this guard's own `NOT IN` set — in a single
statement invoked only from `onDryRunSuccess`, itself only reached AFTER the dry run has already
executed (`PipelineRunService.scala:1033`, confirmed by the code's own comment at 1090-1093: "this
dry run's row is inserted above [after execution], unlike the real-run path"). A live in-flight
dry run therefore never occupies a non-terminal `pipeline_runs` row, so the concurrency count in
step 2 above structurally cannot see it, no matter how expensive the dry run's own Spark/engine
work is.

Making dry runs visible to this guard would require restructuring the dry-run persistence path to
insert a non-terminal placeholder BEFORE execution and upgrade it to terminal on completion —
mirroring the real-run `preExec` pattern — which changes the deliberately single-statement,
insert-on-success design `HEL-509`/`HEL-873`'s own doc comments establish as intentional (e.g. the
FK-ordering comment at line 1089-1094: "insertAssertions must be sequenced AFTER insertDryRun's
own row insert"). That is a materially larger, higher-risk change than this ticket's own scope
(a rate/concurrency front-end, not a dry-run-architecture rewrite) justifies, given the ticket's
Medium priority and CLAUDE.md's "keep changes focused... avoid unrelated refactors unless
requested."

**Decision: dry runs are excluded from the concurrency cap only.** They remain fully subject to
the rate limit (Decision 2 above, unaffected by this gap — it doesn't read `pipeline_runs` at
all). This is a deliberate, documented scope narrowing from the original "just as
compute-expensive, so they consume the same budget" framing — see Risks/Trade-offs, and the
standing constraint C7 in `workflow-state.md`. If unlimited concurrent dry runs prove to be a real
problem in practice, that is a follow-up ticket (a genuine architecture change to the dry-run
persistence path), not a silent scope-add here.

(Distinct from `previewStep`/`previewOutputs`, which never call `insertRun`/`insertDryRun` at all
and are therefore already outside both guards' reach, unaffected by this change either way.)

### Decision 4 — RLS: new table follows the `assistant_daily_usage` (V88) precedent, not V108's DDL-only bracket

`pipeline_run_rate_window` holds per-user counters, exactly analogous to `assistant_daily_usage` —
gets full `ENABLE`/`FORCE ROW LEVEL SECURITY` plus an owner-predicate policy
(`user_id = current_setting('app.current_user_id')::uuid`), added to `RlsPolicyGuardSpec`'s
`rlsTables` allowlist (CONTRIBUTING.md's "Adding a new ACL'd table" checklist, all 4 steps). All
access goes through `DbContext.withUserContext(user.id.value)` — every one of the three trigger
paths already has a real `user.id` in scope at the `submit` call site (including the scheduler's
synthetic owner-`AuthenticatedUser`), so there is no pre-identity gap here (unlike `users` itself,
per V88's own comment). The concurrency check's `pg_advisory_xact_lock` + `pipeline_runs`
count/insert also runs inside `withUserContext` for the same reason — no new privileged/system-
context bypass is introduced. **If** the migration instead needs `NO FORCE`/`FORCE` bracketing
around an ALTER of an EXISTING RLS'd table (it should not, per the "new table" design above), it
must follow V108's exact bracket pattern; this is noted defensively, not because a specific
alteration is currently planned.

### Decision 5 — `analyze` excluded from the tighter limit (owner-approved deviation from the ticket's literal AC)

The ticket's AC states "Source-fetch/preview and analyze routes enforce their tighter per-user
rate." HEL-1092 established `analyze_pipeline` walks the DAG symbolically without reading rows —
it is not actually expensive. The owner ruled (2026-09-23) to exclude it rather than apply the
letter of the AC: `analyze` stays on the existing default `RateLimitDirective` limit, unchanged.
**This must be stated explicitly in the PR body** so no downstream gate/reviewer reads this as a
missed AC.

### Decision 6 — Source-fetch/preview tighter rate: unchanged mechanism, just a tighter number

`SourcePreviewRoutes`/`DataSourcePreviewRoutes` wrap their route with
`rateLimitDirective.rateLimit(SOURCE_FETCH_RATE_LIMIT_PER_WINDOW)` — the SAME in-memory,
per-instance-approximate `RateLimitDirective` every other route already uses (per Non-Goals: this
guard's DB-backed treatment applies only to the pipeline-run guard, not to this one). This is
deliberately the cheapest possible change for this AC item — no new infrastructure.

### Decision 7 — LLM guard hook: documented integration point, no new runtime code path

Since no server-side-Claude-backed HTTP route exists yet (per CLAUDE.md's `ANTHROPIC_API_KEY` row:
"no route consumes this yet"), there is nothing to wire a guard onto. The "hook" is a short,
clearly-labeled doc note (in `ClaudeClient.scala`'s scaladoc, and a corresponding CLAUDE.md
mention) stating: when a route dispatches `ClaudeClient` for a user-facing chat/assistant call, it
MUST wrap itself with `rateLimitDirective.rateLimit(<a tighter limit>)` — the identical pattern as
Decision 6 — **upstream of** `ClaudeConfig`'s own token/spend budgets, never duplicating them. No
new env var is introduced with no consumer.

### Decision 8 — Config

New env vars (conservative defaults; both new — no existing var is repurposed):

| Var | Default | Purpose |
| --- | --- | --- |
| `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` | 10 | Max pipeline-run submissions (dry or real) per user per window |
| `PIPELINE_RUN_RATE_WINDOW_SECONDS` | 60 | Window duration for the above |
| `PIPELINE_RUN_MAX_CONCURRENT` | 3 | Max in-flight (non-terminal) pipeline runs per user, across all their pipelines |
| `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS` | 15 | Advisory `Retry-After` for a concurrency-exceeded 429 (not a computed value — see Decision 3) |
| `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` | 30 | Tighter per-user limit for source-fetch/preview routes (reuses `RATE_LIMIT_WINDOW_SECONDS` as its window) |

All read via a `fromEnv()`-once-inject-explicitly config case class, matching `RateLimitConfig`'s
own convention. None of these need propagating through `cd-backend.yml` — confirmed no
`RATE_LIMIT_*` var is set there today either; defaults apply in prod exactly as they do for the
existing limiter, same documented treatment.

## Risks / Trade-offs

- **New DB round-trip on every pipeline-run submission** (advisory lock + count + insert, plus a
  separate rate-window upsert) — accepted per the owner's explicit correctness-over-latency
  ruling; pipeline-run submission is not a hot, latency-sensitive path the way every `/api` GET is.
- **`pipeline_run_rate_window` row growth** requires the cleanup mechanism in Decision 2 — flagged
  as a required (not optional) task; the executor must actually implement and evidence it, not
  merely note it.
- **Advisory lock scope is per-owner, not per-pipeline** — a user submitting runs for two
  different pipelines simultaneously will serialize through the same lock briefly; acceptable,
  since the check itself is a fast count query, not the run execution.
- **Dry runs are excluded from the concurrency cap, but still count against the rate limit**
  (Decision 3, C7) — a deliberate, owner-flaggable scope narrowing from this design's original
  claim, made to avoid restructuring the dry-run persistence path's established single-statement
  invariants (HEL-509/HEL-873). A user could in principle run many concurrent dry runs regardless
  of `PIPELINE_RUN_MAX_CONCURRENT`, bounded only by the rate limit's submission-count cap. If this
  proves to be a real problem, closing it is a follow-up ticket, not a silent scope-add here.
