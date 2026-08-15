## Context

`WorkspaceContextService` (`backend/src/main/scala/com/helio/services/`) composes
`DashboardService`/`DataSourceService`/`DataTypeService`/`PipelineService` — no direct DB access of
its own — and eagerly assembles a full workspace snapshot via `assemble`. Its per-entry converters
(`toDataSourceEntry`, `toDataTypeEntry`, `toDashboardEntry`) are `private`; only `buildPipeline` (and
several pure helpers used for testing) are already `private[services]`. `MetricService` (HEL-418
epic) is a sibling service with `findAll`/`findById`, entirely uninvolved with `WorkspaceContextService`
today — no metric resource type exists in `WorkspaceContextProtocol.scala` at all. Every repository
already has `findByIdOwned(id, user): Future[Option[T]]`, but `DashboardService`/`DataSourceService`
don't expose a service-level `findById` the way `DataTypeService`/`MetricService` already do.

HEL-660 (merged) added `ClaudeClient.sendWithTools` plus `ClaudeTool(name, description, inputSchema:
JsValue)`. This ticket is the `find`/`get_resource` backing methods and their `ClaudeTool` schemas —
no route, no tool-use loop wiring (HEL-662).

## Goals / Non-Goals

**Goals:**
- `find(user, query, resourceTypes?)`: compact, cheap, keyword/substring search across all 5
  resource types (data source, DataType, pipeline, dashboard, metric).
- `getResource(user, id, resourceType)`: full per-resource detail, reusing existing assembly logic
  rather than duplicating it, at the same detail level `WorkspaceContextService` already provides.
- Both exposed as `ClaudeTool` schemas ready for HEL-662 to hand to `sendWithTools`.

**Non-Goals:**
- No embeddings/vector search (design spec Non-goals) — plain substring matching on name/description.
- No route/API endpoint.
- No change to `WorkspaceContextService.assemble`'s own behavior, response shape, or existing tests.
- No wiring into the actual assistant tool-use loop (HEL-662).

## Decisions

**D1 — New `WorkspaceSearchService`, composing `WorkspaceContextService` alongside the same 4
services it already composes, plus `MetricService`.** Mirrors `WorkspaceContextService`'s own
"compose services, never touch repositories directly" discipline (its own doc comment states this
explicitly). `find` needs its own lightweight listing (not `assemble`'s heavy per-item detail, which
would be wasteful for a keyword search), so it calls `findAll`/`listSummaries` directly on the 4+1
services; `getResource` calls `workspaceContextService`'s (widened) per-entry converters for the 4
existing types, and builds metric detail directly from `MetricDefinition` for the 5th (no existing
converter to reuse — `WorkspaceContextService` has never modeled metrics).

**D1a — `find`'s result set is capped at a named top-K constant, not unbounded (design-gate round 1
REFUTE fix).** `find` scans up to `Page.Default` (200) candidates per requested resource type (5
types unfiltered ⇒ up to 1000 candidates), but the ticket's own Scope section promises "top-K
matches," not "every match." Add `MaxFindResults: Int = 20` (a named, doc-commented tunable,
matching `WorkspaceContextService`'s own style of constants like `SampleRowLimit`/`MaxJoinHints`).
After the substring filter, results are sorted deterministically (name-match-position ascending,
then `(resourceType, name)` ascending as a stable tie-break — simple, deterministic, no new
dependency) and truncated to `MaxFindResults`. This is v1's answer to the canonical epic spec's
open question ("exact `find` ranking/matching algorithm... when result counts are large") — a
concrete, if simple, ranking, not a deferral; a smarter ranking is a future, separate improvement.

**D1b — `getResource`'s pipeline dispatch is owner-scoped, matching every other resource type
(design-gate round 1 REFUTE fix).** `PipelineService.findSummaryById` is genuinely sharing-aware
("Owner, editor, and viewer grantees can read" per its own doc comment) — using it unfiltered would
let a pipeline shared with (but not owned by) the caller succeed, contradicting both this ticket's
own NotFound contract ("isn't owned by `user`" — spec.md) and `WorkspaceContextService.assemble`'s
own pipeline listing (`pipelineService.listSummaries`, owner-scoped only), which would never have
surfaced that pipeline to this caller in the first place. Fix: after `findSummaryById` returns,
filter on `summary.ownerId.contains(user.id.value)` before building detail — `Left(NotFound)`
otherwise. `PipelineSummaryResponse.ownerId: Option[String]` is already populated by
`toSummaryResponse`, so this needs no new repository method, just a post-fetch ownership check.
`getResource` is deliberately **not** sharing-aware for any resource type in this ticket — a
consistent, owner-only contract across all 5 dispatch paths, matching `find`'s own owner-only
listings; broadening any type to sharing-aware access is a distinct, separate design decision for a
future ticket, not an accidental side effect of reusing a sharing-aware lookup method here.

**D2 — Widen `toDataSourceEntry`/`toDataTypeEntry`/`toDashboardEntry` to `private[services]`, not
duplicate their logic.** Matches the ticket's explicit "reusing... rather than duplicating" scope
requirement and the existing precedent already set by `buildPipeline` (`private[services]` for the
identical reason — a sibling class in the same package needs to call it). Zero behavior change; a
pure visibility widening, verified by re-running `WorkspaceContextServiceSpec` unmodified.

**D3 — `DashboardService.findById` / `DataSourceService.findById`, mirroring
`DataTypeService.findById`'s exact shape.** `Future[Either[ServiceError, T]]` over the repository's
existing `findByIdOwned`, `ServiceError.NotFound` on `None` — same pattern, not a new one. Needed
because `getResource` must fetch a single owned resource for these two types, and today only
`DataTypeService`/`MetricService`/`PipelineService` (`findSummaryById`) expose that at the service
layer despite every repository already supporting it.

