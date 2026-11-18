- `frontend/src/features/pipelines/state/draftStepView.ts` (+ `.test.ts`) — mapServerResolved keeps lastGood.truncated on the fallback (D4, red-first, cycle 1)
- `frontend/src/features/pipelines/state/inputFrameOrder.ts` (+ `.test.ts`) — D1: re-key root and source-secondary sample frames into the declared order; memo keeps frame and array identity (per slot: saved/draft)
- `frontend/src/features/pipelines/state/draftColumnOrder.ts` (+ `.test.ts`) — D3a `draftColumnOrder` (sparse-frame rule) and D3b resolver (saved order when the whole lineage is unchanged, else nearest client ancestor)
- `frontend/src/features/pipelines/hooks/usePipelineDraftFrames.ts` — applies the orderer to roots (draft + saved) and source secondaries; exposes `columnOrderOf`; orderer lives on `DraftFrameMemory`
- `frontend/src/features/pipelines/hooks/usePipelineDraftPresentation.ts` — passes the saved analyze's source schemas / step output names in, and `columnOrder` to the step table
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — adds ONE page key, `analyzeSourceSchemas` (the saved analyze's per-root source schemas); `usePipelineDetailPage.keys.test.tsx` lists it. DEVIATION from the D5 "diff vs main empty" instruction for these two files: the only way to hand the exact-rootId declared order to the frames hook without a request; nothing from cycle 1's projection wiring remains
- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.tsx` — draft columns = `orderColumns(frameSchema, draft.columnOrder)`; no `projectedSchema` prop
- `frontend/src/features/pipelines/evaluator/value.ts` (`putLast`, `withCellLast`), `evaluator/steps/{rowOps,cast,stringOps,window,splitText}.ts` — D2 handler fixes (below)
- Tests: `evaluator/steps/columnOrder.test.ts` (D2 table), `ui/PipelineDetailPage.columnOrder.test.tsx` (page-level, CR2/CR3, flash)
- Removed vs cycle 1: `useDraftStepProjection`, `draftProjection` (+tests), `StepPreviewTable.columnOrder.test.tsx`; `useDraftNodeCapabilities`, `outputSheetDraft`, `useOutputSheetNode`, `PipelineDetailDialogs`, `PipelineDetailPage.draftMode.test.tsx` are identical to main (verified with git diff e83f216b0).

## D2 audit: client handler output order vs the server analyze (`*SchemaInference.scala`)

| op | client order | server analyze order | result |
|---|---|---|---|
| rename | in place, folded renames (chains follow the client fold: `a->b,b->c` ends `c`; server does one lookup per column) | each column mapped in place | FIXED (was: renamed key moved to the end); collision keeps the earlier position (server: first occurrence); chain naming = disclosed difference |
| select | input row order filtered | input schema filtered | match (test) |
| filter / sort / limit / dedupe / assert / upsertsource / fillnull | pass-through | input schema | match (test) |
| cast | keeps order | keeps order | match (test); a cast of an absent column adds a column on the client (runtime behavior, not order) |
| compute | existing name keeps position, new appended | always appended (duplicate shown once, first occurrence) | match (test) |
| datebucket | was: existing output column kept its place | `filterNot(name) :+ name` (to the end) | FIXED |
| window | was: kept place | to the end | FIXED |
| stringops | was: kept place | to the end | FIXED |
| splittext | field in place; index field kept place | field in place; index `filterNot :+` | FIXED (index to the end) |
| extractheadings | index/level kept place | index, level `filterNot :+` | FIXED |
| unpivot | ids, var, value; a colliding var/value name kept the id's place | `filterNot :+` | FIXED |
| groupby / aggregate | group columns, then computed | same | match (test) |
| pivot | index columns, then value columns in Scala group order | index columns only (value columns unknown to analyze) | match for index; value columns follow the frame's own order (D3a dense rule), disclosed |
| join / lookup | left row, then right/looked-up columns in the secondary's key order (declared order after D1) | input ++ secondary mapped, in secondary schema order | match once the secondary is re-keyed (D1); needs the source's declared order |
| union (byName / byPosition) | this lane, then the other's new columns | input ++ secondary's new columns | match (byName test); byPosition with differing keys = sparse rule |
| chunkbytokencount / convertformat / AI ops | server-resolved (D3b) | n/a | D3b |

Known deviations (disclosed for the PR): rename chain/collision naming follows the client fold; pivot value columns follow the frame's own order; a source the caller does not own and the saved analyze does not describe is shown in code-unit order; column names that are integer-like (`"1"`, `"2024"`) are always first in a JS object and so can not be placed by any re-key; the server's NDJSON `step`-line `schema` stays hash order (possible server-side follow-up). Optional HEL-1705 extras (5.x of cycle 1) deferred; the backend `DraftPreviewPlanner` double resolve is deferred.

Measured: re-keying 1,000 rows x 20 columns takes 2.0-6.5 ms per sample/order change (first run 6.5 ms), once per sample or order change, never per edit (`.concertino/scratch/HEL-1732/perf-reorder-1000x20.txt`).

## Declared files (full paths)

- `frontend/src/features/pipelines/evaluator/steps/cast.ts`
- `frontend/src/features/pipelines/evaluator/steps/columnOrder.test.ts`
- `frontend/src/features/pipelines/evaluator/steps/rowOps.ts`
- `frontend/src/features/pipelines/evaluator/steps/splitText.ts`
- `frontend/src/features/pipelines/evaluator/steps/stringOps.ts`
- `frontend/src/features/pipelines/evaluator/steps/window.ts`
- `frontend/src/features/pipelines/evaluator/value.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.keys.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftFrames.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftPresentation.ts`
- `frontend/src/features/pipelines/state/draftColumnOrder.test.ts`
- `frontend/src/features/pipelines/state/draftColumnOrder.ts`
- `frontend/src/features/pipelines/state/draftStepView.test.ts`
- `frontend/src/features/pipelines/state/draftStepView.ts`
- `frontend/src/features/pipelines/state/inputFrameOrder.test.ts`
- `frontend/src/features/pipelines/state/inputFrameOrder.ts`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.columnOrder.test.tsx`
- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.tsx`
