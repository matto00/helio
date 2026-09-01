# pipeline-create-api Specification

## Purpose
TBD - created by archiving change create-pipeline-flow. Update Purpose after archive.

## Requirements

### Requirement: POST /api/pipelines creates a new pipeline
The backend SHALL expose `POST /api/pipelines` accepting a JSON body with fields: `name` (string,
required, non-empty), `sourceDataSourceId` (string, an existing DataSource id — REQUIRED; there is
NO inline-source variant in this endpoint today, see the note below), optional `tag`, optional
`steps[]` (each `{ clientId, type, config, parentStepId?, enabled? }` — `clientId` is a
request-scoped identifier, never persisted, that a LATER step's `parentStepId` resolves against to
target an earlier step in the SAME request before either has a real server-assigned id; a step
with no `parentStepId` extends the trunk from wherever pipeline creation left off), and optional
`outputs[]` (each `{ nodeStepClientId?, kind, name, config? }` — `nodeStepClientId` resolves
against `steps[]`'s own `clientId`s the same way, `None` meaning the pipeline's raw source). The
backend SHALL build the pipeline row, every step, and every Output in a single database
transaction (`PipelineRepository.runTransactionally`, `DbContext.withUserContext` — RLS-enforced,
not the privileged pool), and return `201 Created` with the created pipeline's summary
(`PipelineSummaryResponse`: `id`, `name`, `sourceDataSourceId`, `sourceDataSourceName`,
`lastRunStatus`, `lastRunAt`, `lastRunRowCount`, `ownerId`, `tag`) — the response is the SAME bare
`PipelineSummaryResponse` shape the pre-existing simple-create path already returned; it carries
no step or Output ids of its own (a caller that needs those reads them back via
`GET /api/pipelines/:id/steps`/`GET /api/pipelines/:id/outputs`). `outputDataTypeName` is no
longer accepted or returned. When `steps`/`outputs` are both empty (or absent), the pre-existing
simple-create shape applies unchanged — a single `pipelineRepo.create` call, no transaction
composition needed.

**Known gap, not implemented in this change (filed as an addendum on HEL-933, with its own
acceptance criterion — not silently dropped): an inline-source variant** (paste table / CSV
content or URL / connector + endpoint / text-md, built as part of the same transaction rather
than requiring a separate `POST /api/data-sources` call first) does not exist —
`sourceDataSourceId` must already reference a real, caller-owned DataSource. `tasks.md`'s task
3.1 already records this as unimplemented.

#### Scenario: Successful pipeline creation returns 201 with summary
- **WHEN** `POST /api/pipelines` is called with valid `{ name, sourceDataSourceId }` and no
  `steps`/`outputs`
- **THEN** the response is `201 Created` with a JSON body containing the new pipeline's `id`,
  `name`, `sourceDataSourceId`, `sourceDataSourceName` (from the referenced data source),
  `lastRunStatus` and `lastRunAt` both absent from the response (spray-json omits `Option = None` fields rather than writing `null`), and no `outputDataTypeName` field

#### Scenario: Missing required field returns 400
- **WHEN** `POST /api/pipelines` is called with a missing or empty required field
- **THEN** the response is `400 Bad Request` with an error message

#### Scenario: Non-existent sourceDataSourceId returns 404
- **WHEN** `POST /api/pipelines` is called with a `sourceDataSourceId` that does not exist (or is
  not owned by the caller)
- **THEN** the response is `404 Not Found` with an error message

#### Scenario: Created pipeline appears in GET /api/pipelines list
- **WHEN** a pipeline is created via `POST /api/pipelines`
- **THEN** a subsequent `GET /api/pipelines` includes the new pipeline in the response array

#### Scenario: Single call builds a trunk step, a tail step, and an Output
- **WHEN** `POST /api/pipelines` is called with a real `sourceDataSourceId`, two `steps[]` entries
  (the second referencing the first's `clientId` as its own `parentStepId`, forming a tail), and
  one `outputs[]` entry whose `nodeStepClientId` names the tail step's `clientId`
- **THEN** the response is `201 Created` and the pipeline, both steps, and the Output all exist,
  correctly linked

#### Scenario: A failing step rolls back the whole transaction
- **WHEN** `POST /api/pipelines` is called with a `steps[]` entry whose config fails validation (or
  whose `parentStepId` references a `clientId` not present earlier in the same request)
- **THEN** the response is a `400` error and no pipeline, step, or Output row is created

#### Scenario: A failing Output rolls back the whole transaction
- **WHEN** `POST /api/pipelines` is called with valid steps but an `outputs[]` entry naming an
  Output kind not bindable at its `nodeStepClientId`'s node
- **THEN** the response is a `400` error and no pipeline, step, or Output row is created

#### Scenario: The pre-existing simple-create shape is unaffected
- **WHEN** `POST /api/pipelines` is called with `steps`/`outputs` both empty or absent
- **THEN** the response is byte-identical to the pre-existing simple-create behavior (no
  transaction composition, no `steps`/`outputs`-related validation runs)
