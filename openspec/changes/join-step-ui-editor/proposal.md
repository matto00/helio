## Why

`join` runs end-to-end on the backend, and agents already author it. The pipeline UI cannot create it,
though: the backend catalog marks it unauthorable and no `JoinConfig.tsx` editor exists. A user who needs
a key-based join has no path short of asking an agent. HEL-950 has removed the last blocker, the 404 on an
empty seed id.

## What Changes

- Backend: `JoinStep.companion` stops declaring `authorable = false`, so the catalog offers join in the
  palette. Only `groupby` stays unauthorable.
- Frontend: new `JoinConfig.tsx`, composed of three controls:
  - `SecondaryInputPicker`: right input, a data source or another lane
  - a join-key `Select` over the step's input schema
  - an inner/left join-type toggle
- Frontend: wire it through `useStepCardState` and `StepOpEditor`, persisting exactly
  `{secondaryInput, joinKey, joinType}`.
- Frontend: add `join` to `OP_TYPES`, retire `JOIN_OP_TYPE` and its `pipelineStepToStep` special case, and
  rewrite the stale exclusion comment.
- A shared fixture `shared-test-fixtures/join-step-config.json` is read by frontend Jest, backend
  ScalaTest, and helio-mcp tests. These form the client/server seam test.
- helio-mcp `add_pipeline_step` documents the join config shape. Today it lists `join` but gives no shape.
- An e2e spec builds a join through the UI and runs it.

## Capabilities

### New Capabilities
- `pipeline-join-step-editor`: the join step is authorable from the pipeline UI through a dedicated
  editor whose persisted config round-trips identically with backend and agent authoring.

### Modified Capabilities
- None. `pipeline-step-catalog-api`'s authorability requirement is generic ("unauthorable only if no
  authoring surface exists") and still holds. Join gaining a surface satisfies it without changing it.

## Impact

- `backend/.../domain/steps/JoinStep.scala`, plus the catalog specs that pin the unauthorable set.
- `frontend/src/features/pipelines/` (`stepNarrowing.ts`, `useStepCardState.ts`, `StepOpEditor.tsx`,
  `stepConfigs/JoinConfig.tsx`) and the tests that used join as the "no editor" fallback fixture.
- `helio-mcp/src/tools/write.ts` (description text only), `shared-test-fixtures/`, `e2e/`.
- No migration, no API shape change, no new dependency.

## Non-goals

- `groupby` authorability (HEL-1142, v0.9). It has the same pattern and is only noted here.
- New join types (right/full/cross), multi-key joins, and right-schema fetching for the key picker.
- HEL-1251 (case-sensitive collision rename).
- Sources "Used by" or reference-finder changes (HEL-1258), and dashboard layout (HEL-1230).
