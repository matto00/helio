## Why

Agent-Authored Pipelines (HEL-342) needs a way to turn a reviewed `PipelineProposal` (HEL-379's
schema/protocol) into real resources. Today there is no apply path — a proposal is just data. This
change adds the atomic apply service + route, the data-layer counterpart to `DashboardProposalService`,
so an agent or reviewer can commit a proposal in one all-or-nothing call.

## What Changes

- New `PipelineProposalService.apply(proposal, user)`: pre-validates structure + inline-source
  guardrails (SQL read-only check) up front, then composes `SourceService`/`DataSourceService`
  (source, if inline), `PipelineService` (pipeline + steps), and `PipelineRunService` (run) in order.
- New `POST /api/pipelines/apply-proposal` route, wired alongside `DashboardProposalRoutes`.
- Rollback on any failure after creation begins: deletes the partially-created pipeline (steps/runs
  cascade), its orphaned output DataType (no DB cascade covers this direction), and — if this apply
  created it — the inline source and its companion DataType (source deletion only nulls the
  DataType's `source_id`, it does not cascade-delete it).
- Source-fetch failure (inline `rest_api`/`sql`) is treated as an apply failure: the created source
  is rolled back and the connector's curated message is surfaced as a structured error, not a 500.
- Inline `csv` is accepted by the schema but rejected at apply time with a clear "not yet supported"
  error (no bytes channel exists in a JSON proposal) — existing CSV sources remain usable via
  `sourceId`.

## Capabilities

### New Capabilities

- `pipeline-proposal-apply`: atomic apply of a `PipelineProposal` into a real source/pipeline/steps/run,
  with pre-validation guardrails and full rollback on any mid-apply failure.

### Modified Capabilities

(none — `pipeline-proposal-contract` is consumed, not changed)

## Impact

- New: `backend/src/main/scala/com/helio/services/PipelineProposalService.scala`,
  `backend/src/main/scala/com/helio/api/routes/PipelineProposalRoutes.scala`.
- Modified: `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (wire the new service + route).
- No schema/protocol changes — reuses `PipelineProposal`/`PipelineProposalSource` verbatim (HEL-379).
- No migrations. Additive endpoint; existing pipeline/source endpoints unchanged.
- Depends on `SourceService`, `DataSourceService`, `PipelineService`, `PipelineRunService`,
  `DataSourceRepository`, `DataTypeRepository` — no new persistence logic.

## Non-goals

- Analyze/dry-run projection of a proposal (separate ticket).
- MCP `propose_pipeline`/apply tool wiring (separate ticket).
- Combining a pipeline proposal with a dashboard proposal in one call (separate ticket).
- Expanding `PipelineRunService`'s Spark-submission source-kind support (still static/csv-only) —
  this change composes that service as-is, unchanged.
