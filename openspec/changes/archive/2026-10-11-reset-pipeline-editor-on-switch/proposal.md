## Why

Switching from one pipeline to another in-app (sidebar, command palette, recents, back/forward) leaves the editor showing the previous pipeline's step cards, because `/pipelines/:id` reuses the same `PipelineDetailPage` instance and its local editor state (seeded once, guarded by `stepsInitialized`) is never reset for the new id. Stale cards on the wrong pipeline are confusing at best and, if edits or analyze calls are built from them, can write against the wrong pipeline.

## What Changes

- Confirm the root cause with a probe (red test and/or running-app transcript) before any fix.
- Make the pipeline editor's per-pipeline local state reset when the route `:id` changes, so the editor always reflects the current pipeline's persisted steps.
- Ensure no write or analyze request for pipeline A (pending debounce, in-flight request resolving late) can land on, or be built against, pipeline B after the switch; fix any such path found by the widened repro.
- Add a regression test that drives the in-app switch (red on base, green after), plus an e2e if unit tests cannot show it.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-editor-page`: adds a requirement that the editor's state is scoped to the current route pipeline id and does not carry over across an in-app pipeline switch.

## Impact

- Frontend only: `frontend/src/app/AppRoutes.tsx` and/or `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`, `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` and the sub-hooks holding per-pipeline state (`usePipelinePageLoad`, `usePipelineRunStream`, `usePipelineOutputSheets`, `useStepCardPersist`, ...), possibly `pipelinesSlice` if a late thunk resolution is found to overwrite the current pipeline.
- New/updated jest tests under `frontend/src/features/pipelines/`; possibly a Playwright e2e.
- No backend, schema or API change.
