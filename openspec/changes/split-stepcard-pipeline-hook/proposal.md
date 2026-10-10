## Why

`StepCard.tsx` (508 lines) and `usePipelineDetailPage.ts` (1443 lines) are far over CONTRIBUTING's ~250-line soft budget, which makes the pipeline editor costly to review and change. Two small defects ride along from HEL-1414: every lookup card renders the same `id="lookup-key"` (invalid DOM, broken label association once two lookups exist), and the lookup analyze warnings call the keys "source key"/"lookup key" while the card labels them "Match on field"/"Reference match field".

## What Changes

- Split `StepCard.tsx` into focused modules (props type, header, warnings region, preview tray), behaviour-preserving.
- Split `usePipelineDetailPage.ts` by extracting contiguous clusters into sub-hooks called in place (analyze scheduling, analyze lookups, step-structure creation/sync handlers, step mutation handlers), behaviour-preserving; the remainder (load/SSE wiring, outputs/sheet handlers, run/save/cancel) and `useStepCardState.ts` (602 lines) are filed as a follow-up ticket.
- Make the lookup "Reference match field" input id unique per step card (derived via `useId`), with its label pointing at it.
- Reword the lookup analyze warnings to use the card's own field labels.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-analyze-schema-warnings`: lookup warning messages name keys using the lookup editor's labels.
- `pipeline-lookup-op`: the lookup editor's controls have per-step-unique ids.

## Impact

- Frontend: `frontend/src/features/pipelines/ui/StepCard.tsx` (+ new sibling modules), `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` (+ new sibling sub-hooks), `frontend/src/features/pipelines/ui/stepConfigs/LookupConfig.tsx`.
- Backend: `backend/src/main/scala/com/helio/domain/engine/AnalyzeSchemaWarnings.scala` message text only (codes unchanged); its spec tests.
- No API shape, schema, or migration change. Warning `code` values unchanged; only `message` text for lookup.
