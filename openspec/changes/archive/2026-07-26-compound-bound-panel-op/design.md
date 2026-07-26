## Context

`helio-news`'s `build_bound_panel()` (`helio_client.py`) makes 6 sequential MCP round-trips per
panel; a mid-chain failure orphans resources. `PipelineRunService.submit`/`executeRun`
(`backend/src/main/scala/com/helio/services/PipelineRunService.scala`) resolves entirely inside
the `Future` chain `submit` returns — `onRunSuccess` writes rows (`dataTypeRowRepo.overwriteRows`)
and upserts the output DataType's fields before the HTTP response completes. **Confirmed
synchronous** (not assumed) by reading the run lifecycle end to end.

HEL-337 already shipped a sibling composition **twice**, both client-side, both explicitly
choosing no new backend endpoint and no rollback:
- HEL-399 `ShapeInstantiateStep.tsx`: `expand → createPipeline → createPipelineStep* → run →
  bind`, entirely in the frontend. Its own comment: "no rollback of the already-created pipeline
  on a mid-loop failure — it's discoverable and fixable from /pipelines like any other pipeline."
  Correct for a human who can retry via UI.
- HEL-400 `helioApi.ts#createPipelineFromShape`: calls `expand` first so a bad shape/params
  creates nothing, but still has zero cleanup once `createPipeline` succeeds.

**This ticket is deliberately a third, different composition — not a reuse of HEL-399/400's
path** — because the caller here is an unattended agent with no human to retry visually, and the
ticket explicitly asks for a *server-side, single-HTTP-call* op with named-stage failures and
cleanup. Reusing HEL-399/400's client-side loop would just relocate the round-trips into the
compound endpoint's own implementation while keeping their "no rollback" semantics, which fails
this ticket's core requirement. The composition pattern this design follows instead is HEL-363's
(`DashboardContentsService`): validate everything possible before the first write, then execute.

## Goals / Non-Goals

**Goals:**
- One `POST /api/panels/bound` call: source (inline or reused) → pipeline+steps → synchronous run
  → panel create+bind, returning all four ids with rows already present.
- Reject an unsatisfiable panel/DataType binding **before creating anything**, reusing HEL-365's
  `PanelBindingSpec`.
- On a failure after the first write, best-effort compensating cleanup — no dangling
  bound-to-nothing panel, and no orphaned "looks like a pipeline output" DataType.
- Every resource in the chain owner-scoped; cross-tenant `sourceDataSourceId` reuse → 404.

**Non-Goals:** batch/multi-panel (HEL-370), new step types/shape presets (HEL-336/337), layout
placement (HEL-367), resource tagging (HEL-366), a true multi-service DB transaction (infeasible
here — the chain spans `DataSourceRepository`/`PipelineRepository`/`DataTypeRepository`/
`DataTypeRowRepository`/`PanelRepository`, each with independent Slick actions; HEL-363's single
`DashboardContentsOps.replaceContents` transaction only ever wrapped one repository).

## Decisions

**D1 — New service `BoundPanelService`, new route `BoundPanelRoutes`, no new tables.**
Constructed in `ApiRoutes.scala` after `dataSourceService`/`pipelineService`/`pipelineRunService`/
`panelService` (it composes all four instances directly — same DI pattern as
`DashboardContentsService` composing `panelService`). Mounted as
`new BoundPanelRoutes(boundPanelService, authenticatedUser).routes` in the authenticated tree.

**D2 — Request/response shape** (matches the ticket's stated payload exactly):
```
POST /api/panels/bound
{ dashboardId, source?: {name, columns:[{name,type}], rows}, sourceDataSourceId?: string,
  pipeline: { name?, outputDataTypeName, steps: [{type, config}] },
  panel: { type, title, config?, appearance? }, fieldMapping?: {...} }
→ 201 { sourceId, pipelineId, dataTypeId, panel: PanelResponse }
```
Exactly one of `source`/`sourceDataSourceId` — validated first (400, zero reads/writes). `panel`
mirrors `CreatePanelRequest`; the server injects `dataTypeId` (the new pipeline's output type,
unknowable to the caller in advance) into `panel.config` merged with the top-level `fieldMapping`
before calling `PanelService.buildForCreate` — mirroring exactly how `bindPanel`
(`helio-mcp/src/helioApi.ts:526`) shapes `config: {dataTypeId, fieldMapping}` today.

**D3 — Validate-before-first-write gate, extending HEL-400's principle further than HEL-400 did.**
`panel.type` must be one of `PanelBindingSpec.DataBindable`'s kinds (metric/chart/table/timeline/
collection) — other types 400 immediately ("use POST /api/panels directly"). The known source
schema (inline `source.columns` types, or — read-only — the existing `sourceDataSourceId`'s
companion DataType fields via `dataTypeRepo.findByIdOwned`/`findBySourceId`) is fed through
`PipelineAnalyzeService.analyze(steps, sourceSchema)` (pure, synchronous, zero DB writes — the
same call `PipelineService.analyze` makes) to get the **projected final-step output schema**.
That projected schema is evaluated against the requested panel type's `PanelBindingSpec` using the
same bindability rule `PanelCapabilityService.capabilityFor`/`eligibleColumnNames` already encode
(HEL-365) — extracted into a small pure function shared by both call sites (e.g.
`PanelBindingSpec.evaluate(spec, columns): BindabilityResult`) so there is exactly one
implementation of "is this panel type satisfiable by these columns," not two. An unsatisfiable
binding 400s naming the missing slot — **before the DataSource, Pipeline, or Panel exist.**
Caveat documented in Risks: this is a projection from step *configuration*, not actual output
rows — a real run can still legitimately diverge (e.g. a compute step's runtime type is looser
than static inference), so this gate is a strong pre-filter, not a runtime guarantee.

