# Proposal: inline-step-output-preview

## Why

Pipeline authors currently get a bare "Preview data" toggle per step: rows only, no schema, and the
rows go stale the moment a config edit lands — the only refresh is closing and reopening the tray.
HEL-404 (epic HEL-339, Pipeline Authoring UX) makes the per-step preview inline and self-refreshing,
and surfaces the step's output schema next to the rows, so authors see what a step produces without
running the whole pipeline. The sibling schema-diff ticket (HEL-405) builds on the same
`analyze_pipeline` plumbing, so this lands first.

## What Changes

- `StepCard` preview tray shows the step's **output schema** (column name + type) alongside the
  existing sample rows (≤10). Schema comes client-side from the analyze endpoint's per-step
  `outputSchema` — already fetched and cached in `pipelinesSlice.analyzeResult`.
- The preview **refreshes automatically** (debounced) after a step-config edit settles, instead of
  requiring a manual close/reopen. Schema freshness rides the existing debounced re-analyze in
  `PipelineDetailPage`; row freshness re-fetches the existing preview endpoint.
- The preview feels **inline**: whether the tray is open persists as a per-user preference
  (localStorage, following the `theme.ts` storage-key precedent), so cards auto-open their preview
  when the user has opted in.
- Loading/error states reuse the existing preview handling.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-step-preview`: the frontend StepCard requirement grows: render output schema alongside
  rows; auto-refresh rows (debounced) after config edits; persist the open/closed preference
  per user. The backend preview-endpoint requirement is unchanged.

## Impact

- Frontend only: `StepCard.tsx`, `PipelineRiverView.tsx`, `PipelineDetailPage.tsx` (thread
  `outputSchema` down), plus CSS and tests. No wire/enum change, no backend change, no migration.
- Existing endpoints reused: `GET /api/pipelines/:id/steps/:stepId/preview`,
  `GET /api/pipelines/:id/analyze`.

## Non-goals

- Per-step schema **diff** visualization (input vs output) — sibling ticket HEL-405.
- Any backend extension of `previewStep` (schema is derivable client-side from analyze).
- Changing preview row cap, endpoint shape, or run semantics.
