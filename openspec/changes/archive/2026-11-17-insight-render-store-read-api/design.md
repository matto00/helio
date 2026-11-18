## Context

Ground truth on main fd7090bf6 (re-verify before relying on any line number):
- V115 (`output_snapshot_history`) is the pattern: UUID pk, `output_id` FK `ON DELETE CASCADE`, `pipeline_id` and
  `run_id` TEXT with no FK (runs are pruned to 10; grantee runs have no row), ENABLE + FORCE RLS, four policies on
  `helio_can_access_pipeline(pipeline_id)`, explicit `GRANT ... TO helio_privileged`.
- `OutputHistoryRepository` reads via `ctx.withSystemContext` after an explicit service-level ACL; the RLS policy is
  defense in depth. `OutputHistoryService.read` + `OutputRoutes` `path("history")` give the "non-grantee = unknown id
  404" shape (HEL-1273). `OutputHistoryQueryParsing` parses `limit` (1..100, default 30, never clamped) and `since`.
- Public: authorization is `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard
  not found", token)` wrapped around each panel route with `?token=` (`history` route, PublicDashboardRoutes ~152-171);
  `PublicPanelOutputResolver.resolvePanelOutput` then resolves panel -> Output with `accessAlreadyGranted = true`
  (every failure 404);
  `PublicPanelHistoryResolver` + `OutputHistoryResponses.public` is the allow-list projection precedent.
- `OutputHistoryRetentionService` runs on the scheduler tick with in-process gating, a history part and a payload part
  (`NodePayloadHistoryRepository.purge`, `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)`, tier joined via
  `pipelines.owner_id -> users.tier`). `OutputHistoryRetentionConfig.maxAgeByTier` holds 30/90/365 days by default.
- L3: `domain/insights/InsightPack.Citation(id, outputId, field, number: Option[Double], date: Option[Instant],
  capturedAt: Option[Instant], isPct)`; `InsightValidator.citationsUsed(text, pack)` returns the ids a render used;
  `InsightUsage` has input/output/cacheCreation/cacheRead counts; `InsightModelClient` is the model seam (unwired).
- `OutputService` holds `PipelineRunService`, which holds a live `AiStepClient` in production (ApiRoutes ~471-525),
  so depending on `OutputService` would put a model client one hop from the read path.
- Migrations on main end at V141; driver ledger: V145 this ticket, V143 HEL-1734, V144 HEL-1739.

## Goals / Non-Goals

Goals: table + RLS, repository, read-only service, three GET routes, schemas, retention, docs. Non-goals: any write
caller (L4), any model call, any frontend (L5).

## Decisions

**D1 Table (V145 `output_insights`).** `id UUID pk default gen_random_uuid()`, `output_id TEXT NOT NULL REFERENCES
outputs(id) ON DELETE CASCADE`, `pipeline_id TEXT NOT NULL` (no FK, V115 reason), `run_id TEXT NULL` (no FK),
`trigger TEXT NOT NULL CHECK IN (on_run, daily, manual, pin)`, `status TEXT NOT NULL CHECK IN (ok, failed,
skipped_quota, skipped_unchanged, skipped_budget)`, `markdown TEXT NULL`, `citations JSONB NOT NULL DEFAULT '[]'`,
`input_digest TEXT NULL`, `model TEXT NULL`, `input_tokens`, `output_tokens`, `cache_creation_tokens`,
`cache_read_tokens` (INT NULL, `>= 0`), `cost_micros BIGINT NULL (>= 0)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT
now()`. CHECK `status <> 'ok' OR markdown IS NOT NULL`. Indexes: `(output_id, created_at DESC)` and partial
`(output_id, created_at DESC) WHERE status = 'ok'`.
Stored `citations` element (domain `StoredInsightCitation` + its JsonFormat, owned here; L4 writes through it):
`{id: string, outputId: string, field: string, number?: number, date?: ISO-8601 string, capturedAt?: ISO-8601
string, isPct: boolean}`, built from L3 `Citation` by `StoredInsightCitation.from`. An ok row stores only the
citations `InsightValidator.citationsUsed` returned; a non-ok row stores `[]`. RLS exactly as V115 (ENABLE + FORCE, four policies, grant to
`helio_privileged`). Header comment explains each choice; the file is never edited once applied.

