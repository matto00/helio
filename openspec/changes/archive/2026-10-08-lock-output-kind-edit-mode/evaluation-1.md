## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `ca48e7cc555df8ec4e874f3d83201aded756767b` (base `6f2351e89d14e2e7ec0dd545476163f4d104a72d`, resolved live via `resolve-review-base.sh`).
Diff: `OutputEditorSheet.tsx` (+12/-2), new `OutputEditorSheet.kindLock.test.tsx` (122 lines), `tasks.md`, spec delta.

### Phase 1: Spec Review — PASS
- AC1 (Kind disabled in edit mode, with a short reason): met. `disabled={!isCreate}` plus a visible hint `<p id={kindHintId}>` wired through `ariaDescribedBy`, at `OutputEditorSheet.tsx:534-542`. "DESIGN.md disabled-state pattern" doesn't exist; the change follows the in-repo precedent (disabled control plus hint) as the premise note directed. The same sheet already does this for the History "Keep each run's rows" switch on the Free tier.
- AC2 (test: edit mode disabled, create mode unchanged): met by `OutputEditorSheet.kindLock.test.tsx`, which has 2 edit-mode tests and 1 create-mode test.
- No AC was reinterpreted. Supporting a real kind change was correctly not pursued; AC1's default is to disable.
- Tasks 1.1–2.4 match the implementation. Task 2.5 (running-app check) was left unchecked by the executor and is covered by this evaluation's Phase 3. The orchestrator should tick it from this report.
- Task 2.4: existing edit-mode kind-switch tests were checked. `OutputEditorSheet.test.tsx:203` (`renderSheet()` with no Output, so create mode) and `OutputEditorSheet.configPatch.test.tsx:306-318` (`renderSheet(null)`) are all create mode. Nothing needed to move.
- No scope creep. HEL-1430 items and the dangling `htmlFor="output-kind"` were left alone, as intended.
- Spec delta (`specs/.../pipeline-output-sheet`) matches the behavior: the switching scenario is scoped to create mode, and a new requirement plus 3 scenarios were added.
- No API or schema change; none needed.
- `workflow-state.md` `CONSTRAINTS: []`, so there is nothing to honor beyond the Iron Laws.

### Phase 2: Code Review — PASS
Gates, run fresh in the worktree (`nice -n 19`, jest `--maxWorkers=3`):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0. Root 42 suites / 407 tests. Frontend 481 suites / 5065 tests, 0 failures.
- `npm --prefix frontend run build`: exit 0

