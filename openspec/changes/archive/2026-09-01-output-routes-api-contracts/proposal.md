## Why

P1.1/P1.2 built the Outputs persistence model and tree-walk engine, but no HTTP surface exposes
Outputs, `POST /api/pipelines` still takes only `name`/`sourceDataSourceId`, there is no
capabilities-at-node route, and legacy `/api/types`/`/api/metrics`/panel-binding refs remain. This
adds the missing route/contract surface so P1.4/P1.5/P1.6 have something real to build against.

## What Changes

- Add `OutputRoutes` (`GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`,
  `GET /api/outputs/:id/{rows,panels,assertion-status}`), plus lean paginated list endpoints for
  `/api/dashboards` and `/api/outputs`.
- Extend `POST /api/pipelines` to a single-call transactional shape (inline source, `steps[]` with
  `parentStepId`, `outputs[]`); extend `POST /api/pipelines/:id/steps`/`DELETE` for tails.
- Add `GET /api/pipelines/:id/capabilities?stepId=` (per-node Output bindability), backed by the
  `PipelineAnalyzeService` per-node schema projection deferred from P1.2 (HEL-905 task 6.4).
- Add `POST /api/pipelines/:id/preview` (per-Output dry run) and add
  `POST /api/pipelines/:id/validate-expression?stepId=` (replaces the dead
  `/api/types/:typeId/validate-expression`, never rebuilt since P1.1).
- **BREAKING**: `pipeline-shapes/:id/expand`'s response becomes `{ steps, outputs? }` (was a bare
  array) so it can carry an optional `outputs[]` block; extends `create-pipeline-step-request`/adds
  a `parentStepId` target on the request.
- **BREAKING**: remove `/api/types/*`, `/api/metrics/*`, `/api/panels/bound` references from
  `ApiRoutes.scala`; confirm `GET /api/panels/:id/query` (already removed by HEL-904) has no
  leftover schema/spec. Rewire `PublicDashboardRoutes` off `findLastRunAtByOutputDataTypeId`.
- Add `schemas/outputs/*` request/response schemas; extend `create-pipeline-step-request` with
  `parentStepId`; add `create-pipeline-request`; add a new `schemas/sources/data-source.schema.json`
  carrying `inferredSchema` on `GET/POST /api/data-sources` responses (`CreateSourceResponse`
  already has it; the base `DataSourceResponse` list/get shape did not).
- `POST /api/panels` computes and persists the decision-15 default layout item server-side, in the
  same transaction as the panel insert (no `layout` in the request body).
- Move the seven-canonical-DataFieldType, select-column-retention, slot-name-validation,
  partial-merge-PATCH, and Output number-formatting bug fixes (HEL-895/638/644/892/877/876) into
  this validation path as acceptance criteria.

## Capabilities

### New Capabilities
- `output-routes-api`: REST CRUD + rows/panels/assertion-status for Outputs, plus partial-merge
  `PATCH` semantics (HEL-877) and `config.format` number formatting (HEL-876).
- `pipeline-capabilities-api`: per-node Output bindability from projected schema.
- `pipeline-preview-api`: per-Output dry-run preview endpoint.
- `pipeline-validate-expression-api`: pipeline/node-scoped expression validation, replacing the
  dead type-scoped route.

### Modified Capabilities
- `pipeline-create-api`: single-call inline-source/steps/outputs transactional shape.
- `pipeline-analyze-api`: per-node (trunk + tail) schema projection.
- `pipeline-list-api`: drop `output_data_type_id`/DataType FK references.
- `pipeline-shape-registry`: `expand` response envelope gains an optional `outputs[]` block and a
  `parentStepId` request field.
- `data-source-persistence`: `GET/POST /api/data-sources` responses gain `inferredSchema`.
- `dashboard-panel-layouts`: `POST /api/panels` computes and persists the default layout item.
- `panel-query-model`: removed — capability retired, no replacement route.

## Non-goals

helio-mcp tools, proposal/patch-set schemas, and all frontend consumption are P1.4/P1.5/P1.6.
Public-path RLS smoke, export/import version-bump reshape, and docs stay in P1.7.

## Impact

`backend/src/main/scala/com/helio/api/{ApiRoutes.scala, routes/pipelines/**, routes/panels/**}`,
new `routes/outputs/**`, `services/panels/PanelCapabilityService.scala`,
`services/pipelines/PipelineAnalyzeService.scala`, `schemas/outputs/**`, `schemas/pipelines/**`,
`schemas/panels/**`, `schemas/dashboards/**`, `openspec/specs/**` listed above.
