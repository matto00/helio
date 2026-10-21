## Why

HEL-1660 bounded the run path's memory, but its snapshot write batches the JSON text by row count (200). A node of
200 rows or fewer of long text is rendered in one go: an accepted 200-row UTF-16 run peaks at 294 MB, 53% over the
owner's 192 MB per-run share (HEL-1660 ruling 3). The run-path bound should hold for wide/long rows as well as tall ones.

## What Changes

- `NodeSnapshotRepository.overwriteRowsAction` closes a batch once its rendered JSON text reaches a fixed character
  budget (and still at 200 rows), always with at least one row. Run, Output and backfill writes all go through it.
- A separate, measured row-render limit (`RunLimits.MaxRowRenderChars`, independent of `postWalkCells`) is checked in
  `refuseOverPostWalkBudget` and in backfill, so a run (or backfill) whose single row would render past the share fails
  cleanly (run: the existing run-limit step error; backfill: its existing logged failure, writing nothing).
- The opt-in history payload write (HEL-1276) measures the node's exact JSON bytes before rendering, so an over-cap node
  is never rendered. Its outcome (no payload, a WARN) is unchanged.
- A deterministic CI guard pins the rendered text held ahead of the inserts to the batch budget; mutation-checked.
- `RunPathHeapSpec` gains the 200-, ~20- and 1-row long-text shapes (and a wide single-row shape), measured red first.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-memory-bounds`: adds a requirement that a run's snapshot and payload writes stay within the per-run
  share whatever the row width.

## Non-goals

- No new owner-facing limit or env var; the per-run share and the run-limit step error are HEL-1660's rulings.
- Cross-run memory admission and the batched-write atomicity spec (HEL-1680).
- The run's HTTP response serialisation (outside the service run path HEL-1660 measured); findings are reported, not fixed.
- No frontend change.

## Impact

- `backend/.../persistence/pipelines/NodeSnapshotRepository.scala`, `NodePayloadHistoryRepository.scala`
- `backend/.../domain/engine/RunLimits.scala` (`MaxRowRenderChars`, row-width check)
- Tests: `NodeSnapshotBatchedWriteSpec`, `RunLimitsGuardSpec`, `RunPathHeapSpec` (opt-in), payload repository spec.
