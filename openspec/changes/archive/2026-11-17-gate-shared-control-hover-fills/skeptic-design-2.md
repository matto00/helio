## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD fd3fbe7d098e6518cfd5ea44469a5a398cde2742. There are no implementation commits; the change dir is untracked.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` returned `READY ... branch=task/gate-shared-hover-fills/HEL-1675`.
- **Round-1 CR1 (scope): resolved.** Scope now covers every stylesheet under `frontend/src/shared/`.
  `grep -rn ':hover' frontend/src/shared --include=*.css` gives 38 lines in 20 files, as the design says. They are all
  in `ui/` and `chrome/`; `motion/BottomSheet.css` has no hover rule. The list includes `Popover.css:21`,
  `disclosureSummary.css:40`, `SegmentedRadioGroup.css:40`, `DataGrid.css:348/609/641`, `SortableTh.css:17/44` and
  `InlineError.css:51`. Each hover selector is top-level. None sits inside an existing `@media` block (the existing
  blocks all start after the hover lines in their files), so the D1 nested-media caveat is moot.
- **Mixed lists (D2):** confirmed at `inputs.css:145-146` (`:hover` + `--focused`), `DataGrid.css:348-349`
  (`:hover::after` + `:active::after`) and `MobileNavSheet.css:281-282` (`:hover` + `:focus-visible`). There are no
  others.
- **No reveals:** the only descendant-target hovers are `.sortable-th__btn:hover .sortable-th__glyph` (colour) and
  `.accent-picker__swatch:hover .accent-picker__dot` (scale). Neither makes a control reachable. An empty allowlist is
  sound.
- **`toast.css` cascade note (lines 181-191):** gating `.toast__close:hover` in place does not move the base rule or
  the 44px block after it. Safe.
- **D3 parser extraction:** `pipelineHoverGating.css.test.ts` holds `stripComments/splitTop/parseRules` and the three
  checks inline, so extracting them is mechanical. Walking `shared/**/*.css` makes the guard cover a new file
  automatically, which satisfies the spec scenario.
- **Round-1 CR3 (follow-ups): resolved.** HEL-1735 and HEL-1736 exist in Linear (Backlog), with origin HEL-1675 and
  ACs that match the deferrals.
- **Tidy items:** `e2e/hel1668-header-meta.spec.ts:110-114` logs `boxRight`/`trailingLeft` at 1280. D6 now names
  `trailingLeft - boxRight`, so the round-1 non-blocking note is addressed. DESIGN.md has a "## 5. Buttons" section
  (line 483) for D5.
- **E2E support:** `realTap` exists at `e2e/support/hel1668.ts:150`. `seedPipeline` in `e2e/support/hel1582Phone.ts`
  seeds filter, sort and compute. `FilterConfig.tsx:106/115` and `SortConfig.tsx:64` are shared `Select`s, so named
  instance 3 is real. Instances 1 (sheet "Step actions" trigger, `MobileStepSheet.tsx:69`) and 2 (menu item) are real.
- **Named instance 4 (IconButton) is factually wrong.** D4 names "the sort step's 'Remove sort key' or filter
  'Remove condition' IconButton". `SortConfig.tsx:87-93` renders "Remove sort key" as a plain
  `<button className="pipeline-detail-page__row-remove-btn">`, not `IconButton`. `grep -n IconButton` on
  `FilterConfig.tsx`/`SortConfig.tsx` returns nothing. Across `features/pipelines`, `<IconButton` appears only in
  `outputHistory/HistoryScrubber.tsx`, `outputEditor/ReferenceMarksField.tsx` and
  `outputEditor/ConditionalFormatsField.tsx`, and none of them is in the step sheet. The step preview `DataGrid` is not
  sortable (no `onSort` in `StepPreviewTable.tsx`), so no shared button stands in either. With the seeded fixture, the
  only shared `IconButton` in the sheet is the Modal Close button (`Modal.tsx:250-256`). D4 excludes it, correctly,
  because it unmounts the sheet, and `MobileStepSheet.tsx` has no close veto. "Executor names it" therefore points at
  something that does not exist.
