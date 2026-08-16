## Why

419-B (HEL-509) persists assertion pass/fail per run; 419-C (HEL-570) blocks the DataType update on an
error-severity failure. Neither is visible anywhere — a user has no way to see why a run was blocked or
that a panel's data may be stale. This ticket closes the trust loop: surface per-run assertion outcomes
in Run History, and show an informational badge on any panel bound to a DataType whose latest run had an
error-severity assertion failure.

## What Changes

- `PipelineRunRecord` gains a non-optional `assertions: AssertionSummary` field (`passed`/`warnFailed`/
  `errorFailed` counts + a `failures: Vector[AssertionFailureDetail]` list) — zero-valued when a run had
  no assert steps. Sourced from 419-B's `listAssertionsByRunInternal`, one call per run (bounded: at most
  the 10 most-recent runs a pipeline retains).
- `RunHistoryModal.tsx` shows each run's pass/fail-by-severity summary and lets the existing per-row
  expand toggle also reveal failing rules' messages (currently that toggle only appears for a generic
  execution-failure `errorLog`).
- New small, dedicated read: `GET /api/types/:id/assertion-status` → `{ dataTypeId, invalid,
  failedRuleCount }`, mirroring `GET /api/types/:id/rows`'s existing per-DataType read pattern and ACL.
  `invalid` is true when the pipeline whose `output_data_type_id` is this DataType has a *latest* run
  (regardless of terminal status) with at least one persisted error-severity failed assertion — this
  single criterion covers both "had error-severity failures" and "was blocked" from the ticket's own
  acceptance criteria, since 419-C's blocking is itself always caused by exactly that condition.
- `PanelCard.tsx` shows an informational "Invalid data" badge when the bound DataType (via the existing
  `getDataTypeId` narrowing helper) reports `invalid: true`, fetched/cached per distinct `dataTypeId` in
  `dataTypesSlice` (deduped — multiple panels bound to the same DataType share one fetch).

## Capabilities

### New Capabilities

- `run-history-assertion-summary`: per-run assertion pass/fail visibility in Run History.
- `panel-assertion-invalid-badge`: the per-DataType assertion-status read and its panel-card badge.

### Modified Capabilities

(none — additive fields/routes only; no existing requirement is contradicted, unlike 419-C's own design)

## Impact

- Backend: `api/protocols/PipelineProtocol.scala` (`AssertionSummary`/`AssertionFailureDetail`,
  `PipelineRunRecord` extended, new `AssertionStatusResponse`), `services/PipelineRunService.scala`
  (`history()` extended, new `assertionStatusForDataType`), `infrastructure/PipelineRunRepository.scala`
  (new `findLatestRunIdByOutputDataTypeIdInternal`), `api/routes/DataTypeRoutes.scala` (new route).
- Frontend: `features/pipelines/types/pipelineStep.ts`, `features/pipelines/ui/RunHistoryModal.tsx`,
  `features/dataTypes/state/dataTypesSlice.ts` (new cached-fetch), `features/panels/ui/PanelCard.tsx`.
- `schemas/pipeline-run-record.schema.json` extended; new `schemas/data-type-assertion-status.schema.json`.
- No migration — reads only, no new tables/columns.

## Non-goals

- The evaluation/persistence itself (419-B) and blocking policy (419-C) — both already shipped.
- MCP/agent surfacing (419-F).
- Any change to `pipelines.last_run_status`/`pipeline_runs.status` semantics — read-only surfacing of
  what 419-B/419-C already persist.
