# HEL-188 — Pipeline operation: Rename field

## Title
Pipeline operation: Rename field

## Description
Step type: rename a source field to a canonical output name. UI: field picker (from previous step's output) + text input for the new name. Multiple renames can be configured in a single step.

## Acceptance Criteria
- Backend: extend the op enum/`allowedOps` with "rename" if not already; add `applyRename` in InProcessPipelineEngine; tests for rename including missing-source-field, no-op empty, multiple renames
- Frontend: add OP_TYPES entry; `RenameFieldsConfig` component sourcing fields from analyze; persist config via `updatePipelineStep` (use the real backend ID, not the local step-N counter)
- Seed initial config with `'{"mappings":[]}'` (or whatever the agreed config shape is — check HEL-233 inference rule for `rename` to align)
- Hydrate config from persisted step on reload
- No new schema entries unless the op contract truly changes

## Context

### Precedent: HEL-187 (Select fields — just shipped)
HEL-187 implemented the "select" pipeline operation. Follow its exact pattern for the rename operation.

### Analyze endpoint (HEL-233)
The analyze endpoint (`POST /api/pipelines/:id/analyze`) exposes inferred per-step input/output schemas. The inference rule for `rename` is already implemented in `PipelineAnalyzeService`. The frontend uses `useAnalyzePipeline` hook to get per-step schemas. Use the analyze response for the field picker — do NOT depend on `runResult`.

### Config shape alignment
The config JSON for rename steps must align with what `PipelineAnalyzeService` expects in its `rename` inference rule. Read `PipelineAnalyzeService` to see the exact field names used when parsing rename config, and use those same field names in:
1. `applyRename` in `InProcessPipelineEngine`
2. `RenameFieldsConfig` React component (when persisting via `updatePipelineStep`)
3. The seed default config string

### Pattern from HEL-187 (Select fields)
- Backend: op in allowedOps set, `applySelect` in InProcessPipelineEngine
- Frontend: OP_TYPES entry with label + icon + config component; config component reads fields from analyze hook
- The config component receives `stepId` (real backend ID), `pipelineId`, and `analyzeResult` as props

## Related Issues
- Parent: HEL-141 (Pipeline v1 epic)
- HEL-187: Select fields (just shipped — primary pattern reference)
- HEL-233: Analyze endpoint (provides per-step schemas used by field picker)
