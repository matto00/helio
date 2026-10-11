## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `4d11b0ac60ce00aac128565926d6e52c7ac20337`. Diff base, resolved live: `5dceeae9d11ca1b0a8891ad31f0a2c4397b92521`.
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1307/evidence/evaluator/`.

### Phase 1: Spec Review — FAIL

AC coverage, checked on the running app and by my own gate runs:
- AC1: a metric with rules renders in the token colour in both themes. **PASS.** The computed colour of every
  `.panel-content__metric-figure` equals the resolved `--app-<tone>` probe. Light: error rgb(175,51,37),
  warning rgb(133,85,26), success rgb(22,109,67). Dark: rgb(241,123,103), rgb(245,185,68), rgb(76,195,138).
  The executor's e2e also passed when I re-ran it (`eval-e2e.txt`, 2/2).
- AC2: table cell and row rules apply per column and per row. **PASS.** Each cell carries exactly one wash.
  The pinned cell is `linear-gradient(<error-surface>), none` over the opaque panel surface. A cell rule inside
  a washed row replaces the row wash. The `<tr>` itself is unpainted. The ` Failed ` text match works.
- AC3: invalid rules are rejected and no-rules rendering is unchanged. **PASS.** Backend specs and the
  frontend DOM-identity tests are green, and mutation m15 (always wrap the figure) kills 11 tests.
- Owner rulings 1-6: honoured (first match wins; tone text vs wash; 3 tokens only; glyph + label/sr text; table
  `column`/`target`; delta untouched).
- Constraints:
  - C1 (red first): see the mutation table under Phase 2. 21 of 22 behaviour mutations are killed. One new code
    path is not exercised (CR1).
  - C2 (seam): honoured. The backend half drives the real `OutputRoutes` create/PATCH/GET. The frontend half
    drives the real `OutputEditorSheet` with only `httpClient` mocked. The fixture's invalid cases run through
    both the backend and `validateConditionalFormatRule`.
  - C3 (no-rules unchanged): honoured. The one edited snapshot (`OutputEditorSheet.openingState`, +1
    `Add rule` line per kind) is called out in files-modified.md and is the expected addition of a new section.
  - C4 (running app): honoured. I added my own 1440/768/375 screenshots in both themes, including the editor
    at 375px.
  - C5 (CSS proven by computed styles): honoured.

Issues:
1. **design.md D7 does not match the implementation.** D7 says the editor is "Built from `FormField`, `Select`,
   `TextField`, `IconButton`". `ConditionalFormatsField.tsx` never uses `FormField` and hand-rolls the error row
   instead (see CR2). The planning artifact must match the shipped behaviour.
2. **Task 3.6 claims both `buildOutputConfig` paths are verified, but the aggregate-tail path is not exercised**
   (CR1).

### Phase 2: Code Review — FAIL

Gates I ran fresh in `WORKTREE_PATH` (logs in `evidence/evaluator/`):

| Gate | Result |
|---|---|
| `npm run lint` | EXIT 0 |
| `npm run format:check` | EXIT 0 |
| `npm run typecheck` | EXIT 0 |
| `npm test` (root jest incl. `helio-mcp/src/server.test.ts`, then frontend: 513 suites / 5564 tests) | EXIT 0 |
| `npm --prefix frontend run build` | EXIT 0 |
| `npm run check:schemas`, `check:tokens`, `check:e2e-types`, `check:helio-mcp-types` | EXIT 0 |
| `check:scala-quality` | pass |
| `cd backend && sbt testFull` (nice 19, -Xmx3g) | 6690 succeeded, 0 failed, EXIT 0 |

All ten HEL-1307 backend specs appear in that output: unit, seam, write paths, rollback exemption, single-call
and grounding.

Mutation check (C1). I made these in a throwaway detached worktree at the reviewed SHA, which I have since
removed. The diffs and outputs are in `evidence/evaluator/mutations/`.

| Mutation | Result |
|---|---|
| m01: `between` exclusive | killed |
| m02: last match wins | killed |
| m03: case-sensitive `eq` | killed |
| m04: empty value matches `neq` | killed |
| m05: `eq` never numeric | killed |
| m06: tolerant reader skips validation | killed |
| m07: metric evaluated on the formatted value | killed |
| m08: tone class on the outer value span (unit GUARD) | killed |
| m09: cell resolver ignores `target` | killed |
| m10: row mark on the rule column instead of the first visible one | killed |
| m11: row rule drops the caller's `rowClassName` | killed |
| m12: no cell class | killed |
| m13: no row mark | killed |
| m14: collection does not forward rules | killed |
| m15: metric always wraps the figure | killed |
| m16: glyphs share a shape | killed |
| m17: DataGrid drops `cellClassName` | killed |
| e1: `eq` always text | killed |
| e2: empty label sent | killed |
| e3: always emit the key | killed |
| e4: no `[]` clear | killed |
| e5: reorder is a no-op | killed |
| e6: Save not blocked | killed |
| e8: preview ignores unsaved rules | killed |
| **e7: drop `...conditionalFormatsEntry(params)` from `buildAggregateTailConfigs`** | **SURVIVES** (228/228 green) |

So the frontend compile-error reds (evaluator, metric renderer, readers, table) are backed by behaviour-failable
tests, with the single exception of e7.

Checklist:
- Canonical code quality (CONTRIBUTING): no inline FQNs, imports clean. `TableRenderer.tsx` (900 lines) and
  `DataGrid.tsx` (1295) grew by 15 and 8 lines. The logic was correctly extracted to `tableConditionalFormats.tsx`
  per D6, but CONTRIBUTING asks the PR description to propose a split for >400-line files (non-blocking).
- Design standard, [mechanical]:
  - Passing: tokens only (`check:tokens` OK); no literal colours; spacing uses `--space-*`; icon sizes use
    `ICON_SIZE`; `IconButton`s carry `aria-label`.
  - **Violation:** DESIGN.md §6 "Use these; do not hand-roll equivalents [mechanical]". See CR2.
- DRY / modular: the evaluator is pure and shared by all three renderers, and the editor reuses it.
  `validateConditionalFormatRule` mirrors the Scala validator and both are pinned by the shared fixture.
- Type safety: `as unknown as ConditionalFormatRule[]` in `useOutputConditionalFormats.ts:334/339` and
  `conditionalFormatting.ts:215` are documented (wire shape after validation). Acceptable.
- Security / error handling: validation sits at every write boundary. The rollback exemption is gated on
  `RestorePriorStored` and tested.
- Tests meaningful: yes, except CR1.
- No dead code / over-engineering: none found.

Issues: CR1, CR2.

### Phase 3: UI Review — PASS

Servers ran via `start-servers.sh` on 6739/9646 (`assert-phase servers` PASS). I created test data through the
API and deleted it by exact id (all 204); the ids are in `created-ids.json`.

- Happy path: metric (error/warning/success, labelled and unlabelled), collection per-item tones, and table
  cell, row, pinned, and cell-in-row. The tooltip and sr text are correct ("Too slow", "Critical", "Warning",
  "Good").
- Long toned cells still ellipsise (`text-overflow: ellipsis`, `scrollWidth > clientWidth`).
- Editor: the section renders for table with stored rules (5 rules round-trip into the UI). Add rule produces an
  inline error and Save becomes disabled. At 375px no control overflows (0 elements outside the viewport).
- Console: no errors on the dashboard flows. The pipeline page shows a 404 on `/schedule` for a pipeline with no
  schedule; that is unrelated to this change.
- Breakpoints: 1440, 768 and 375 in both themes render with no clipped figures or broken layout.
- Accessibility: the glyph is `aria-hidden`, the sr-only label is read with the value, and the editor controls
  have accessible names (`Rule n column/condition/value/tone/applies to/label`, `Move rule n up/down`,
  `Remove rule n`).

Screenshots:
- `evidence/evaluator/eval-light-1440.png` (actually rendered in dark; the theme had not been set yet)
- `eval-dark-1440-table.png`, `eval-light-1440-table.png`, `eval-light-1440-table-scrolled.png`
- `eval-light-375.png`, `eval-light-375-table.png`, `eval-dark-375-table.png`, `eval-dark-768.png`
- `eval-dark-375-editor.png`, `eval-dark-1440-editor.png`, `eval-dark-1440-editor-addrule.png`

These are cited as illustration. The load-bearing colour and wash claims rest on the computed-style values
quoted above, which are self-authenticating.

Issues: none blocking (see suggestions).

### Overall: FAIL

### Change Requests
1. **CR1: exercise the aggregate-tail `conditionalFormats` emission.**
   `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts:265`
   (`...conditionalFormatsEntry(params)` inside `buildAggregateTailConfigs`) can be deleted with every test
   still green (mutation e7). Add a test, in `buildOutputConfig.test.ts` or an editor test that uses "Add tail
   with aggregate", asserting three things:
   (a) a metric with rules produces `outputConfig.conditionalFormats` equal to the rules;
   (b) no rules and nothing stored produces no key;
   (c) stored rules that were all removed produce `[]`.
   Run it red against the e7 mutation and keep that output in the run evidence dir.
2. **CR2: use the shared error primitive, not FormField's private class.**
   `frontend/src/features/pipelines/ui/outputEditor/ConditionalFormatsField.tsx:183-187` hand-rolls
   `<p role="alert" className="ui-form-field__error conditional-formats__error">`. This borrows `FormField`'s
   internal error class, which DESIGN.md §6 forbids as a hand-rolled equivalent.
   - Render the rule error with `InlineError` from `shared/chrome/InlineError` (default `text` variant, passing
     `id`).
   - Point the invalid control's `aria-describedby` at that id.
   - Keep `.conditional-formats__error` only for layout (`flex: 1 0 100%`) if it is still needed.
   - Update design.md D7's primitive list to name what is actually used (it currently claims `FormField`).

### Non-blocking Suggestions
- **Editor UX (skeptic's call):**
  - Clicking "Add rule" immediately shows "Rule n: value must be a finite number" in a `role="alert"` before the
    author has typed anything. Consider showing the error only after the field is touched, or only when Save is
    attempted.
  - The error copy is the server's wording ("finite number").
  - `aria-invalid` is set on the value inputs for any rule error, including label-only errors.
  - In the rule row, `Select` controls are taller than `TextField`s.
  - The value and label inputs have no visible label once filled.
- **PR description:** propose the split of `TableRenderer.tsx` / `DataGrid.tsx`, per CONTRIBUTING's rule for
  files over 400 lines.
- **Patch-set apply:** only the preview and the PATCH route are tested directly. Apply goes through the same
  `validateConfig(ValidateWrite)`, so it is covered by reasoning; an explicit apply test would close it.
- **Re-renders:** `OutputPanelContent` re-reads `readTableConfig(output.config)` on every render, so
  `withCellRules`/`withRowRules` rebuild each render. This matches the existing `columnFormats` precedent and is
  cheap at panel row counts.
- **Leftover test users:** the e2e leaves throwaway `hel1307-*@example.test` users behind (shared `registerAndLogin`
  behaviour); so does this evaluation (`hel1307-eval-1791706767718@example.test`, no data left under it).
