## Context

See proposal.md and ticket.md. Verified on main e3eda3eda (premise validation: `.concertino/runs/HEL-1794/evidence/premise-validation.md`). Paths below are under `frontend/src/features/pipelines/` unless noted; line numbers are approximate and the executor re-derives each one.

- **Role.** `hooks/usePipelineRunRole.ts` (HEL-1661 D4): `runRoleOf` returns `owner` at once for the owner, else the last analyze RESULT's `callerRole` (kept through a re-analyze's `loading`/`failed`), else `pending` (no result yet), else `editor` when analyze failed with no result. `canRunFromUi(role)` = owner or editor. `usePipelineDetailPage.ts` computes `page.runRole` and both layouts read it. The role is not on the pipeline row; it only arrives with analyze.
- **Draft.** `hooks/usePipelineDraft.ts` holds the client-only overlay (HEL-1631): mutators `setConfig`, `setEnabled`, `deleteStep`, `insertStep`, `addLaneStep`, `duplicateStep`, `reorderTrunk`, `createOutput`, `editOutput`, `deleteOutput`, `appendOps`, `addRoot`, `removeRoot` (each a `setOverlay(with…)`), plus `discard`. The overlay is kept per tab in sessionStorage (`readKeptDraft`/`writeKeptDraft`) and restored when the page opens, so a draft made before a role change reappears.
- **Routing.** `hooks/usePipelineDraftRouting.ts` is the single choke point for edit handlers: with no draft, structural handlers (add/insert/branch/duplicate/reorder/add root/remove root/create/update/delete Output/instantiate shape/aggregate tail) go to immediate server writes (`…Now`), with a draft they record overlay ops; `handleStepConfigChange`, `handleRemoveStep`, `handleToggleStepEnabled` always go to the draft except for temp steps. A viewer's first edit therefore either starts a draft or fires a request the server refuses (403).
- **Other mutating handlers outside routing:** rename (`setEditingName` + save in the header dirty row), `handleToggleScheduleEnabled` (`usePipelineSourceScheduleActions`, immediate), the schedule dialog's save/clear, `onEditOnlySource`/source-card "Edit source" (navigates to the source editor), `onRemoveRoot`.
- **HEL-1809 memo comparators.** `ui/spine/SpineStepRow.tsx` `ROW_COMPARERS` and `ui/spine/SpineOutputs.tsx` `OUTPUTS_COMPARERS` are typed over every prop (`-?` mapped types), so any new prop fails `tsc` until a comparer is chosen. `menuItems` is compared by value (`sameMenu`), `reorder` by index and presence.
- **HEL-1782 precedent.** Dashboards: `selectCanEditDashboard` (owner or editor), viewer edit affordances are hidden, not disabled (`PanelCardHeader`, `DesktopPanelGrid` `isEditingLayout = canEditPanels && …`), keyboard shortcuts made inert (`useLayoutUndoRedo` `enabled = canEdit`). Exception: `useCreatePanelAction` disables.
- **HEL-1661 deferrals to this ticket:** `ui/outputEditor/OutputSheetPreviewCard.tsx` "Run the pipeline to populate it." and `ui/outputHistory/OutputHistoryModal.tsx` "Run the pipeline to start recording this Output's history." invite a viewer to act.
- **Schedule is owner-only on the server (skeptic round 2).** `PipelineScheduleService.scala` `find`/`put`/`delete` gate on `findByIdOwned`, and `PipelineScheduleRepository.findByPipelineId` joins on the owner, so a viewer's or editor's `GET /api/pipelines/:id/schedule` is 404, which `state/pipelineScheduleThunks.ts` maps to `schedule: null`. Every grantee therefore sees "Add schedule" and the "Set schedule" menu item today, never "Edit schedule"/"Pause schedule" or a schedule's text, even when the owner has one. Whether grantees should read a schedule (and editors save one) is a backend question outside this ticket; it is raised as a follow-up triage escalation at Delivery, and nothing in this design depends on its answer.
- **Keyboard:** no Ctrl+S / Delete / Ctrl+Z handler or context menu exists on the pipeline page (`onKeyDown` only in `MobilePipelineTabs`); the keyboard reaches editing only through the controls below.

