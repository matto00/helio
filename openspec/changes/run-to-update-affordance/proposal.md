## Why

A dataset write whose downstream pipeline fails the auto-run cheapness verdict (HEL-1092/1093)
currently does nothing visible: the denial is logged server-side and discarded. HEL-1096's AC
requires the user see the specific denying rule and be offered a manual run instead.

## What Changes

- `AutoRunTriggerService`'s per-pipeline verdict, currently fire-and-forget, is awaited by
  `DataSourceService.appendFormRow`/`appendRows`/`replaceRows`/`patchRow` and its DENIED entries
  (pipelineId, name, reasons, `canRun`), filtered to pipelines the writer has visibility into, are
  returned in each method's response. `deleteRow` (`204 No Content`, consumed by `helio-mcp`'s
  `deleteDatasetRow`) is deliberately excluded — changing its contract would be a breaking API
  change; it keeps logging denials only, unchanged. ALLOWED-pipeline debounce-scheduling behavior is
  unchanged everywhere.
- The frontend pushes one toast per write, listing every denied downstream pipeline's specific
  reason via a hand-maintained `CostReason.code` → copy mapping, with a "Run to update" action when
  exactly one pipeline was denied and the caller `canRun`. The toast never auto-dismisses while it
  carries that action (`duration: 0`, the existing sticky-toast pattern).
- `PipelineService.analyze`'s response gains `costVerdict.canRun` (owner-or-editor-grantee, mirroring
  `PipelineRunService.submit`'s own check); the pipeline detail page renders the existing
  `costVerdict.reasons` (already fetched, unused today) with the same copy mapping and a "Run to
  update" button gated on `canRun`.
- Both surfaces' manual run goes through the existing `POST /api/pipelines/:id/run`; a guard
  rejection (HEL-505, 429 + `Retry-After`) renders its own distinct message, never the gate-denial
  copy. A successful run's refresh reuses the existing SSE fan-out (HEL-1094/1168) unmodified.

## Capabilities

### New Capabilities
- `run-to-update-affordance`: the toast + pipeline-page manual-run UI, the deny-reason copy mapping,
  and the guard-rejection-vs-gate-denial distinction.

### Modified Capabilities
- `dataset-write-auto-run`: a denied pipeline's reason(s) must now be RETURNED in the write response
  (not merely logged), alongside a `canRun` flag for the writing user.
- `pipeline-analyze-api`: `costVerdict` gains a `canRun` field.

## Impact

Backend: `AutoRunTriggerService`, `DataSourceService.appendFormRow`/`appendRows`/`replaceRows`/
`patchRow` (NOT `deleteRow` — see design.md Non-Goals), `RowWriteResult`/`RowWriteResponse`,
`RowResponse`, `PipelineCostEstimator`-adjacent protocols, `PipelineService.analyze`,
`schemas/sources/row-write-response.schema.json`, `schemas/sources/row-response.schema.json`.
Frontend: `panelService.ts`/`FormPanelView.tsx` (toast push on denied submit), a new
deny-copy-mapping module, `PipelineDetailFooter.tsx`/`usePipelineDetailPage.ts` (render
`costVerdict.reasons` + manual-run button), `pipelineStep.ts`/`dataSource.ts` types. No migration
required (no new persisted state — verdicts are recomputed, never stored). Standalone follow-up
filed: HEL-1171 (delete-triggered denial surfacing, deferred).