**D2 Repository (`infrastructure/persistence/pipelines/OutputInsightRepository.scala`).** `insertAction(row): DBIO`
(the L4 seam; used by tests now), `latestOk(outputId)`, `latestAttempt(outputId)`, `listRecent(outputId, limit,
since)`, `purge(now, maxAgeByTier)`. Reads use `withSystemContext` after the service ACL (house pattern). Ties on
`created_at` break on `id DESC` so "latest" is deterministic.

**D3 Read service (`services/insights/OutputInsightReadService.scala`).** Constructor parameters are exactly
`OutputRepository`, `OutputInsightRepository` and the implicit `ExecutionContext` (never `OutputService`, see
Context). Authenticated entries `read(id, user)` / `history(id, user, limit, since)` authorize with
`outputRepo.findById(id, user)` exactly as `OutputHistoryService.read` does. The public entry
`latestOkFor(output: Output): Future[Option[Option[OutputInsightRecord]]]` has NO ACL (documented "caller has authorized",
like `OutputHistoryService.forOutput`); the outer `None` is a non-insight kind (404), `Some(None)` an insight Output with no ok row (200 `{render: null}`). Nested Option kept over an ADT: one internal caller. Both `OutputRepository` and
`OutputInsightRepository` are DB-only (a `DbContext`; `OutputRepository` also `PipelineDefinitionLocks`). It never writes and never renders. Guard: a spec reflects over
the constructor's parameter types and asserts they EQUAL that allow-list (any added collaborator is red); red
mutation recorded = adding an `OutputService` parameter. The repository's read methods issue SELECT only.

**D4 ACL and kinds.** Authenticated routes authorize through `outputRepo.findById(id, user)` (owner or any grantee); a
stranger and an unknown id get the identical 404 body. An accessible Output whose kind is not `insight` also gets
that same 404 (it has no insight; rows left by a kind change are hidden, not deleted).

