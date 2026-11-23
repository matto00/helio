## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `f6fc78a87cc6a22ab2a36955f597f1c74116f1a5` (commits ff8f658de red+stubs, c234f78f7, f6fc78a87). Diff base resolved live: `resolve-review-base.sh` gave `e3eda3eda` (exit 0). The diff is 71 files, frontend and e2e only, with no backend, schema or migration change.

### What I verified (with evidence)

**Gates, re-run fresh by me**
- `npm run typecheck` exit 0. `npm run lint` exit 0 (zero warnings).
- `npx jest --maxWorkers=3 src/features/pipelines`: 246 suites and 3411 tests passed, exit 0.
- e2e, full files, on DEV_PORT 7226 with 2 workers: `e2e/hel1794-viewer-read-only.spec.ts` and `e2e/hel1661-viewer-run-controls.spec.ts` gave **5 passed**, exit 0. This covers viewer desktop and phone in light and dark, the editor control, the pending role, and HEL-1661 for owner, editor and viewer.

**AC1: a viewer sees no actionable edit control (desktop and phone, light and dark)**
- Code, traced in the diff:
  - `canEditFromUi` (`usePipelineRunRole.ts`) is true only for owner and editor, so `pending` gets no edit controls. `page.canEdit` reaches every surface:
    - the header: name shown as text, the menu drops Rename, Edit source and every schedule entry, and the schedule chip is not rendered
    - `PipelineSpine`: Add source, + Add step and Add Outputs from a shape are hidden, and `reorderFor` is undefined
    - `useSpineStepActions.menuItemsFor`: returns `[]`, and `SpineStepRow` and `MobileStepSheet` render no trigger when the menu is empty
    - `SpineSourceCard`: `readOnly`, so no menu and no phone name button
    - `SpineOutputs`: `readOnly` hides New output, and the `OUTPUTS_COMPARERS.readOnly: is` comparer was added (HEL-1809 contract kept)
    - `StepCardFocused`: `readOnly` hides Disable, Duplicate and Remove, and the fieldset is disabled
    - `MobilePipelineHeader`: the menu items are gated and an empty menu is not rendered
    - `OutputEditorSheet`: fields sit in a disabled fieldset, and the footer shows only Close
    - `PipelineDetailDialogs`: the schedule dialog's `open` is gated on `canEdit`
    - `SpineStatusStrip`: Run to update is gated on `canRun`
  - Every production caller passes the prop. I checked by grepping the call sites: the only other `OutputEditorSheet` caller is a test harness.
