# HEL-906: P1.3 — API + contracts: Output routes, single-call create_pipeline, capabilities-at-node, assertion status; delete the panel query route

## Description

*Note: Includes* HEL-905 *task 6.4 — PipelineAnalyzeService per-node (trunk + tail) schema projection, deferred from P1.2.*

Row **P1.3** of HEL-903 (epic: Pipelines & Outputs remodel). Spec section *API & contracts*, decisions 10, 11, 15. Routes are composed in `ApiRoutes.scala`. **P1.1 (HEL-904)** has already deleted `DataTypeRoutes`, `MetricRoutes`, `BoundPanelService`, and the DataType/Metric protocols so the backend compiles; this ticket adds the Output surface and removes the last panel-binding routes.

Note for accuracy (the first draft named routes that do not exist): there is no `GET /api/panels/capabilities`, no `/api/panels/:id/binding`, and no `PanelMetricBindingRoutes` (only a spec file by that name). The real ones are `GET /api/types/:id/panel-capabilities` (gone with P1.1), `POST /api/panels/bound` (gone with `BoundPanelService`), and `GET /api/panels/:id/query` (`PanelRoutes.scala:72` — **already removed outright by HEL-904 task 4.1**, confirmed at premise-validation; comment left in place, no further route work needed there beyond confirming no leftover schema/refs).

Contracts live in `schemas/` (JSON Schema 2020-12) and `openspec/`; CLAUDE.md requires schema + client/server changes in the same change.

**Governing document:** `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` on `main` wins over this ticket wherever they disagree.

**Premise-validation correction (see `.concertino/runs/HEL-906/evidence/premise-validation.md`):** `POST /api/panels` already accepts `type: "output"` with `config.outputId` (schemas/panels/panel.schema.json `OutputConfig`, shipped by HEL-904 task 3.6). This ticket's scope reuses that existing `type`/`config.outputId` shape — it does **not** introduce a separate `kind` field or top-level `outputId`, contrary to the ticket's own illustrative body example.

## Scope

**Routes (authenticated tree unless noted)**

