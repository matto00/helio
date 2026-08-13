## 1. Schema

- [x] 1.1 Create `schemas/combined-proposal.schema.json`: `{ pipeline: <$ref pipeline-proposal.schema.json>, dashboard: <$ref dashboard-proposal.schema.json> }`, both required. Description documents the `"$pipelineOutput"` sentinel: set a data panel's `dataTypeId` (or, for a non-data panel, `config.dataTypeId`) to this literal string to bind it to the pipeline this same proposal creates.

## 2. Backend: protocol

- [x] 2.1 Create `backend/src/main/scala/com/helio/api/protocols/CombinedProposalProtocol.scala`:
      `CombinedProposal(pipeline: PipelineProposal, dashboard: DashboardProposal)`,
      `CombinedProposalApplyResponse(pipeline: PipelineProposalApplyResponse, dashboard:
      DuplicateDashboardResponse)`, both `jsonFormat2` (no hand-written tolerant reader needed — both
      nested types already have one). Trait extends `PipelineProposalProtocol with
      DashboardProposalProtocol with DashboardProtocol` (for `DuplicateDashboardResponse`).
- [x] 2.2 Mix `CombinedProposalProtocol` into `JsonProtocols.scala`; add its entry to the "Inter-trait
      dependencies" doc comment.

## 3. Backend: PipelineProposalService — one new public method