**D4 — Execution order after the gate passes:**
1. `source` inline → `dataSourceService.createStatic` (only `type: static` supported at launch,
   matching the ticket's `columns+rows` shape — CSV/URL sources are out of scope, same as
   `helio-news`'s actual usage). `sourceDataSourceId` → re-verify via `findByIdOwned` (404 on
   cross-tenant, no existence leak, matching every other owner-scoped lookup in this codebase).
2. `pipelineService.create` (creates the empty-fields output DataType + Pipeline in one call,
   existing behavior, unmodified).
3. `pipelineService.addStep` per step, in order — reuses existing per-step ACL/validation
   (Join/Union/Lookup cross-source ownership checks included for free).
4. `pipelineRunService.submit(..., isDry = false)` — synchronous; on success, rows + schema are
   already persisted when this returns.
5. `panelService.buildForCreate` + `panelRepo.insert` — reuses HEL-363's exact
   config-decode/appearance-resolve/`rejectCompanionBinding` path, so V41 pipeline-only-binding
   enforcement applies for free (see Risks — this is a belt-and-suspenders check; by construction
   step 5 always binds to the just-created pipeline output, never a companion type).

**D5 — Compensating cleanup on any failure at stage 2 onward** (stage 1 failure needs no cleanup
— nothing else exists yet). Verified FK behavior (not assumed) by reading the migrations:
`pipelines.source_data_source_id → data_sources ON DELETE CASCADE`,
`pipelines.output_data_type_id → data_types ON DELETE CASCADE`, but
`data_types.source_id → data_sources ON DELETE SET NULL` (**not** CASCADE) and `data_type_rows`
has no FK at all. Naive cleanup (just delete the inline-created DataSource) would SET NULL the
source's companion DataType instead of removing it — silently manufacturing a row that looks like
a valid pipeline-output DataType (`source_id IS NULL`) out of a rolled-back operation. Cleanup
therefore runs explicitly, in this order, swallowing individual failures (best-effort, logged, not
re-thrown — a failed cleanup must not mask the original error the caller needs to see):
  1. Delete `data_type_rows` for the output DataType id, if a run happened (dataTypeRowRepo has no
     cascade to rely on).
  2. `dataTypeRepo.delete(outputDataTypeId)` — cascades the Pipeline (+ steps, which cascade from
     the pipeline).
  3. If `source` was created inline THIS call: `dataTypeRepo.findBySourceId(sourceId)` → delete
     the companion DataType explicitly (never rely on the SET NULL FK), then
     `dataSourceService.delete(sourceId)`.
  A reused `sourceDataSourceId` is never touched by cleanup — it's not this call's resource.
Response on failure: `4xx/5xx` naming the failed stage (`"source" | "pipeline" | "steps" | "run" |
"panel"`) and the stage's own error message, verbatim where the underlying service already curates
one (HEL-311 discipline — never a raw DB exception).

**D6 — Zero-row run is success, not failure.** `pipelineRunService.submit`'s `Right(...)` case with
`jsRows.isEmpty` proceeds to panel creation exactly like a non-empty run — only a `Left` (engine
exception, unsupported source type, etc.) triggers cleanup.

**D7 — Multi-tenancy.** Dashboard target ACL: `accessChecker.requireAccess("dashboard", ...)`
(Viewer → 403), identical to `PanelService.create`. Every created resource's owner is the calling
`AuthenticatedUser` — no path in this service ever passes another user's id. Reused
`sourceDataSourceId` uses `findByIdOwned` (404, not 403, on cross-tenant — no existence leak,
matching `DataSourceService`/`PipelineService` convention throughout).

## Risks / Trade-offs

- [No real cross-service DB transaction] → mitigated by validate-first (D3) shrinking the failure
  window to genuine runtime faults (DB down, disk full, concurrent delete), and D5's explicit
  cleanup for the remaining window. Documented, not hidden.
- [D3's schema projection can diverge from actual run output] → the gate is advisory-strong, not a
  guarantee; a step whose real output differs from its static inference could still make the panel
  bind "successfully" against sparser data. Existing `PipelineAnalyzeService` behavior, not a new
  gap this ticket introduces.
- [Cleanup itself can fail] → each cleanup step is wrapped/logged independently and never rethrown
  over the original error; a fully-orphaned resource after a cleanup failure is surfaced via
  existing `/pipelines`/`/data-sources` listings for manual deletion, same discoverability HEL-399
  already relies on for its own no-rollback path.
- [Extracting `PanelBindingSpec.evaluate` touches `PanelCapabilityService`] → behavior-preserving
  refactor only (D3); `PanelCapabilityServiceSpec` must still pass unmodified.

## Planner Notes

Self-approved: D1 (new service/route location), D2 (wire shape — directly transcribed from the
ticket body), D4-step-1's static-only inline source (CSV/URL are HEL-364-adjacent scope creep, the
ticket's own example only ever shows `columns+rows`), and D5's explicit-delete-over-rely-on-FK
cleanup order (the SET NULL discovery makes any other order actively wrong, not just less clean).
