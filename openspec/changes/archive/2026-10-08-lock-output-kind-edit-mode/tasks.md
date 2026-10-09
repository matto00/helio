## Standing Constraints

## 1. Frontend

- [x] 1.1 In `OutputEditorSheet.tsx`, pass `disabled={!isCreate}` to the Kind `Select` and render, only when `!isCreate`, a `<p id={kindHintId} className="output-editor-sheet__field-hint">` with the design.md copy, wired via `ariaDescribedBy`; verify with `npm run typecheck` and `npm run lint`
- [x] 1.2 Update the `buildEditConfig` comment to state kind is fixed in edit mode (HEL-1388); verify `npm run lint`

## 2. Tests

- [x] 2.1 Add tests: edit mode renders Kind disabled with stored label and accessible description = reason; clicking it opens no listbox; it is skipped by a `userEvent.tab()` walk (assert `toBeDisabled()` too — jsdom `tabIndex` alone proves nothing); verify `npm test -- --testPathPatterns=OutputEditorSheet`
- [x] 2.2 Add test: create mode Kind is enabled, has no reason/description, and selecting `table` swaps to the table option group; verify same command
- [x] 2.3 Mutation check: remove `disabled={!isCreate}` locally and confirm 2.1 fails, then restore; record in commit/report
- [x] 2.4 Grep existing OutputEditorSheet tests for edit-mode kind switching; move to create mode or justify; verify full `npm test` passes
- [x] 2.5 Running-app check in light and dark themes: edit sheet (Kind disabled + reason) and create sheet; screenshots into the worktree/run evidence dir only