- Live check by me in the shared browser at 1440x900 and 390x844 against a seeded pipeline that has an owner schedule:
  - Viewer desktop, light: the header shows the crumb, the static name, "View only" and the Pipeline actions menu, whose only item is "Run history". There is no chip, + Add step, Add source, row menu or New output. Step fields are disabled and readable. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1794/evidence/.concertino/scratch/HEL-1794/sk-viewer-desktop-light.png`.
  - Viewer Output sheet, dark: the title is the Output name, the fields are disabled, and the footer is Close only. Screenshot: `.../sk-viewer-desktop-dark-output.png`.
  - Viewer phone, dark: no Pipeline actions menu (empty, so not rendered), no chip and no add controls. The step sheet is titled "Step", has no "Step actions" menu, and its fields are disabled. Screenshots: `.../sk-viewer-phone-dark.png` and `.../sk-viewer-phone-dark-sheet.png`.
  - Owner on the same pipeline is unchanged: Add source, + Add step, shape, row menu, Disable/Duplicate/Remove, + Output, schedule chip, Dry run and Run pipeline are all present. Screenshot: `.../sk-owner-desktop-light.png`.
- The e2e exact allow-list scan (`expectOnlyAllowed`) runs over `main`, open dialogs and menus at four points (page, menu open, step open, Output sheet), for each of desktop and phone in light and dark, plus explicit `toHaveCount(0)` checks. It passed in my run.

**AC2: a viewer cannot create a draft, and a kept draft keeps Discard**
- `usePipelineDraft`: every overlay mutator goes through `setOverlayIfEditable`, which reads `editableRef`. `discard`, the re-base and the restore are not guarded.
- `usePipelineDraftRouting`: every edit handler returns early when `!editable`, in both the immediate `...Now` branch and the draft branch.
- Also guarded: `handleSave` (rename), `handleToggleScheduleEnabled`, and the schedule dialog's `open`.
- The role is hoisted above the draft hook and uses selector-only hooks.
- Jest `usePipelineDraft.viewer.test.tsx` and `usePipelineDraftRouting.viewer.test.tsx` pass.
- The e2e network watch over the whole viewer flow recorded no writes in my run. In the red run on main it caught `POST /api/pipeline-steps/:id/duplicate`.
- **Independent probe** (my own script, `.concertino/scratch/HEL-1794/sk-probe/kept-draft.mjs`): the owner made a kept draft in a tab, the same tab was switched to the viewer session, and the page was reloaded.
  - Light and dark both showed `{"discard":1,"saveAndRun":0,"editName":0,"expressionValue":"$amount * 3","expressionDisabled":true}`.
  - After clicking Discard: `{"discard":0,"kept":false,"expressionValue":"$amount * 2"}`.
  - Viewer writes: `[]`.
  - Screenshots: `.../sk-viewer-kept-draft-dark.png` and `.../sk-viewer-kept-draft-light.png`. This confirms the HEL-1661 Q2 ruling holds.

**AC3: the e2e covers it and failed first**
- `red-run/red-e2e.txt` was committed in ff8f658de, before the implementation, on inert stubs. It shows two failing viewer tests, the offending controls verbatim (Edit pipeline name, Add schedule, Step actions, New output, enabled fields, and so on), the duplicate write, and the field-value and kept-draft failures. The editor control passed on main, as intended.
- `red-run/red-jest.txt` has 13 assertion failures, each quoting its assertion line, and zero tsc failures.
- `mutations.md` lists M1 to M8, each with a named red test. I did not re-run the mutations: the skeptic does not modify code. The red-run evidence independently shows the tests fail without the implementation.

**Editors keep full editing**
- The e2e editor test passed in my run. It covers the desktop controls, typing creating a draft and Discard, the phone sheet's Step actions and enabled fields, and the pending-to-resolved transition.

**Design judgment (DESIGN.md)**
- New CSS uses existing tokens only: `--control-sm`, plus `opacity`/`cursor` resets on `.ui-input`/`.ui-select__trigger`/`.ui-textarea:disabled` inside the two `--readonly` modifiers.
- The static name keeps the button's face, so there is no layout shift.
- Light/dark parity holds, and the viewer header is visually consistent with the owner header minus actions.
- Contrast evidence from the e2e is between 8.7 and 15.9.

**Artifact consistency**
- proposal, design, specs and tasks match what shipped: D1 to D4, the copy table (each string in `viewerCopy.ts`), the hidden-not-disabled rule for actions, and configuration shown disabled. All tasks are `[x]`.
- One wording mismatch is noted below.

### Verdict: CONFIRM

### Non-blocking notes
- **Product call, not decided here (flag to owner):** a viewer opening an Output whose History card shows the upsell sees an active "Request Beta access (opens in a new tab)" link inside the disabled fieldset. It is navigation, not a pipeline edit, so AC1 holds either way.
- The e2e scan skips everything under `fieldset[disabled]`, including `a[href]`, which a fieldset does not disable. It also does not include `<summary>` (for example "Functions and operators", which stays expandable for a viewer and is harmless).
- `edit-affordance-inventory.md`'s escape scan says "zero `<a `" under `ui/outputEditor/**`. This is wrong: `HistoryPayloadsField.tsx`, `InsightKindFields.tsx` and `OutputPlacementsList.tsx` contain links. They are all navigation or upsell, not edits, but the inventory claim is inaccurate.
- The UI-level `canEdit = true` / `readOnly = false` prop defaults are fail-open: `PipelineSpine`, `PipelineSpineHeader`, `useSpineStepActions`, `SpineStatusStrip.canRun`, `StepCardFocused`, `OutputEditorSheet` and `OutputHistoryModal`. Every production caller passes the value today, and the hooks are required (fail-closed). A future caller that omits the prop would silently offer edits.
- In the read-only Output sheet, text inputs and selects render at full strength while buttons, checkboxes and toggles ("Add rule", "Reset column widths", the move arrows, "Keep each run's rows") render dimmed-disabled. This follows design D3, but the result is mixed. A later polish pass could hide those config-action buttons for a viewer.
- The proposal says a viewer opens an Output with "no editor fields". What shipped, matching design D3 and the spec, is disabled fields. Consider rewording the proposal before archive.
- The evaluator's note stands: the `viewerCopy.test.ts` comment about a multi-root pipeline whose first root has no steps is inaccurate.
- Process: my servers came up on the shared `helio` dev DB, not `helio_hel1794`, because I did not export the lane `DATABASE_URL` to `start-servers.sh`. My two throwaway users, their pipeline and their source were deleted by exact id and email (`userCleanupCore.buildUserDeleteSql`). I verified 0 remaining. The verdict does not depend on the DB.
- Process: a `beforeunload` dialog from my owner draft blocked the shared Playwright MCP page, and no dialog-handling tool was available. I closed the MCP browser, which held only my own page (it was at about:blank when I started).
