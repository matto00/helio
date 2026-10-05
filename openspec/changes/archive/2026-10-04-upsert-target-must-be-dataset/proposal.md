## Why

An `upsertsource` step whose `existingSource` target is an owned CSV/REST/SQL/content source is accepted at create,
reports clean from analyze, previews and dry-runs successfully, and only fails at the real run's deferred write
("Data source is not a dataset"). The user is told the pipeline is valid until the one run that matters.

## What Changes

- One shared "writable dataset target" predicate (owned by the pipeline owner AND canonical kind `dataset`), used by
  the write-time check, step create/update, analyze and step execution, so they cannot disagree.
- Step create (`POST /api/pipelines`, `POST /api/pipelines/:id/steps`) and update (`PATCH` step config) reject a
  non-dataset existing-source target with 422 naming the target (id, name, kind). Unknown/foreign ids keep today's
  uniform 404. All entry paths (UI editor, MCP `add_pipeline_step`, apply-proposal, patch-set apply) funnel here.
- Analyze reports the problem as the step's `validationError`.
- Step preview, Output preview, dry run and real run refuse before any write with HEL-1147's
  `STEP_CONFIG_INVALID` 422 (WARN, no stack), attributed to the upsert step.
- Already-stored invalid steps still read back cleanly; they are flagged by analyze and refused at execution.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-upsertsource-config`: existing-source targets must be writable datasets, checked at save, analyze and
  execution.

## Impact

Backend only plus an MCP tool-description sentence: `UpsertSourceConfig`, `UpsertSourceStep`, `PipelineService`
(create/addStep/updateStep/analyze), `DataSourceRepository` write path, `DataSourceKind`. No migration, no schema
change (reuses `StepConfigErrorResponse`). Frontend unchanged (picker already lists datasets only; tray already
renders `STEP_CONFIG_INVALID`).

## Non-goals

- Grantee-owned datasets as targets (targets stay owner-owned, HEL-1100 D1).
- Changing HEL-1252's delete-blocking reference semantics: a stored invalid target still blocks deleting its source.
- Repairing or deleting stored invalid steps (count reported only).
- Patch-set preview projection beyond parity with whatever reference pre-checks it already performs.