**D5 Authenticated responses.** `GET /api/outputs/:id/insight` -> `{outputId, render, lastAttempt}`: `render` is the
newest `ok` row as `{id, markdown, citations, trigger, runId?, inputDigest?, model?, inputTokens?, outputTokens?,
cacheCreationTokens?, cacheReadTokens?, costMicros?, createdAt}` or null when none (`?` keys omitted when unset); `lastAttempt` is the newest
row of any status as `{id, status, trigger, createdAt}` or null. Both fields are always present (explicit `null`,
not spray's omitted None; MISTAKES "spray-json omits None"). `GET .../insight/history?limit=&since=` ->
`{outputId, items: [...]}`, newest first, every status, each item the full record (markdown present only for ok).
The service reaches `OutputRoutes` as `insightReadService: Option[OutputInsightReadService] = None` (mirrors
`historyService`); because a missed wiring would silently reject, the 2.1 route specs build routes through
`ApiRoutes`' production wiring, not a hand-built `OutputRoutes`. `limit`/`since` reuse `OutputHistoryQueryParsing` (400 out of range, never clamped); `since` is applied in SQL
(`created_at >= since`) before `limit`, and the history spec pins that.

**D6 Public response.** `GET /api/dashboards/:d/panels/:p/insight` (in `PublicDashboardRoutes`, via a new
`PublicPanelInsightResolver` that calls `resolvePanelOutput`; every failure 404, non-insight kind 404) ->
`{render: {markdown, citations: [{id, field, number?, date?, capturedAt?, isPct}], renderedAt} | null}` (same JSON
types as the stored element; `outputId` dropped). The route accepts `?token=` and is wrapped in `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId,
userOpt, "Dashboard not found", token)` exactly as the `history` route is, BEFORE the resolver runs; so an anonymous
caller or signed-in stranger on a private dashboard gets the unknown-dashboard 404, a valid share token passes, and a
panel id from another dashboard is 404 from `resolvePanelOutput`. The resolver then calls `resolvePanelOutput`, then
`latestOkFor(output)`; `None` (non-insight kind) is 404, an insight Output with no ok row is 200 `{render: null}`.
The service reaches `PublicDashboardRoutes` as `insightReadServiceOpt: Option[OutputInsightReadService] = None`
next to `historyServiceOpt` (ApiRoutes ~880); absent = 404, like the history resolver. Built by an explicit
allow-list projection (never by copying and deleting keys). Excluded: cost, model, all token counts, run id, input
digest, trigger, row ids, last-attempt status (a `skipped_quota` would disclose the owner's usage) and each
citation's `outputId` (may name an Output not on that dashboard). The schema sets `additionalProperties: false` at
every level; a schema test asserts the forbidden names are absent from the schema and from a live response built
from a row that has every field populated.

**D7 Retention.** A third part of `OutputHistoryRetentionService.runPass`, after the payload part, folded into the
same failed/next-due precedence (it can be Ran or Failed, never Busy). `OutputInsightRepository.purge` runs in
`withSystemContext` WITHOUT the retention advisory lock: it does not conflict with the run-path payload trim, the
delete is idempotent and cross-instance overlap is harmless, so the lock would only add spurious lockRetry outcomes.
It is one DELETE, not HEL-1435-style batches: at most one on_run render per Output per hour (epic ruling D4) plus daily/manual
keeps volumes small. It deletes rows with `created_at < now - maxAge(pipeline owner's tier)` (ages from
`OutputHistoryRetentionConfig.maxAgeByTier`, no new env vars; a tier absent from the map gets the strictest age),
EXCEPT each Output's newest `ok` row and its newest row of any status, so a read never loses its last good render.
The new constructor parameter has no default, so `Main` cannot compile without wiring it (HEL-1276 precedent).

**D8 Migration number.** V145 per the driver ledger. Before merge: if origin/main's highest migration is >= 142,
renumber to max+1, update every reference, re-run gates (Flyway has no outOfOrder).

**D9 Live RLS check.** Automated: `OutputInsightRlsSpec` follows `OutputHistoryRlsSpec` exactly and runs as
`helio_app_test` (NOSUPERUSER, not BYPASSRLS, created by the spec): owner and grantee see their pipeline's rows, a
stranger sees zero and cannot insert. Manual (local only, never prod): no `helio_app` role exists on the local
cluster (verified at Planning: only `helio_privileged` and a superuser). So in ONE psql transaction on the local dev
DB: `CREATE ROLE helio_app NOLOGIN NOSUPERUSER NOBYPASSRLS`, grant it what `helio_app_test` gets, insert fixture
rows as the superuser, record `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='helio_app'`
(both `f`), `SET LOCAL ROLE helio_app`, set the user context as the app does, select as owner/grantee/stranger, try
a stranger insert, then `ROLLBACK` (role and rows vanish: no residue). Transcript in `rls-live-check.md`.

**D10 DB.** Shared dev DB first, after confirming its applied max is below 142 and V145 applies cleanly. Otherwise a
lane-private DB (`createdb helio_hel1742`, `DATABASE_URL` override on `start-servers.sh`), dropped at Delivery.

## Risks / Trade-offs

- Rows left on an Output whose kind changed away from `insight` persist until retention; acceptable (cascade on
  delete still holds, reads hide them).
- Contention: HEL-1739 may touch the scheduler tick; this change touches only `OutputHistoryRetentionService` and
  `Main` wiring. CLAUDE.md endpoint list and `PublicDashboardRoutes` may conflict textually; rebase resolves.

## Planner Notes

Self-approved: retention reuses the history tier ages (no new env vars, documented in CLAUDE.md); public projection
drops last-attempt status and cited Output ids (conservative reading of "allow-listed fields only"); non-insight kinds
404. L1 follow-ups out of scope here, both frontend and owned by L5 (HEL-1744): (a) the insight panel footer and
refresh button (L5 replaces the not-yet-rendered body with the real render and owns its footer), (b) `role="status"`
on `InsightNotRenderedState` (L5 rewrites that state set). Folding either in would add a UI gate to a backend-only leaf.
No failure-reason column: the ticket's column list is explicit and the driver routes scope changes through
escalation; recommended to the driver for L4 (a nullable column is a cheap additive migration there).