Mutation check, re-run by the evaluator in a throwaway detached worktree at `ca48e7cc` (created and removed by the evaluator; the executor's tree was never touched):
- A: delete `disabled={!isCreate}` gives **2 failed / 1 passed**. Both edit-mode tests go red, the create test stays green. This confirms the executor's claim.
- B: `ariaDescribedBy={undefined}` gives **1 failed / 2 passed**. The accessible-description assertion goes red.
- Unmutated: 3/3 pass.
- Logs and diffs: `.concertino/runs/HEL-1388/evidence/eval1-mutA.{diff,log}`, `eval1-mutB.{diff,log}`, `eval1-green.log`.

Executor's deviation (no `@testing-library/user-event`, so `toBeDisabled()` + `focus()` instead of a `tab()` walk): **adequate**. Native `disabled` on a `<button>` is exactly what removes it from the browser tab order, and `toBeDisabled()` pins that attribute (mutation A proves the test discriminates). The `focus()`/`not.toHaveFocus()` line is supporting, not load-bearing, and the inline comment says so honestly. The real-browser Tab walk in Phase 3 independently confirms the claim the jsdom test can't make.

Code-quality checklist:
- CONTRIBUTING: no inline FQNs, imports clean. The file is 739 lines, already over the ~400 budget at base (729); the split is tracked as HEL-1430 (out of scope). +10 lines is acceptable.
- DESIGN [mechanical]: no new CSS or tokens. It reuses the existing `output-editor-sheet__field-hint` class (already used by `HistoryPayloadsField.tsx:48`) and the shared `Select`'s `disabled`/`ariaDescribedBy` props. No shared component was edited.
- DRY/modular/readable: `useId()` gives a collision-safe id, and the copy is user-worded with a next step. The `buildEditConfig` comment (`:330-331`) is updated accurately, and the defensive guard is kept.
- Types: no `any` or escape hatches.
- Security and error handling: N/A. This is a presentational change, and the server already rejects kind changes.
- No dead code or TODOs. No over-engineering.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` on 6820/9727 (`assert-phase.sh servers` gave PASS). A throwaway user and the founder persona template were used: 1 pipeline with Outputs of kind 2× chart + 1× table.

- **Edit sheet, dark** (`eval1-edit-dark.png`): Kind shows "Chart" as disabled. It has opacity 0.55, `cursor: not-allowed` and no chevron emphasis, so it reads clearly as unavailable next to the full-opacity Name field and the Chart type select. The "Chart" label is still legible. The hint is 12px, muted (`rgb(170,164,156)`), and identical in style and position to the existing Stacking/Compare hints in the same sheet. It's cohesive: it reads like the sheet's other disabled-plus-hint pairing (History switch).
- **Edit sheet, light** (`eval1-edit-light.png`): same structure. Opacity 0.55 on `rgb(239,236,230)`, hint `rgb(100,94,86)`. It reads clearly as disabled and is cohesive with the Name field and Configuration card.
- **Table Output edit**: Kind shows "Table", disabled.
- **Create sheet, light and dark** (`eval1-create-light.png`, `eval1-create-dark.png`): Kind is enabled (opacity 1, no `aria-describedby`, no reason text). Choosing Table opened the listbox and swapped the option group (Chart type gone; Cell density + Columns shown). Create mode is unchanged.
- **Keyboard, real browser**: Tab from the Name input lands on "Chart type", skipping Kind. Shift+Tab returns to Name. A Playwright click is refused because the element isn't enabled. A programmatic `.click()` leaves `aria-expanded="false"`, so no listbox opens.
- **AT description**: the combobox has `aria-describedby="_r_8_"`. That id is unique in the document (count 1) and resolves to the hint `<p>` whose text is the reason. The accessibility snapshot shows `combobox "Output kind" [disabled]` with the reason paragraph immediately after it. The computed accessible description is also asserted by `toHaveAccessibleDescription(REASON)` in the jsdom test, and mutation B kills it.
- **Breakpoints, edit sheet open** (1440 / 1100 / 768 / 375): Kind and hint sit inside the dialog bounds at every width. At 375 the hint wraps to 2 lines without overflow (`scrollWidth == clientWidth`, no document horizontal overflow). See `eval1-edit-dark-375.png`.
- **Console**: one error, `404 /api/pipelines/:id/schedule` (the pipeline has no schedule; it appears on page load, not from this change), plus ECharts zero-size warnings from the sheet preview. Neither comes from the Kind control.
- **Residue**: the throwaway user `23121ead-ae73-436f-bb6d-b5947066cb80` and its dashboard, panels, pipeline, outputs and data source were deleted by exact id. A recount across every `owner_id`/`user_id`/`created_by`/`grantee_id` column found 0 rows. The cookie jar was removed.

Evidence (persisted via `persist-evidence.sh`; durable refs under `/home/matt/Development/helio/.concertino/runs/HEL-1388/evidence/.concertino/runs/HEL-1388/evidence/`): `eval1-edit-dark.png`, `eval1-edit-light.png`, `eval1-create-light.png`, `eval1-create-dark.png`, `eval1-edit-dark-375.png`. No claim here rests on mtime ordering.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- At 375px the **table** option group (Cell density select, column-format selects) overflows the right edge of the Configuration card (`eval1-edit-dark-375.png`). The diff only touches the Kind block, so this was not introduced here; it may merit its own ticket.
- Dangling `htmlFor="output-kind"` (known follow-up, out of scope). Fixing it would let clicking the "Kind" label focus the control in create mode.