- **Named instance 5 (`.ui-modal-btn` route) is factually wrong.** D4 and the Planner Notes say the cascade-confirm
  dialog is "opened by the sheet's 'Remove step' on a step with dependents". It is not.
  - `StepCardFocused.tsx:106-111` "Remove" calls `onRemove`, which is `page.handleRemoveStep`.
  - `usePipelineDetailPage.ts:350-354` turns that into `deleteStep(stepId)`, a draft-only edit that opens no dialog.
  - The cascade dialog (`PipelineDraftDialogs.tsx:20`, `cascade !== null`) is set only in `usePipelineDraftSave.ts:297-300`,
    on a save that gets `conflict.kind === "cascadeRequired"`. That is a page-level Save, outside the sheet.
  - The other `ui-modal-btn` dialog in that file (leave guard, `:80-85`) is also page-level.

  So no dialog is "opened from the sheet". The spec's first scenario says otherwise ("a modal footer button in a
  dialog opened from the sheet"), and the archived spec would carry that false statement.

### Verdict: REFUTE

The scope, guard, follow-up and tidy revisions are sound. The remaining defect is the round-1 CR2 item: two of the five
named e2e instances, and one spec scenario clause, rest on code paths that do not exist. The red-or-not-covered rule
would catch this at execution time. But the design should not hand the executor a route that is already known to be
false, and the spec must not assert a sheet-opened dialog. The fix is small.

### Change Requests

1. **design.md D4 instance 4 (IconButton):** remove the "Remove sort key / Remove condition IconButton" claim. They
   are `pipeline-detail-page__row-remove-btn` plain buttons (`SortConfig.tsx:87-93`). State the measured fact: with
   the `seedPipeline` fixture, the only shared IconButton in the sheet is the Modal Close button, which unmounts the
   sheet. Then choose one of these and write it down:
   - (a) Classify IconButton up front as "guard + probe only" under the red-or-not-covered rule.
   - (b) Name a specific stays-mounted, phone-reachable IconButton outside the sheet, with its route.

   Do not leave "executor names it".
2. **design.md D4 instance 5 and the Planner Notes (`.ui-modal-btn`):** correct the route. Sheet "Remove" is a
   draft-only `deleteStep` (`usePipelineDetailPage.ts:350-354`). The cascade dialog opens only on page Save with a
   `cascadeRequired` 422 (`usePipelineDraftSave.ts:297-300`). Name the actual route, for example: remove a step with
   dependents in the sheet, close the sheet, tap the phone page's Save, then the cascade dialog appears, then tap Cancel
   and Save again to reopen it. Confirm that the seeded linear filter, sort and compute chain actually triggers
   `cascadeRequired`. If it does not, name the leave-guard route instead. Alternatively, classify `.ui-modal-btn` as
   phone-page coverage, not in-sheet coverage. Fix the Planner Notes line "covered via the sheet's Remove route"
   either way.
3. **specs/shared-control-hover-gating/spec.md, first scenario:** drop "or a modal footer button in a dialog opened
   from the sheet". No such dialog exists. Either list only controls that render in the sheet (step actions trigger,
   actions-menu item, Select trigger, plus IconButton only if CR1 chooses (b)), or move the modal footer button into a
   separate scenario for "a dialog on the phone pipeline page", worded to match the route from CR2. Keep the
   desktop-unchanged scenario's "those controls" consistent with the result.
4. **design.md D4 escalation threshold:** after CR1 and CR2, restate how many instances are expected to be e2e-red, and
   check that the "fewer than three of the five go red, escalate" rule still makes sense against that count.

### Non-blocking notes

- An in-sheet shared control that stays mounted and has a real hover rule, and could replace a lost instance: the step
  preview's `OutputSchemaDisclosure` summary (`disclosureSummary.css:40`). It renders only with the `wide` seed (more
  than 12 fields), and tapping it toggles the disclosure without unmounting it. Worth naming if the executor wants a
  fourth e2e-red instance.
- The ActionsMenu-item instance ("Move down", then reopen) reorders the step under the open sheet. The executor should
  make sure the reopened menu's item at the tapped point is the same item kind, not a disabled "Move down" on the last
  step.
