## Why

The Output sheet offers a field/literal toggle on a markdown Output's Content slot. Choosing field mode persists `fieldMapping.content`, which the backend rejects with a 400 (Markdown has no slots) and which the renderer would ignore anyway. Owner ruled (HEL-1139): remove the dead affordance; bound narrative text is HEL-921's `insight` kind.

## What Changes

- Output sheet: markdown Content becomes a literal-only multiline editor (no field/literal toggle, no column picker).
- `buildOutputConfig` markdown case always emits `fieldMapping: {}` and literal `content`.
- A previously stored markdown `fieldMapping.content` is ignored on load (sheet opens in literal mode) and overwritten with `{}` on next save.
- Backend: the unknown-slot rejection for a slotless kind states that the kind has no fieldMapping slots (today it reads "Valid slots: " with nothing after it). Rejection behaviour itself is unchanged.
- helio-mcp tool descriptions state that `table`/`markdown` take no `fieldMapping`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: markdown Content is literal-only; no bound mode is offered.

## Impact

`frontend/src/features/pipelines/ui/outputEditor/{buildOutputConfig.ts,OutputKindFields.tsx,OutputEditorSheet.tsx}` and tests; `backend/.../domain/panels/OutputBindingSpec.scala` (message) and its spec; `helio-mcp/src/tools/outputs.ts` (description). No API shape, schema, or migration change.
