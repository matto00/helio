## Why

The rename pipeline op exists in the backend enum and analyze service but lacks a working execution
engine implementation and a frontend config UI. Users cannot currently configure or execute rename
steps end-to-end.

## What Changes

- Fix `applyRename` in `InProcessPipelineEngine` to use the `{"renames": {"from": "to"}}` config shape
  that `PipelineAnalyzeService.inferRename` already expects (the existing implementation uses a
  different `mappings` array shape — aligning these is the critical correctness fix)
- Add `RenameFieldsConfig` React component: a table of (field picker → text input for new name) rows
  driven by the analyze endpoint's `inputSchema`, sourced via `useAnalyzePipeline`
- Wire rename into `PipelineDetailPage`: initial config `'{"renames":{}}'`, hydration from persisted
  step, and `updatePipelineStep` on change
- Add backend tests: multiple renames, missing source field (no-op), empty renames map
- Add frontend tests: renders field picker rows, dispatches config PATCH on change, hydrates from config

## Capabilities

### New Capabilities
- `pipeline-rename-op`: End-to-end rename pipeline operation — engine execution + frontend config UI

### Modified Capabilities
(none — allowedOps already includes "rename"; no spec-level API contract changes)

## Non-goals

- No new REST endpoints
- No changes to schema files (rename op uses the same pipeline_steps contract as all other ops)
- No Spark/batch path for rename (in-process engine only, consistent with HEL-187)

## Impact

- `InProcessPipelineEngine.scala` — fix `applyRename` config parsing
- `InProcessPipelineEngineSpec.scala` — add rename test cases
- `frontend/src/components/RenameFieldsConfig.tsx` — new component
- `frontend/src/components/RenameFieldsConfig.test.tsx` — new test file
- `frontend/src/components/PipelineDetailPage.tsx` — wire rename config UI and initial config
- `frontend/src/components/PipelineDetailPage.test.tsx` — extend tests for rename
