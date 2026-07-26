## Context

`helio-mcp/src/context.ts` `buildWorkspaceContext` is a client-side fan-out: `Promise.all([listDataSources,
listDataTypes, listDashboards, listPipelines, listPipelineShapes])`, then one `analyzePipeline` per pipeline
summary, mapped into a `WorkspaceContext` shape. This ticket ports the assembly to the backend so the
in-app authoring path (HEL-341, server-side Claude) can ground without shelling out to the MCP process.

The backend already has every piece the TS version fans out to, each already owner-scoped:
`DataSourceService.findAll` → `dataSourceRepo.findAll(user.id, page, tag)`, `DataTypeRepository.findAll(user.id,
...)`, `PipelineService.listSummaries(user, tag)` → `pipelineRepo.listSummaries` (`ctx.withUserContext(user.id)`,
owner-only), `DashboardService.findAll(user, page)` → `dashboardRepo.findAll(user.id, page)`. None of these
sharing-aware-read across grantees for list endpoints — they are owner-only, matching the MCP's own behavior
(it hits the same REST endpoints). `PipelineService.analyze` is sharing-aware (`findByIdShared`) but is only
ever invoked here against ids that `listSummaries` already scoped to the caller.

## Goals / Non-Goals

**Goals:**
- Server-side assembler producing the same shape as `WorkspaceContext`, minus `pipelineShapes` (see Decision 4).
- Every read owner-scoped, with a scoped-PAT explicitly denied (403), verified by test.
- A payload shape that later HEL-345 tickets can extend per-DataType/per-pipeline without reshaping.

**Non-Goals:**
- Sample rows, column stats, semantic hints, token budgeting (later HEL-345 tickets).
- Any Claude/NL call (HEL-341).
- Changing `helio-mcp`'s own `buildWorkspaceContext` (it may later call this endpoint; out of scope here).
- True cross-page aggregation for workspaces with >200 resources of a given kind (Decision 3).

## Decisions