- [x] 3.1 Add `def rollback(response: PipelineProposalApplyResponse, user: AuthenticatedUser):
      Future[Unit]` to `PipelineProposalService` (design.md D4). Order: `pipelineService.delete` →
      `dataTypeService.delete(outputDataTypeId)` → if `response.source` is defined:
      `dataTypeRepo.findBySourceId(sourceId, user.id)` (read, captures companion ids BEFORE any
      delete — safe here, unlike inside `apply`'s own rollback) → `dataSourceService.delete(sourceId)`
      → `dataTypeService.delete` each captured companion id. No existing method in this file is
      modified.

## 4. Backend: CombinedProposalService

- [x] 4.1 Create `backend/src/main/scala/com/helio/services/CombinedProposalService.scala` composing
      `pipelineProposalService: PipelineProposalService` and `dashboardProposalService:
      DashboardProposalService` only — no repository access of its own beyond what's needed for the
      structural sentinel-position check (none — that check is pure, over the already-in-memory
      proposal).
- [x] 4.2 Implement the sentinel constant `OutputRefSentinel = "$pipelineOutput"` and a "blessed slot"
      helper mirroring `ProposalPanelSupport.bindingCandidate`'s EXACT `Option.orElse` precedence
      (design.md D2 — round-1 correction: `config.dataTypeId` is blessed ONLY for panel types outside
      `DashboardProposalService.DataPanelKinds`; round-2 correction: `config.dataTypeId` is additionally
      blessed ONLY when the flat `dataTypeId` is `isEmpty` — `orElse` never falls through to
      `config.dataTypeId` just because the flat value isn't the sentinel, only when the flat value is
      absent entirely): `clearBlessedSlot(panel): ProposalPanel` — returns a copy with the flat
      `dataTypeId` cleared to `None` if it equals the sentinel; else, ONLY when `panel.type` is outside
      `DataPanelKinds` AND `panel.dataTypeId.isEmpty`, returns a copy with `config`'s `"dataTypeId"` key
      removed if its value equals the sentinel; otherwise returns the panel unchanged (in particular: a
      non-`DataPanelKinds` panel whose flat `dataTypeId` already holds some OTHER real, non-sentinel
      value never has its `config.dataTypeId` cleared, even if that holds the sentinel — that occurrence
      is dangling, not blessed). Then `validateOutputRefPositions(panels): Either[ServiceError, Unit]`:
      for each panel, compute `clearBlessedSlot(panel)` and check whether the sentinel string still
      appears anywhere in that CLEARED panel's JSON serialization
      (`clearBlessedSlot(panel).toJson.toString.contains(OutputRefSentinel)`) — if it does (a
      kind-mismatched occurrence with no blessed slot at all, a `config.dataTypeId` occurrence shadowed
      by an already-set flat field, or a second, duplicate occurrence alongside a legitimate one),
      return `Left(BadRequest(...))` naming the panel by 1-based index/title. Pure, no I/O, runs first —
      before `pipelineProposalService.apply` is ever called.
- [x] 4.3 Implement `resolveOutputRefs(panels, outputDataTypeId): Vector[ProposalPanel]` (design.md D3):
      for each panel, using the SAME precedence as 4.2 (flat `dataTypeId` if it holds the sentinel;
      else, only when `panel.type` is outside `DataPanelKinds` AND the flat `dataTypeId` `isEmpty`,
      `config.dataTypeId`), replace the sentinel with `outputDataTypeId` at that one location — leaves
      every other panel untouched. Since 4.2 already guarantees at most one legitimate occurrence per
      panel by the time this runs, this substitution is unconditional at that single location, never an
      ambiguous choice between two candidate slots.
- [x] 4.4 Implement `apply(combined: CombinedProposal, user): Future[Either[ServiceError,
      CombinedProposalApplyResponse]]`: run 4.2's check; on `Right`, call
      `pipelineProposalService.apply(combined.pipeline, user)`; on `Left`, return it unchanged (that
      service already rolled back its own partial failure internally — nothing further to do here);
      on `Right(pipelineResp)`, resolve `combined.dashboard.panels` via 4.3 using
      `pipelineResp.outputDataTypeId`, call `dashboardProposalService.apply(resolvedDashboard, user)`;
      on `Right((dashboard, panels))` return `Right(CombinedProposalApplyResponse(pipelineResp,
      DuplicateDashboardResponse(DashboardResponse.fromDomain(dashboard),
      panels.map(p => PanelResponse.fromDomain(p)))))` — NOTE the explicit lambda:
      `PanelResponse.fromDomain(panel: Panel, dataAsOf: Option[String] = None)` takes a defaulted
      second parameter, which Scala does not eta-expand into a bare `Panel => PanelResponse`; every
      existing call site in this codebase (`DashboardRoutes.scala`, `DashboardProposalRoutes.scala`,
      etc.) wraps it in an explicit lambda — mirror that, not a bare method reference; on `Left(err)`,
      call `pipelineProposalService.rollback(pipelineResp, user)` then return `Left(err)` unchanged.

## 5. Backend: route + wiring

- [x] 5.1 Create `backend/src/main/scala/com/helio/api/routes/CombinedProposalRoutes.scala`:
      `pathPrefix("proposals") { path("apply") { post { entity(as[CombinedProposal]) { ... } } } }` —
      a brand-new top-level prefix (design.md D6 — no route-mount-order risk, unlike the
      `PipelineIdSegment` hazard HEL-656 tracks separately). Mirrors
      `PipelineProposalRoutes`/`DashboardProposalRoutes`'s structure; `StatusCodes.Created`.
- [x] 5.2 Wire `CombinedProposalService` (composing the already-constructed `pipelineProposalService`
      and `proposalService` [`DashboardProposalService`]) and `CombinedProposalRoutes` into
      `ApiRoutes.scala` — construct near `pipelineProposalService`, mount the route alongside
      `PipelineProposalRoutes`.

## 6. MCP: types, client, tool

- [x] 6.1 Add `CombinedProposal { pipeline: PipelineProposal; dashboard: { dashboardName: string;
      panels: ProposalPanel[] } }` and `CombinedProposalApplyResponse { pipeline:
      PipelineProposalApplyResponse; dashboard: { dashboard: DashboardResponse; panels: PanelResponse[]
      } }` to `helio-mcp/src/types.ts`.
- [x] 6.2 Add `applyCombinedProposal(combined: CombinedProposal): Promise<CombinedProposalApplyResponse>`
      to `helio-mcp/src/helioApi.ts` — `POST /api/proposals/apply`, thin pass-through.
- [x] 6.3 Create `helio-mcp/src/tools/combinedProposalHandlers.ts` (zod-free, `McpServer`-free, mirrors
      HEL-385's D4b split) exporting `applyCombinedProposalHandler(api, combined):
      Promise<CombinedProposalApplyResponse>` — `return api.applyCombinedProposal(combined)`, no
      client-side logic (the sentinel-position validation is server-side only, per design.md D7).
- [x] 6.4 Create `helio-mcp/src/tools/combinedProposal.ts` registering `apply_combined_proposal`: reuses
      `pipelineProposal.ts`'s `PipelineProposal`-shaped `inputSchema` fields for `pipeline`, and
      `panelSchema` (exported from `proposal.ts`, NOT `write.ts` — `write.ts` only re-imports it from
      `proposal.ts` for its own use, per round-1 skeptic's non-blocking correction) for `dashboard`'s
      `panels` array, alongside an inline `dashboardName: z.string().min(1)` (matching
      `propose_dashboard`/`apply_proposal`'s own inline field — there is no separately-exported
      `dashboardName` schema to import). Description states the `"$pipelineOutput"` sentinel value
      explicitly, that `config.dataTypeId` is the sentinel's slot ONLY for a non-data (text/markdown)
      panel — never for metric/chart/table/collection/timeline, which must use the flat `dataTypeId` —
      and that this is the deterministic apply path (no NL authoring). Handler:
      `guarded(() => applyCombinedProposalHandler(api, combined))`.
- [x] 6.5 Register `registerCombinedProposalTools` (or fold into an existing `register*` call, whichever
      keeps `index.ts`'s registration list flattest) in `helio-mcp/src/index.ts`.

## 7. Tests

- [x] 7.1 Create `backend/src/test/scala/com/helio/api/CombinedApplyProposalSpecBase.scala` (embedded
      Postgres + Flyway + real-RLS `ApiRoutes` fixture, mirrors `ApplyProposalSpecBase.scala`) with
      count helpers for `data_sources`/`pipelines`/`pipeline_steps`/`data_types`/`dashboards`/`panels`.
- [x] 7.2 Happy path: combined proposal with an inline `static` source, one step, a dashboard with one
      panel bound to `"$pipelineOutput"` → `201`, every resource created, panel's bound `dataTypeId`
      equals the pipeline's real `outputDataTypeId`.
- [x] 7.3 Mixed-binding happy path: one panel bound to `"$pipelineOutput"`, another bound to a
      pre-seeded, pre-existing pipeline-output DataType id → both created correctly (spec.md scenario).
- [x] 7.4 Dangling ref rejected creating nothing: sentinel placed in `fieldMapping` instead of
      `dataTypeId` → `400` naming the panel; assert all six resource counts unchanged.
- [x] 7.4a Kind-mismatch dangling ref (round-1 skeptic finding 1): a `chart` panel with flat
      `dataTypeId` absent/blank and `config: {"dataTypeId": "$pipelineOutput"}` → `400` naming the
      panel, creating nothing — `config.dataTypeId` is never a blessed slot for a `DataPanelKinds`
      panel, regardless of the flat field's value. Distinct from 7.3's mixed-binding case, which uses a
      non-data (or correctly-flat-bound) panel.
- [x] 7.4b Duplicate-occurrence dangling ref (round-1 skeptic finding 2): a panel with the sentinel
      legitimately in its blessed slot (`dataTypeId` for a data panel, or `config.dataTypeId` for a
      text/markdown panel) AND the same literal sentinel string ALSO duplicated in an unrelated field
      (e.g. `fieldMapping`) on the SAME panel → `400` naming the panel, creating nothing — proves the
      check doesn't stop scanning once it finds the legitimate occurrence.
- [x] 7.4c Shadowed-config dangling ref (round-2 skeptic finding — `orElse`-absence, not
      not-equal-to-sentinel): a non-`DataPanelKinds` panel (e.g. `text`) with a real, pre-existing,
      non-sentinel `dataTypeId` already set on the flat field, AND `config: {"dataTypeId":
      "$pipelineOutput"}` → `400` naming the panel, creating nothing — `config.dataTypeId` is consulted
      only when the flat field is absent, never merely because it holds a different value. Distinct
      from 7.4a (flat absent, kind-mismatched panel type) and 7.4b (duplicate within the same blessed
      slot's panel type).
- [x] 7.5 Dashboard-phase failure rolls back the pipeline+source: valid pipeline, dashboard panel with
      an invalid `chartType` → error from the dashboard phase; assert
      `data_sources`/`pipelines`/`pipeline_steps`/`data_types` counts unchanged from before the call
      (ticket's own explicitly-required test).
- [x] 7.6 Pipeline-phase failure short-circuits (no dashboard attempt): invalid inline SQL (non-SELECT)
      in `pipeline.source` → `400` with the guardrail message verbatim; assert no dashboard/panel rows
      exist that didn't exist before the call either.
- [x] 7.7 Standalone-path regression: `POST /api/dashboards/apply-proposal` and `POST
      /api/pipelines/apply-proposal` still behave exactly as before, including a panel whose
      `dataTypeId` literally equals `"$pipelineOutput"` being rejected as an ordinary not-found binding
      (no special sentinel handling on either standalone path) — spec.md's "Standalone proposal paths
      are unaffected" scenario.
- [x] 7.8 MCP: unit test for `applyCombinedProposalHandler` (call-routing to `api.applyCombinedProposal`,
      mirrors `pipelineProposalHandlers.test.ts`'s pattern) using a minimal hand-rolled `HelioApi` mock.
- [x] 7.9 Run `sbt test` and confirm the full backend suite is green.
- [x] 7.10 Run `npm --prefix helio-mcp run build`/`typecheck` and `npm test` (root) and confirm green.