**D4 — Resource-type identity is a closed, parseable type, not a bare string threaded everywhere.**
Add `WorkspaceResourceType` (sealed trait: `DataSource`, `DataType`, `Pipeline`, `Dashboard`,
`Metric`) with `fromString`/`asString`, mirroring the codebase's actual established convention for
this exact pattern (`DataFieldType`, `Role`, `PanelType`, `Severity`, `Comparator`, `ScheduleKind`,
`AlertEventState` all pair `fromString` with a companion `asString(x): String` function, never an
`Object.toString` override — design-gate round 1 non-blocking fix, aligning this decision with the
precedent it already claims to mirror). `getResource(id, resourceType: WorkspaceResourceType)`
takes the parsed type; `find`'s `resourceTypes: Option[Set[WorkspaceResourceType]]` filters which
types are searched. Parsing Claude's raw string `type`/`resourceTypes` tool-call arguments via
`WorkspaceResourceType.fromString`, and surfacing an unparseable value as a tool-execution error fed
back to Claude (HEL-660 D7's `Left` path) rather than an exception, is **HEL-662's**
responsibility, not this ticket's — `WorkspaceAssistantTools` here only defines the static
`ClaudeTool` schema values (name/description/`inputSchema`); it has no runtime executor, per this
ticket's own explicit Non-Goal ("No executor wiring here — HEL-662 owns turning a parsed `tool_use`
call into a `WorkspaceSearchService` invocation") — design-gate round 1 non-blocking fix, correcting
prose that read as if this ticket built that dispatch.

**D5 — `find`'s "one-line description" is synthesized per type, not read from a real field, for 4
of the 5 types.** Checked against the actual domain models: only `MetricDefinition` has a real
`description: Option[String]`; `DataSource`/`DataType`/`PipelineSummaryResponse`/`Dashboard` have
none. `find` synthesizes a short description per type (e.g. data source: `"<kind> data source"`;
DataType: `"<pipeline output|source-companion> type"`; pipeline: `"<source> → <output>"`; dashboard:
`"dashboard, <N> panels"`; metric: the real `description`, falling back to `"<aggregation> of
<measureField>"` when absent) — matches the design spec's own "keyword/substring matching over
existing name/description fields," which only ever promised matching over whatever exists, not that
every type has a description to match against in the first place.

**D6 — New wire types, not reuse of `WorkspaceContext*` for the summary shape.** `find` returns a
new `WorkspaceResourceSummary(id, resourceType, name, description)` — deliberately NOT
`WorkspaceContextDataSource`/etc., which carry per-type fields `find`'s compact contract doesn't
need. `getResource` returns a new sealed `WorkspaceResourceDetail` wrapping the existing
`WorkspaceContext{DataSource,DataType,Pipeline,Dashboard}` types verbatim (reused, not
re-modeled) for 4 of 5 cases, plus a new `WorkspaceResourceMetric` case for the 5th.

**D7 — `WorkspaceAssistantTools` (new object in `com.helio.services`, colocated with
`WorkspaceSearchService` — settled, design-gate round 1 non-blocking fix, was previously left as an
either/or) defines the two `ClaudeTool` values.** `com.helio.services`, not `com.helio.ai`: these
schemas describe workspace-domain concepts (`find`/`get_resource`'s parameters) and belong beside
the service they front, exactly as `WorkspaceSearchService` itself does; `com.helio.ai` stays
workspace-agnostic (it already only knows generic `ClaudeTool`/`ClaudeClient` shapes, never a
specific tool's domain meaning). `inputSchema` is a hand-built
`JsObject` JSON Schema (`{query, resourceTypes?}` for `find`; `{id, type}` for `get_resource`),
matching the design spec's exact tool signatures (`find(query, resourceTypes?)`,
`get_resource(id, type)`). No executor wiring here — HEL-662 owns turning a parsed `tool_use` call
into a `WorkspaceSearchService` invocation.

## Risks / Trade-offs

- **Widened visibility (D2) is a minor discipline relaxation** → scoped to `private[services]`
  (package-private, not public), identical to the existing `buildPipeline` precedent; no external
  package can call these.
- **`find`'s in-memory substring scan over `Page.Default` (200)-sized lists per type** → acceptable
  for v1 per the design spec's own stated scope; matches `WorkspaceContextService.assemble`'s
  existing pagination ceiling, not a new bound.
- **Metric detail has no existing "assembly logic" to reuse (D1)** → unavoidable, `MetricDefinition`
  is already a complete definition (name/description/measureField/aggregation/allowedDimensions/
  format/deprecated) with nothing further to assemble, so this isn't scope creep — it's the smallest
  amount of new logic that satisfies the ticket's explicit inclusion of `metric` in its acceptance
  criteria's resource-type list.

## Planner Notes

- Self-approved: including metrics as a 5th `WorkspaceSearchService` resource type even though
  `WorkspaceContextService` itself has never modeled them — the ticket's acceptance criteria
  explicitly list `metric` alongside source/DataType/pipeline/dashboard, and the design spec's
  Architecture section lists "metric definition" as one of `get_resource`'s per-resource detail
  kinds.
- Self-approved: adding `findById` to `DashboardService`/`DataSourceService` (D3) rather than having
  `WorkspaceSearchService` reach into `DashboardRepository`/`DataSourceRepository` directly — keeps
  `WorkspaceSearchService` consistent with `WorkspaceContextService`'s own "compose services, never
  repositories" discipline, which this codebase treats as a real architectural boundary (see
  `WorkspaceContextService`'s own class-doc comment).