### Edit-affordance inventory (before this change)

| # | Affordance | Desktop | Phone | Handler |
|---|---|---|---|---|
| 1 | Rename: name button "Edit pipeline name", menu "Rename", name TextField, dirty row Save/Cancel/Discard changes/Keep editing | `PipelineSpineHeader` | `MobilePipelineHeader` | `setEditingName`, save |
| 2 | Edit source (menu) | header menu | header menu | `onEditOnlySource` |
| 3 | Set/Edit schedule (menu), Pause/Resume schedule (menu) | header menu | header menu | `onEditSchedule`, `handleToggleScheduleEnabled` |
| 4 | Schedule chip "Add schedule"/"Edit schedule" | `SpineScheduleChip` | `SpineScheduleChip` in `MobilePipelineHeader` | opens `PipelineScheduleDialog` |
| 5 | Share | owner-only already | owner-only already | — |
| 6 | Add source | `PipelineSpine` button | header menu | `actions.openAddRoot` → `AddRootModal` |
| 7 | Add Outputs from a shape | `PipelineSpine` button | header menu | `ShapePickerModal` |
| 8 | "+ Add step" / "+ Add transformation step" | `PipelineSpine` | `PipelineSpine` (phone variant) | `openAppendPalette` → `StepPalette` |
| 9 | Row menu "Step actions for {label}": Move up/down, Insert before/after, Branch from here, Add output | `SpineStepRow` | `MobileStepSheet` header | `useSpineStepActions.menuItemsFor` |
| 10 | Drag grip + row drag/drop | `SpineStepRow` grip, `SpineLane` `reorderFor` | — | `useLaneReorder` |
| 11 | Source card menu: Edit source {name}, Remove source … from this pipeline; phone name button "Edit source {name}" | `SpineSourceCard` | `SpineSourceCard` | navigate, `onRemoveRoot` |
| 12 | Step header actions Disable/Enable, Duplicate, Remove | `StepCardFocused` | `StepCardFocused` in `MobileStepSheet` | toggle, duplicate, remove |
| 13 | Step configuration fields (every `stepConfigs/*Config.tsx`, `SecondaryInputPicker`) | `StepCardFocused` fieldset | same | `useStepCardState` → `handleStepConfigChange` |
| 14 | New output | `SpineOutputs` | `SpineOutputs` | `onAddOutput` |
| 15 | Output editor: Name, kind, step, kind config, conditional formats, reference marks, history payloads, Add as tail with aggregate, Delete, Save | `OutputEditorSheet` via "Open {name} output" | same | `actions.create/update/remove` |
| 16 | Save & run, Discard draft, draft chip | header trailing (Save & run already viewer-hidden) | `MobilePipelineActions` pills (Save & run already viewer-hidden) | draft |
| 17 | Draft notices: Reload the saved pipeline, Dismiss, Discard draft and undo | `PipelineDraftNotices` | same | draft only — appear only when a draft exists |

Read-only entries that stay: step row select, step preview table (and its column/schema chips), "Open {name} output" (preview), Output card menu → History, Run history (menu item and phone Runs tab), Pipeline actions menu when it still has an item, tabs, "View only".
Also read-only (skeptic round 1): "Back to pipelines", the "Pipeline path" crumb link, "Output actions for {name}" → "History for {name}", the live column's Output toggle and "Displayed Output" select (`liveOutput/LiveOutputColumn.tsx`), the phone "Previewed step" select (`mobile/MobilePreviewTab.tsx`), the `OutputSchemaDisclosure` toggle, the source-sample Retry (`sources/ui/SourceSampleLabel.tsx`), dashboard links in `OutputPlacementsList`. `PipelineEmptyState` is mounted only by the list page, not the detail page (not applicable). Read-only helpers inside `StepOpEditor` (e.g. the ComputeFunctionReference toggle, disclosures) are disabled with the fieldset for a viewer; the inventory records them as intentionally disabled.