**D1 — Composition-only service, no new repo methods.** `WorkspaceContextService` takes
`DataSourceService`, `DataTypeRepository`, `PipelineService`, `DashboardService` as constructor args and
calls only their existing public methods (mirrors `DashboardProposalService`'s composition discipline). No
new repository code, so no new RLS surface to get wrong — every read inherits the owner-scoping already
proven by those methods' own tests.

**D2 — Route wiring: unconditional, not `Option`-guarded.** Unlike `WorkspaceTeardownService` (needs a raw
`DbContext` for a cross-table transaction, so it's `Option`-guarded on `dbContext`), every dependency
`WorkspaceContextService` needs (`dashboardService`, `dataSourceService`, `dataTypeRepo`, `pipelineService`)
is already constructed unconditionally in `ApiRoutes`. `WorkspaceContextRoutes` (new `GET /context` inside
the existing `WorkspaceRoutes` `pathPrefix("workspace")`) is mounted the same way, no `Opt.fold(reject)`
needed. Existing `WorkspaceRoutes` constructor gains the new service as a second argument.

**D3 — List page size: mirror the MCP's own default (200), not the repo's max (500).** `helioApi.ts`
defaults every list call to `limit=200, offset=0` (`Page.Default`). The assembler uses `Page.Default` for
`dataSources`/`dataTypes`/`dashboards` — the honest parity target is "what the MCP fans out to today," not
a new higher cap. `counts.*` report each resource kind's true `PagedResult.total` (not the possibly-truncated
`items.length`), so a caller can detect truncation the same way the MCP already can (it doesn't handle it
either — an accepted, pre-existing limitation). Real pagination/streaming for workspaces over ~200 resources
is an open question for HEL-377 (token-budget controls), not this ticket.

**D4 — Drop `pipelineShapes` from the response; scope-check confirmed with the human.** The ticket's
"Scope"/"Acceptance criteria" sections enumerate `counts`, `dataSources`, `dataTypes`, `pipelines`,
`dashboards` — `pipelineShapes` (the smart-shape catalog) is not listed, and `PipelineShapeService` is
stateless/code-level (no per-user scoping concern), so it isn't part of the RLS/N+1 story this ticket cares
about. Omitting it keeps the payload aligned to the ticket's literal acceptance criteria; a later ticket can
add it if an authoring consumer needs it. Documented in the schema description as an intentional shape
delta from the MCP interface (D4 note), not an oversight.

**D5 — N+1 `analyze` fan-out: deliberate, parallel, and bounded by workspace size — not batched.**
`PipelineService.analyze` does no Spark job and no heavy I/O: two owner/shared-scoped repo reads
(`findSummaryByIdShared`, `findByIdShared`) plus one step-repo read and an in-memory `PipelineAnalyzeService
.analyze` call. The TS version already pays "1 analyze per pipeline" over the network; running the same N
calls server-side via `Future.sequence` (all in parallel against the connection pool) is strictly cheaper
(no network hop per call) and reuses the exact per-pipeline authorization `analyze` already performs — so
this ticket does not need a bespoke batched-analyze repo method. Each `analyze` failure is caught
individually (`.recover`) into `steps = Vector.empty` + `stepsError = Some(message)`, matching `context.ts`'s
`try/catch` per-pipeline, so one bad pipeline never fails the whole request. Risk: on a workspace with many
pipelines this is still N connection-pool checkouts; accepted for v1 at the ticket's stated scope (workspace-
sized, "handfuls of each" — same accepted-cost language as `context.ts`'s own header comment). A true
batch-analyze repo method is deferred until a ticket has evidence this is a real bottleneck.

**D6 — Scoped-PAT denial is inherited from `AuthDirectives.confineScopedToken`, not re-implemented.**
That directive already 403s any scoped-token request whose first unmatched path segment isn't exactly
`"hooks"` — `/api/workspace/context`'s first segment is `"workspace"`, so a scoped PAT is rejected before
`WorkspaceRoutes` ever sees the request. No new code is needed in the route or service layer; a dedicated
ScalaTest (mirroring the existing `confineScopedToken` test pattern for another non-`hooks` route) asserts
this explicitly per the ticket's design-gate ask, so the behavior is pinned rather than assumed.

**D7 — `pipelineOutput` classification reuses the existing spray-json-omits-`None` normalization pattern.**
`t.sourceId` is `Option[DataSourceId]`; spray-json omits the field entirely when `None` (the same gotcha
`context.ts` documents inline). The Scala side never serializes/deserializes through that lossy path — it
reads the domain `DataType.sourceId: Option[DataSourceId]` directly and sets `pipelineOutput = sourceId.isEmpty`
before building the response DTO, so there is no round-trip to normalize.

## Risks / Trade-offs

- [Risk] Workspace with >200 dashboards/sources/types silently truncates `items` (but not `counts`).
  → Mitigation: D3's explicit parity choice + `counts` always reports the true total, so truncation is
  detectable; flagged as an open question for HEL-377 rather than solved here.
- [Risk] N pipelines → N parallel `analyze` calls could spike connection-pool usage on a large workspace.
  → Mitigation: `analyze` is DB-cheap (no Spark); accepted at ticket-stated scope per D5; revisit if a
  future ticket has evidence of contention.
- [Risk] Response schema omits `pipelineShapes` present in the MCP interface — a consumer expecting full
  parity could be surprised. → Mitigation: documented explicitly in the schema description (D4) and here.

## Migration Plan

Purely additive: new service, new route, new schema, new protocol/formatters. No migration, no existing
wire-shape change. Deploys as part of the normal backend release.

## Open Questions

- Should `GET /api/workspace/context` eventually accept pagination/limit params once HEL-377 lands? Left to
  that ticket — this one intentionally mirrors the MCP's current unparameterized call shape.

## Planner Notes

- Self-approved: omitting `pipelineShapes` (D4) — the ticket's own scope/acceptance-criteria text doesn't
  list it, and it carries no RLS/N+1 story, so it's excluded rather than speculatively added. Flagged clearly
  in case the design gate disagrees.
- Self-approved: reusing `Page.Default` (200) rather than `Page.MaxLimit` (500) for parity with the MCP's
  literal current behavior (D3).