- `POST /api/pipelines` — accepts `sourceId` **or** an inline source spec (paste table / CSV content or URL / connector + endpoint / text-md), optional `steps[]` (each with optional `parentStepId`, default = append to trunk), optional `outputs[]` (`{ nodeStepId?, kind, name, config }`). One call builds source → trunk → tails → outputs, transactionally.
- `POST /api/pipelines/:id/steps` gains `parentStepId`; `DELETE` returns the splice result including the placement count removed.
- `GET/POST /api/pipelines/:id/outputs`; `GET/PATCH/DELETE /api/outputs/:id` (DELETE cascades to panels; response includes the placements removed); `GET /api/outputs/:id/rows` (paginated, replaces `/api/types/:id/rows`); `GET /api/outputs/:id/panels` (placements, for the delete warning and the Output sheet).
- `POST /api/pipelines/:id/preview` — dry run returning per-Output preview rows (`?outputId=` scopes).
- `GET /api/pipelines/:id/capabilities?stepId=` — Output kinds/slots bindable at that node, from `OutputBindingSpec` (P1.1's rename of `PanelBindingSpec`) evaluated against the node's projected schema. Replaces `GET /api/types/:id/panel-capabilities` (already gone with P1.1).
- `POST /api/pipeline-shapes/:id/expand` targets a `parentStepId` and may return an `outputs[]` block ("add Outputs from a shape").
- `POST /api/panels` — `{ dashboardId, type: "output", config: { outputId } }` (existing shape, HEL-904 task 3.6) or a content-panel body; `PATCH /api/panels/:id` keeps placement fields only (title, appearance). Layout lives on `dashboards.layout`: `POST /api/panels` computes the decision-15 default size for the kind, appends the layout item to the dashboard's layout **in the same transaction** as the panel insert, and returns the placed layout — the server is the single source of truth (no `layout` in the request, no frontend copy of the constants).
- **Removed:** `GET /api/panels/:id/query` (already gone; confirm no leftover schema/refs), `panel-query.schema.json`, and every remaining `/api/types` / `/api/metrics` reference in `ApiRoutes.scala`.
- `GET /api/outputs/:id/assertion-status` — replaces `GET /api/types/:id/assertion-status` (the `panel-assertion-invalid-badge` capability; `PanelCard.tsx` consumes it via panel → output). `POST /api/pipelines/:id/validate-expression?stepId=` replaces the type-scoped validate-expression route.
- Data-source responses carry `inferredSchema` (the companion type's former `fields`), so the Sources pages (P1.6) can drop `fetchDataTypes()`.
- Lean paginated list endpoints for `/api/dashboards` and `/api/outputs` (absorbs HEL-722).
- `RequestValidation` normalizes at the boundary (Option-absent vs null idiom from HEL-362/HEL-623).

**Validation that moves here (absorbed bugs become AC):** Output-at-node binding validation must use only the seven canonical `DataFieldType` wire values — `PipelineAnalyzeService.aggResultType` and the `running_sum` case emit `integer`/`float` by a stated rule, never `"number"`/`"double"` (HEL-895, HEL-638); columns produced by `select` are not dropped from the projected schema (HEL-644); unknown or mis-typed `fieldMapping` slot names are rejected with a 400 naming the valid slots for that kind (HEL-892); `PATCH` of a partial `chart.legend` object merges instead of rejecting, and the same partial-merge holds for `tooltip`, `seriesColors`, and `axisLabels` (HEL-877); Output `config.format` carries number formatting (decimals, prefix/suffix/unit, compact) for `metric` Outputs and for `collection` Outputs with `baseType: metric`; rendering honours it in P1.6 (HEL-876).

**Inherited from HEL-905 task 6.4:** `PipelineAnalyzeService` per-node (trunk + tail) schema projection — needed by `capabilities?stepId=` and by proposal grounding (proposal side itself stays out of scope, owned by P1.4/HEL-907; the projection service is this ticket's job since capabilities-at-node depends on it).

**Contracts (additive — P1.1 already did every deletion/reshape the pre-commit gate needed):** new `schemas/outputs/{output, create-output-request, update-output-request, output-capabilities-response, preview-outputs-response}.schema.json` (`output-assertion-status` already exists from P1.1); `schemas/pipelines/create-pipeline-step-request` gains `parentStepId`, new `create-pipeline-request` for the single-call shape; the data-source response/request schemas (locate by grep — there is no `schemas/sources/` directory) gain `inferredSchema`; `schemas/panels/create-panel-request` — no change needed to the `output` variant (already correct per premise-validation), but confirm the content-panel body variants (text/markdown/image/divider) still validate. **Proposal and patch-set schemas are NOT touched here** — `check-schema-drift.mjs:20-32` reads `DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` together, so P1.4 (HEL-907) owns both sides in one change. The export/import snapshot bumps its version (currently `CurrentVersion = 2`). OpenSpec: every contract-facing capability spec (routes, schemas, alerts targeting) is updated or removed in this change; list them in the PR. `check:schemas` and `check:openspec` green.

## Acceptance Criteria

- [ ] Route specs cover every new route incl. ACL (owner/grantee/other → 200/200/404) and the single-call `create_pipeline` transaction rolling back on a failing step or Output.
- [ ] A metric Output over a `sum`/`avg` aggregate binds successfully (HEL-895/HEL-638 repro turned into a test); a `select`-produced numeric column is bindable (HEL-644); a bad slot name is a 400 with the valid slot list (HEL-892).
- [ ] Enumerate every producer of a field-type string by grep and assert each emits canonical values (HEL-895 AC 5).
- [ ] `DELETE /api/outputs/:id` response lists the removed placements; the panels are gone.
- [ ] `GET /api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query` return 404 (route absent, not a stub).
- [ ] `GET /api/outputs/:id/assertion-status` reports the last run's assertion outcome for the Output's node; alert-rule create/read works against `targetOutputId`.
- [ ] `check-schema-drift.mjs` is green with the proposal files untouched (proves the P1.3/P1.4 split is clean).
- [ ] `schemas/` + `openspec/` + `check:spec-structure` + `check:openspec:selftest` green; no `@deprecated`, alias, or shim.
- [ ] `PipelineAnalyzeService` per-node (trunk + tail) schema projection (HEL-905 task 6.4 handoff) is implemented and exercised by `capabilities?stepId=`.

## Out of Scope

helio-mcp, proposals and their schemas, frontend — P1.4/P1.5/P1.6. Public dashboard read path: `PublicDashboardRoutes.scala:51-56` calls `findLastRunAtByOutputDataTypeId` and breaks at P1.1 — this ticket rewires it to `panel → output → pipeline.lastRunAt` so the route compiles and returns rows for placements (the full public-path RLS smoke, export/import reshape, and docs stay in P1.7).

## Dependencies

Blocked by P1.2 (HEL-905, merged). Blocks P1.4 (HEL-907), P1.5 (HEL-908), P1.6 (HEL-909).

## UI Gate

N/A for this row — backend/contract only. No frontend files are touched; the evaluator/skeptic should state this explicitly rather than skipping the UI gate silently.