The executor's first task re-derives this inventory with a script over `ui/spine/**`, `ui/mobile/**`, `ui/StepCardFocused.tsx`, `ui/stepConfigs/**`, `ui/outputEditor/**`, `ui/liveOutput/**`, `ui/outputHistory/**`, `ui/RunHistoryModal.tsx`, `ui/schedule/**`, `ui/PipelineDetailPage.tsx`, `ui/PipelineDetailDialogs.tsx`, `ui/PipelineDraft*.tsx`, `ui/PipelineEmptyState.tsx` (every `onClick`, `onChange`, `onDrag*`, `draggable`, `ActionsMenu`, `TextField`, `Select`, `<input`, `<textarea`, `contentEditable`, `role="button"`), records each hit with its gate in `.concertino/runs/HEL-1794/evidence/edit-affordance-inventory.md`, and reports any affordance not in the table above.

## Goals / Non-Goals

**Goals:** every AC in ticket.md; each behaviour locked by a test that fails without the change; owners and editors unchanged.

**Non-Goals:**
- No backend, API, schema or migration change; the server stays the authority for every write.
- The pipelines LIST page, the source editor page, the dashboard and the share dialog are out of scope.
- No change to who can run (HEL-1661 already gates run entries); no change to the `runRoleOf` rule.

## Decisions

### D1. One edit predicate from the existing role

Add `canEditFromUi(role: PipelineRunRole): boolean` in `usePipelineRunRole.ts`: true for `owner` and `editor`, false for `viewer` and `pending`. It is deliberately the same set as `canRunFromUi` today but a separate name, so a future divergence (e.g. a run-only role) is a one-line change. `usePipelineDetailPage` exposes `page.canEdit = canEditFromUi(page.runRole)`.

- `pending` is not editable: a viewer must never see an edit control appear and disappear. Owners are never `pending` (rule 1), so owners see no change. An editor sees edit controls appear once, when the first analyze result arrives; this mirrors HEL-1661's run entries. To avoid a shift, the header name renders as plain text (same size) while `pending`; the schedule chip is not rendered while `pending`, and the controls that are additions (+ Add step, New output, Add source, step actions) simply appear. The executor records before/after screenshots of an editor's first paint and resolve in scratch.
- Analyze failed with no result → `editor` (HEL-1661 rule 4): controls show, the server refuses a viewer's write. Unchanged and accepted.

### D2. A viewer cannot create a draft (defence in depth)

1. **UI:** every entry in the inventory that can start a draft or write is hidden for `!canEdit` (D3).
2. **Draft hook guard:** `usePipelineDraft` takes `editable: boolean`. Call order: `usePipelineDraft` runs at `usePipelineDetailPage.ts:~57`, before `runRole` (~126). `usePipelineRunRole` is selector-only and `isOwner` reads only `currentPipeline`/`currentUser`, so the executor hoists the role computation (or just `isOwner` + `usePipelineRunRole`) above the draft call without changing effect order; the mutators read `editable` through a ref so their identities stay stable. Every overlay mutator listed in Context returns without calling `setOverlay` when `editable` is false. `discard` (and the "reload the saved pipeline" re-base path) are NOT guarded: a draft that exists for a viewer (restored from sessionStorage after a role change) is still shown and can be discarded (owner ruling HEL-1661 Q2). Restoring a kept draft is not a mutator and is unchanged.
3. **Routing guard:** in `usePipelineDraftRouting`, every edit handler (including the immediate `…Now` branch and the temp-step immediate path) returns early when `!editable`, so a viewer can never fire a write request from the page either. `handleToggleScheduleEnabled`, the rename save, the schedule dialog save/clear and `onRemoveRoot` return early too.
4. Save & run is already a no-op and hidden for a viewer (HEL-1661); unchanged.

### D3. Hidden, not disabled — except configuration, which is shown read-only

Follow HEL-1782: actions are hidden. Configuration VALUES are information a viewer needs to understand the pipeline, so they are shown read-only rather than removed.

