## Standing Constraints

(none yet)

## 1. Reproduce on main

- [x] 1.1 In a real browser against the worktree dev server, pick field mode for a markdown Output Content, save, capture the 400 and its message; confirm the renderer ignores `fieldMapping`. Verify: screenshot/network evidence recorded in the report.

## 2. Frontend

- [x] 2.1 Write failing tests first (sheet has no Content mode toggle for markdown; `buildOutputConfig` markdown emits `fieldMapping: {}`); run on main and record RED.
- [x] 2.2 Make `MarkdownKindFields` literal-only, drop field-mode state for markdown in `OutputEditorSheet`, simplify `buildOutputConfig` markdown case. Verify: tests green; `npm run lint`, `typecheck`, `format:check`, `npm test` pass.
- [x] 2.3 Legacy-config test: sheet opened on a markdown Output holding `fieldMapping.content` opens literal and saves `fieldMapping: {}`. Verify: test passes.
- [x] 2.4 Mutation: temporarily re-enable the mode; confirm the 2.1 tests fail; revert. Verify: record failing output.

## 3. Backend and agent surfaces

- [x] 3.1 Slotless-kind message in `OutputBindingSpec.validateFieldMapping`; spec in `OutputBindingSpecSpec` and a route test for 400 on markdown `fieldMapping.content`. Also assert a `table` mapping gets the same kind-parametrised wording, and fix the stale doc comment above `validateFieldMapping` ("not yet wired to a live HTTP route"). Verify: red then green with `sbt testOnly`.
- [x] 3.2 helio-mcp `outputs.ts` description sentence; per-surface enumeration with an actual rejected request per surface. Include the `PatchSetUndoService` restore path (bypasses validation, restores stored config) in the list. Verify: `helio-mcp` tests pass; report lists every surface and its handling.
- [x] 3.3 Full backend gate `cd backend && nice -n 19 sbt testFull`. Verify: green (name any HEL-1228/HEL-1215 flake).

## 4. Live verification

- [x] 4.1 After the change, in the running worktree app, both themes: Markdown Content has no toggle, literal save succeeds, panel renders it. Verify: screenshots, `readlink /proc/<pid>/cwd` shows the worktree.
