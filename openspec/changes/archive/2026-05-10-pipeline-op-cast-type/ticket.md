# HEL-189 — Pipeline operation: Cast type

## Title
Pipeline operation: Cast type

## Description
Step type: override the inferred type for one or more fields (e.g. string → number, string → date).
UI: field picker + target type dropdown.
Backend validates that the cast is possible on the source data and surfaces cast errors in the preview.

## Acceptance Criteria

### Backend
- Extend op enum / `allowedOps` with "cast" if not already present
- Add `applyCast` in `InProcessPipelineEngine`
- Backend tests: missing source field, unsupported cast, valid casts (string→number, string→date, etc.), no-op empty config

### Frontend
- Add OP_TYPES entry for "cast"
- `CastFieldsConfig` component: table of source field + target type dropdown rows
- Field options come from analyze `inputSchema` (NOT from `runResult`)
- Multi-row UX similar to `RenameFieldsConfig`
- Seed initial config matching what `inferCast` expects (verify against `PipelineAnalyzeService.inferCast`)
- Hydrate config from persisted step on reload
- Persist via `updatePipelineStep` using the real backend ID

### Cast Errors
- `inferCast` produces the new `outputSchema` unconditionally (declared target type)
- `applyCast` raises errors during run when a cast is invalid at runtime
- Surface cast errors in the preview/run output

## Sibling Precedents
- HEL-187 (Select), HEL-188 (Rename): backend `apply<Op>` + frontend `<Op>FieldsConfig` reading from `useAnalyzePipeline`
- HEL-233: analyze endpoint with inference rules for ALL 8 ops including `cast`
- HEL-188 lesson: verify `applyRename`/`inferRename` config shape alignment — do the same here for `applyCast`/`inferCast`

## Notes
- Pre-commit hooks: `npm run check:openspec`, `npm run check:schemas`
- Before `openspec archive`: `rm -f openspec/changes/<CHANGE_NAME>/files-modified.md`
- Cycle budget: 3
