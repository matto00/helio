## Why

HEL-861 made row-cap truncation honest in the live run result, but the signal lives only in Redux run state. Reload
the pipeline detail page and the banner is gone while `Rows written: 1,000` still renders — a plausible-looking number
with nothing to distrust it. Because a run is read long after it happened far more often than at the moment it
completes, this is the state most readers actually encounter. A truncation signal that is absent is indistinguishable
from "nothing was truncated", so every historical run silently reads as complete and agents reasoning over run history
draw confident conclusions from partial data.

## What Changes

- Persist the truncation facts on the `pipeline_runs` record: a run-wide truncated flag, the primary source's
  available-row count when one was measured, and the per-source truncated-read detail. The server-composed notice is
  **recomposed on read** from the persisted reads via the existing single composer, so no second phrasing is introduced.
- Persist a denormalised truncated flag alongside `pipelines.last_run_row_count` so list views and the detail footer
  can mark a count partial without a second fetch.
- Distinguish three states, not two: **truncated**, **complete**, and **no signal recorded** (a run persisted before
  this change). Recorded runs always carry present-and-empty truncation detail, per HEL-890's precedent; only
  pre-existing rows read as unrecorded, and no surface may render an unrecorded run as complete.
- Surface the persisted signal wherever a persisted row count is shown: the pipeline detail footer, the run history
  modal, and the pipeline list table.
- **BREAKING** for `GET /api/pipelines/:id/run-history` readers only in the additive sense: `PipelineRunRecord` gains
  fields and its schema's `required`/`additionalProperties: false` contract is updated in the same change.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `pipeline-run-truncation-reporting`: extends the capability from live-run surfaces to the **persisted** record —
  truncation must survive the session that produced it, must be recoverable on every read path that reports a
  persisted row count, and an unrecorded historical run must not be reported as complete.

## Impact

- Backend: a new Flyway migration (number derived from the tree at write time; **V104 or later** — the concurrent
  HEL-955 worktree claims V103, and applied migrations are never edited); `PipelineRunRepository`,
  `PipelineRepository.updateLastRun`, `PipelineRunService` run-completion path, `PipelineProtocol`
  (`PipelineRunRecord`, `PipelineSummaryResponse`), `PipelineRunHistoryRoutes`, `PipelineService.listSummaries`.
- Frontend: `frontend/src/features/pipelines/**` only — `PipelineDetailFooter`, `RunHistoryModal`,
  `PipelineListTable`, `pipelinesSlice`, `pipelineService`, pipeline types.
- Contracts: `schemas/pipelines/pipeline-run-record.schema.json`, `schemas/workspace/workspace-context.schema.json`.
- Explicitly untouched (concurrent runs own them): `ApiRoutes.scala`, `Connector*`, `RestApiConnectorDriver`,
  `ConnectorRepository`, `helio-mcp/**`, `frontend/src/shared/chrome/**`.

## Non-goals

- Changing the run row cap, or making it configurable.
- Backfilling truncation for historical runs — the facts were never recorded and cannot be reconstructed.
- Extending the MCP surface (HEL-890 already covers the live run result; `helio-mcp/src/types.ts` is owned by a
  concurrent run this cycle).
