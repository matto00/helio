## Why

Pipeline transformations often need to cap output to N rows — for top-N panels, previews, or
performance constraints. The Limit op completes the core pipeline toolkit alongside sort and filter.

## What Changes

- Add `"limit"` as a recognised op in `InProcessPipelineEngine` (currently falls through to
  `Future.failed`); apply by truncating the row sequence to `config.count` rows.
- Add `LimitConfig` React component — a single numeric input for row count.
- Wire `LimitConfig` into `PipelineDetailPage`: op-type entry, initial config, parse helper,
  and step-card render branch.
- Backend tests: limit to N rows, count > total rows (returns all), count <= 0 (no-op/safe).
- Frontend tests: LimitConfig renders numeric input, rejects N <= 0.

**Note**: `PipelineAnalyzeService` already handles `"limit"` as a pass-through on line 64 —
no changes needed there.

## Capabilities

### New Capabilities
- `pipeline-limit-op`: Limit pipeline step — UI config component, engine execution, and tests.

### Modified Capabilities
<!-- None — analyze service already handles "limit"; no spec-level requirement changes. -->

## Non-goals
- Sort integration (sort is a separate op; limit just truncates whatever order the rows arrive in)
- Spark-side limit execution (out of scope for in-process engine ticket)

## Impact

- `backend/.../InProcessPipelineEngine.scala` — add `applyLimit` private method and `"limit"` case
- `backend/.../InProcessPipelineEngineSpec.scala` — new limit test cases
- `frontend/src/components/LimitConfig.tsx` — new component
- `frontend/src/components/PipelineDetailPage.tsx` — wire in LimitConfig
