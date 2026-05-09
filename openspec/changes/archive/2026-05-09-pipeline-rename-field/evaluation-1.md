## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:
- **Spec violation — clear does not remove key**: The spec (`specs/pipeline-rename-op/spec.md`) explicitly requires: *"If the user clears the text input (empty string), the rename for that field SHALL be removed from the persisted config."* The scenario reads: *"WHEN the user clears the text input for field `price` (previously renamed to `cost`) THEN the step config is patched with `renames` that does not contain the `price` key."* The implementation in `handleRenameChange` (`PipelineDetailPage.tsx:234`) does `const next = { ...renames, [field]: newName }` — which always sets the key regardless of whether `newName` is empty. Confirmed live: clearing the profit field PATCHes `{"renames":{"profit":""}}` instead of `{"renames":{}}`.
- **Missing test coverage for this scenario**: `PipelineDetailPage.test.tsx` has no test case that verifies clearing a rename input removes the key from the persisted config. The `RenameFieldsConfig.test.tsx` correctly verifies `onChange` is called with an empty string, but the integration-level handler that should delete the key is neither implemented correctly nor tested.
- All other AC are addressed: backend applyRename uses `{"renames":{}}` map shape, all three backend test cases present (multiple renames, missing source field, empty map), OP_TYPES entry added, RenameFieldsConfig component sources from analyze endpoint, initial config `'{"renames":{}}'` set in handleAddStep, hydration implemented, real backend step ID used.

### Phase 2: Code Review — FAIL

Issues:
- **`handleRenameChange` always spreads — never deletes (`PipelineDetailPage.tsx:234`)**: `const next = { ...renames, [field]: newName }` assigns the key unconditionally. When `newName` is `""`, the key should be deleted to match the spec. Fix: `const next = { ...renames }; if (newName) { next[field] = newName; } else { delete next[field]; }`.
- **No PipelineDetailPage test for clear → key-removal**: The test suite has three describe blocks for the rename round-trip but none exercises the clear-removes-key path. A test along the lines of: set a rename, clear the input, assert `updatePipelineStep` is called with a config that does not contain the field key.

All other code quality checks pass:
- DRY: `RenameFieldsConfig` correctly mirrors `SelectFieldsConfig` pattern; `parseRenames` mirrors `parseSelectedFields`.
- Readable: naming is clear (`renames`, `parseRenames`, `handleRenameChange`).
- Modular: component in its own file, props interface documented.
- Type safety: no `any`; `Record<string, string>` for renames map is precise.
- Error handling: `parseRenames` has try/catch; `handleRenameChange` has `.catch(() => {})` with a comment.
- Backend fix is minimal and correct: replaces `mappings` array with map shape in one targeted change.
- No dead code or unused imports.

### Phase 3: UI Review — PASS

Checks performed (base URL: `http://localhost:5361`):

- **Happy path**: Added a Rename column step to an existing pipeline. After page reload the step card expanded and showed two rows (`date`, `profit`) sourced from the analyze endpoint's `inputSchema`. Inputs have correct `aria-label` (`"New name for date"`, `"New name for profit"`) and placeholder text.
- **PATCH on change**: Typing `testval` into the profit input issued `PATCH /api/pipeline-steps/:id` with `{"config":"{\"renames\":{\"profit\":\"testval\"}}"}`. Correct.
- **Empty table state**: Immediately after creation (before analyze response arrives), the table renders with 0 rows and no "run the pipeline first" prompt — correct per spec.
- **Hydration on reload**: Navigated away and back; persisted rename mapping was correctly pre-filled.
- **No console errors or warnings** during any flow.
- **Visual consistency**: Table header ("Source field" / "New name"), dark card styling, and button placement are consistent with existing SelectFieldsConfig and the design system.
- **ARIA**: Table has `aria-label="Rename fields"`; each input has `aria-label={New name for <col>}`.

One confirmed spec violation observed in the UI: clearing an input PATCHes `{"renames":{"profit":""}}` instead of `{"renames":{}}` (key not removed). Marked as FAIL in Phase 1/2 — the UI works but persists incorrect state.

### Overall: FAIL

### Change Requests

1. **Fix `handleRenameChange` to remove the key when `newName` is empty** (`frontend/src/components/PipelineDetailPage.tsx`, line 234):

   Replace:
   ```ts
   const next = { ...renames, [field]: newName };
   ```
   With:
   ```ts
   const next = { ...renames };
   if (newName) {
     next[field] = newName;
   } else {
     delete next[field];
   }
   ```
   This aligns with the spec requirement that clearing a text input removes the field from the persisted `renames` map.

2. **Add a `PipelineDetailPage.test.tsx` test for the clear-removes-key scenario** — add a test case in the `"PipelineDetailPage rename step config"` describe block that:
   - Starts with a persisted step config `'{"renames":{"name":"full_name"}}'`
   - Expands the step card and confirms the `"New name for name"` input has value `"full_name"`
   - Fires `fireEvent.change` to set it to `""`
   - Asserts `updatePipelineStepMock` was called with a config string that does **not** contain the `"name"` key (e.g. `expect.not.stringContaining('"name"')` or assert the parsed config has no `name` key).

### Non-blocking Suggestions

- `openspec/specs/pipeline-rename-op/spec.md` has `## Purpose\nTBD - created by archiving change pipeline-rename-field. Update Purpose after archive.` — the TBD placeholder should be filled in with a brief purpose statement now that the feature is complete.