- **Header (desktop and phone):** for `!canEdit` the pipeline name renders as plain text (no "Edit pipeline name" button, no TextField); the Pipeline actions menu omits Rename, Edit source, Set/Edit schedule and Pause/Resume schedule (Run history stays; Share stays owner-only); the phone header menu also omits Add source and Add Outputs from a shape. If the menu would be empty, its trigger is not rendered.
- **Schedule chip:** for `!canEdit` the chip is not rendered at all, and the "Set schedule"/"Edit schedule"/"Pause"/"Resume" menu items are omitted. A grantee never receives a schedule (Context), so there is no static-text branch; a viewer sees no schedule fact (recorded limitation, part of the follow-up above).
- **Spine:** Add source, Add Outputs from a shape and "+ Add step" are not rendered. `menuItemsFor` returns `[]` and `reorderFor` returns `undefined` for `!canEdit`; `SpineStepRow` renders no ActionsMenu trigger, and no `.spine-row__menu` wrapper cell, when `menuItems` is empty and no grip/draggable when `reorder` is undefined (the executor confirms both are already conditional, else makes them so — no new row prop needed, `sameMenu`/`reorder` comparers already handle the change). The source card renders no menu and the phone name is plain text.
- **Step editor (`StepCardFocused`, desktop and phone sheet):** new `readOnly` prop (in `stepCardTypes.ts`): Disable/Enable, Duplicate and Remove are not rendered; the body fieldset is `disabled={isCreating || readOnly}`. **Read-only presentation (skeptic CR2):** a bare disabled fieldset dims every value to `opacity: 0.55` (`shared/ui/inputs.css:46-51`), so the fieldset also gets a `step-focused__fieldset--readonly` modifier (and the Output sheet an `output-editor-sheet--readonly` modifier) that keeps the `disabled` semantics but restores full-opacity value text, labels and select-trigger text and a default cursor, using existing tokens only (no new colours). Value-text contrast is measured in light and dark with the selectors of `e2e/support/stateContrastProbe.ts` and the math of `e2e/support/stateContrast.mjs` (`contrastRatio`, `compositeStack`, `parseColor`), INCLUDING the element's and its ancestors' computed `opacity` (a bare `color` read misses the 0.55 dimming) and must be at least 4.5:1. Copying text out of a disabled field is not supported in every browser; that is a recorded limitation, not an AC. The inventory script lists every control under `stepConfigs/**` that a disabled fieldset does not disable (non-native controls, `role="button"` elements, drag lists, contentEditable, anything with `tabIndex` and an `onClick`/`onKeyDown`); each one gets `readOnly` gating, and D2's guard catches anything that still escapes. The phone sheet's title reads "Step" instead of "Edit step" for a viewer, and its header ActionsMenu is not rendered when its items are empty.
- **Outputs:** "New output" is not rendered. "Open {name} output" still opens `OutputEditorSheet`, which gets a `readOnly` prop: its config fields render inside a disabled fieldset (name, kind, step, kind config, formats, reference marks, history payloads), Add as tail with aggregate, Delete and Save are not rendered, the dismiss button reads "Close", and the title does not say "Edit". The preview and (for insight Outputs) the render stay. Any insight refresh control already follows the server's `canRefresh` (false for viewers).
- **Copy (skeptic CR3).** Every string a viewer sees that invites an edit or a run gets a viewer variant, each asserted by a jest test (owner/editor keep today's string):

  | Where | Today | Viewer |
  |---|---|---|
  | `spine/PipelineSpine.tsx` (~222) | "Add your first transformation step to start shaping this pipeline's output." | "No transformation steps yet." |
  | `spine/PipelineSpine.tsx` (~228-230) | "No steps yet — join this source into another lane's step to use it." | "No steps use this source yet." |
  | `spine/PipelineSpineLayout.tsx` (~327-334) empty editor | "Nothing to edit yet" / "Add a step on the left, then edit it here…" | "No steps yet" / "This pipeline has no steps." |
  | `spine/PipelineSpineLayout.tsx` (~327-334) nothing selected | "Pick a step on the left to edit it…" | "Pick a step on the left to see its configuration." (executor keeps any remainder of the sentence that is not an edit invitation) |
  | `mobile/MobilePreviewTab.tsx` (~74) | "Add a step on the Steps tab to see the rows it produces." | "This pipeline has no steps yet." |
  | `liveOutput/LiveOutputColumn.tsx` (~191) | "No Output yet. Add one from the spine." | "No Output yet." |
  | `mobile/MobileStepSheet.tsx` title / `ariaLabel` | "Edit step" / "Step editor" | "Step" / "Step details" (viewer-branch tests use the new name; `pipelineMobileTestKit.tsx` editor lookups unchanged) |
| `spine/PipelineSpineLayout.tsx` (~277) region `aria-label` | "Step editor and preview" | "Step details and preview" |
  | `outputEditor/OutputSheetPreviewCard.tsx` (~57-60), the whole paragraph | "…currently shows 'No data available.' Run the pipeline to populate it." | one coherent paragraph: "This Output has no rows yet. It fills in after the pipeline's next run." |
  | `outputHistory/OutputHistoryModal.tsx` (~51) | "Run the pipeline to start recording this Output's history." | "No history recorded yet." |
  | `OutputEditorSheet` title | (edit/create title) | the Output's name, no "Edit" |

  Task 1.1's script also greps string literals in the scanned files for "Add ", "Edit", "edit it", "Run the", "Pick a step" and records any further viewer-visible invitation with its viewer string.
- **Edit source for a viewer** who happens to own the source: hidden too (AC1 is literal: no edit control on the pipeline page); the viewer can still open the source from the Sources page. Recorded choice.
- **Draft UI:** unchanged from HEL-1661 for a viewer with a draft: draft chip/status and Discard only.
- **Memo comparators:** every new prop on `SpineStepRow`/`SpineOutputs` (if the executor needs one, e.g. `SpineOutputs` `readOnly` to drop New output — alternatively pass `onAddOutput: undefined`) is added to `ROW_COMPARERS`/`OUTPUTS_COMPARERS` with `is`; `PipelineDetailDialogs`' `samePageForDialogs` must compare `canEdit` (a primitive) so a role change re-renders the dialogs; `PipelineSpineHeader`/`SpineSourceCard` shallow memos get primitives only.

Alternative rejected: disabling every action (visible but greyed) — HEL-1782 hides, and a wall of disabled buttons invites the question "why can't I". Alternative rejected: hiding step configuration entirely — a viewer could then not see what any step does.

### D4. Tests

- **Jest (red first):**
  - `canEditFromUi` truth table (owner, editor, viewer, pending).
  - `usePipelineDraft` with `editable: false`: each mutator leaves `hasDraft` false and writes no kept draft; a kept draft in sessionStorage is still restored and `discard` clears it; with `editable: true` unchanged.
  - `usePipelineDraftRouting` with `editable: false`: no `…Now` service call and no overlay op for each handler.
  - Components: `PipelineSpineHeader`, `MobilePipelineHeader`, `SpineScheduleChip`, `PipelineSpine`, `SpineStepRow` (via layout), `SpineSourceCard`, `SpineOutputs`, `StepCardFocused`, `MobileStepSheet`, `OutputEditorSheet`, `OutputSheetPreviewCard`, `OutputHistoryModal`: viewer renders none of the inventory's controls and fields are disabled; editor and owner render them; `pending` renders the read-only forms.
  - Memo comparator tests (`SpineStepRow.memoComparators`, `SpineOutputs.memoComparators`, `PipelineDetailDialogs.memo`) cover a role flip.
- **e2e `e2e/hel1794-viewer-read-only.spec.ts` (red first, committed before implementation)**, reusing `e2e/support/hel1661Fixture.ts` (owner, editor and viewer on a lane-DB backend; plain emails; residue removed by the existing id-recording teardown). **The owner also PUTs a schedule** (`PUT /api/pipelines/:id/schedule`) on the fixture pipeline as a guard: the viewer must see no schedule control even when a schedule exists. The schedule red is "Add schedule" and the "Set schedule" menu item (what every grantee sees on main).
  - Viewer, desktop (1280x800) and phone (390x844), light and dark: open the pipeline (wait for the analyze response), select the step (desktop) / open its sheet (phone), open the Output, open the Pipeline actions menu. A scripted scan collects every visible, enabled `button`, `a[href]`, `input`, `select`, `textarea`, `[role=button]`, `[role=menuitem]`, `[role=combobox]`, `[role=switch]`, `[draggable=true]`, `[contenteditable=true]` inside the app's main region and any open dialog/menu, and asserts each accessible name is in an EXACT allow-list (no regex, no prefix wildcards; names parameterised only by the fixture's own step/Output/source names): "Back to pipelines", the "Pipeline path" crumb link name, the step row select's exact name, "Open {OUTPUT_NAME} output", "Output actions for {OUTPUT_NAME}", "History for {OUTPUT_NAME}", "Pipeline actions", "Run history", "Displayed Output", the live column's Output toggle, "Previewed step", the OutputSchemaDisclosure toggle's name, the source-sample "Retry" (only if visible), the sheet/dialog close control's name, the phone tab names. The executor records the final list verbatim in the spec and in the evidence inventory. Plus explicit `toHaveCount(0)` for "Edit pipeline name", "Rename", "Add schedule", "Set schedule", `button[aria-label^="Edit schedule"]`, "Pause schedule", "Add source", "+ Add step", "Step actions for {step}", "Disable step", "Duplicate step", "Remove step", "New output", "Save", "Delete". Screenshots per viewport/theme to `evidencePath("HEL-1794", …)`.
  - **Network watch (skeptic CR1)** over the WHOLE viewer flow (open, select/sheet, Output, menu, draft attempt): every non-GET request to `/api/pipelines/**`, `/api/pipeline-steps/**` and `/api/outputs/**` is recorded, minus a named allow-list of read-only POSTs: `/api/pipelines/:id/preview`, `/api/pipelines/:id/validate-expression`, `/api/pipelines/:id/draft-preview`, `/api/pipelines/analyze-proposal`. The green asserts the recorded list is empty; the red run records what main sends.
  - Viewer cannot create a draft: attempt to type into the first configuration field (disabled; force-fill and assert the value is unchanged) and click where the grip would be; assert no "Discard draft", no draft status, and no kept-draft key in sessionStorage.
  - Editor control on the same pipeline: name button, step actions, New output, "Add schedule" (an editor's schedule save 404s today: pre-existing, out of scope), enabled fields present; typing into a field shows "Discard draft"; Discard it.
  - Red on main: the viewer scan finds edit controls, the draft attempt creates a draft, and the network watch catches the write; the red run records each.
- **Red-first mechanics (skeptic CR4, standing constraint C15).** The red commit adds the new API surface as inert stubs (`canEditFromUi` returns true for every role; `editable`/`readOnly` props accepted and ignored; new copy constants equal today's strings) so every jest red fails on its ASSERTION, not on `tsc`; `red-run/red-jest.txt` quotes the failing assertion line of each. `.husky/pre-commit` runs typecheck and the full jest suite, so the red commit is made with `git commit -n`, named in that commit's message and in the PR body (CLAUDE.md bypass rule); the next commit runs the hooks normally.
- **Contrast:** value text of the read-only step fieldset and Output sheet ≥ 4.5:1, light and dark, via `stateContrastProbe.ts` + `stateContrast.mjs`, opacity included (CR2).
- **Mutations** (recorded with the named test that turns red): remove the read-only modifier (contrast test red); remove the D2 hook guard (with the UI still gated, jest hook test red); remove the routing guard; drop `readOnly` from the step fieldset; render New output for viewers; render the row menu for viewers; render the null-schedule "Add schedule" chip for viewers; make `canEditFromUi` true for `pending`.
- Existing HEL-1661/HEL-1782/HEL-1582/HEL-1631 jest and e2e for owners/editors must stay green; the executor greps `e2e/` for every changed accessible name and matches tests by title.

## Risks / Trade-offs

- [Editor sees edit controls appear on first analyze] → owners never; D1 keeps fixed-row controls in a same-size read-only form while pending; recorded with screenshots. For a pipeline with NO schedule, "Add schedule" pops into the header row when an editor's role resolves (there is no read-only form of nothing): accepted and recorded in the pending→resolved screenshots, not reserved.
- [A config control escapes the disabled fieldset] → audit script + D2 guard; the e2e scan fails on any enabled control.
- [Analyze failed with no result, viewer gets editor controls and a draft that cannot save] → HEL-1661 rule 4, server refuses; a known exception to AC1, named as such in the PR body.
- [Kept draft for a viewer] → shown with Discard only, by ruling.

## Migration Plan

None. Rollback is a revert.
