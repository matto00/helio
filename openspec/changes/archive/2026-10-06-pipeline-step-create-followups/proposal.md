## Why

HEL-1321 left four follow-ups in the pipeline editor's step-create path: an untested `renderKey` carry in
`handleReorderSteps`, a ~1600-line `usePipelineDetailPage.ts` whose step-create/draft logic has grown into its own
concern, and two pre-existing draft bugs (an in-flight draft's input-field select shows its placeholder; a draft created
at an insert position never resyncs, so server-reparented siblings stay stale on screen). Item 4 moved to HEL-1345
(owner ruling): its premise rests on a confirmed backend placement defect that HEL-1345 fixes first.

## What Changes

- Commit HEL-1321's evaluator reorder probe as an RTL test that pins the `renderKey` carry.
- Extract step-create and draft logic into a new `usePipelineStepCreation` hook, behaviour-preserving.
- Fix: an in-flight draft's field picker keeps resolving its anchor schema, so the select shows the chosen field.

## Non-goals

- HEL-1340 item 4 (insert-draft resync) and the backend `rootId` placement defect: both moved to HEL-1345.
- HEL-1340 item 5 (moving HEL-1294's create-immediately paths onto the stable-key mechanism and dropping the
  disable-expand workaround). It needs an owner ruling.
- Any backend change, any other splitting of `usePipelineDetailPage.ts`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-ai-step-authoring`: an in-flight draft keeps its field picker's anchor schema.

## Impact

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`, new
  `frontend/src/features/pipelines/hooks/usePipelineStepCreation.ts`.
- Tests under `frontend/src/features/pipelines/ui/` (new tests only; existing tests unmodified).
- No API, schema or backend change.
