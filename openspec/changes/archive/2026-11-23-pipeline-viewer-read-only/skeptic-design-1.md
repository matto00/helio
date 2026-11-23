## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD e3eda3eda28683075c616a0ebd9935ad4c89b9f9 (the planning artifacts are still uncommitted in the change dir). Paths are under `frontend/src/features/pipelines/` unless noted.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/pipeline-viewer-read-only/HEL-1794`.
- **Role rule:** `hooks/usePipelineRunRole.ts` matches design Context. `runRoleOf` returns owner, then the result's callerRole, then `pending`, and `editor` on a failed analyze. `canRunFromUi` = owner or editor.
- **Inventory rows 1-17 checked against the code.** Each one exists where design.md says:
  - header items and the dirty row: `spine/PipelineSpineHeader.tsx:69-82,98-108,136-177` and `mobile/MobilePipelineHeader.tsx:48-75,88-151`
  - `spine/SpineScheduleChip.tsx` "Add schedule" / "Edit schedule"
  - `spine/PipelineSpine.tsx:186-260`: Add source, + Add step, Add Outputs from a shape
  - `spine/useSpineStepActions.tsx:130-195`: Move, Insert, Branch, Add output
  - `spine/SpineStepRow.tsx:148-158,252-255`: the grip is already conditional on `reorder`. The ActionsMenu is NOT conditional; it renders even when `menuItems` is empty, so the executor must make it conditional, as the design anticipates.
  - `spine/SpineSourceCard.tsx:56-103`: the menu always holds "Remove from pipeline", disabled on a single root, so the trigger is present for every viewer today. The phone name button is "Edit source {name}".
  - `StepCardFocused.tsx:84-111`: Disable, Duplicate, Remove. The fieldset at :131 is `disabled={isCreating}`.
  - `spine/SpineOutputs.tsx:104-113`: New output. `outputEditor/OutputEditorFooter.tsx`: Delete, Close, Add tail, Save.
  - `mobile/MobileStepSheet.tsx:63-71`: title "Edit step" and the header ActionsMenu.
  - `PipelineDraftNotices.tsx`: the notices.
- **Row 18:** `PipelineEmptyState` is mounted only by `PipelinesPage.tsx:139`, the list page. It is not on the detail page, so that row resolves to "not applicable".
- **Things I checked that are not in the design's table:**
  - Read-only controls that are fine but missing from the allow-list:
    - `liveOutput/LiveOutputColumn.tsx:170-209`: the Output toggle and the "Displayed Output" Select
    - `mobile/MobilePreviewTab.tsx:89`: the "Previewed step" Select
    - `OutputSchemaDisclosure.tsx:109`: a toggle
    - `sources/ui/SourceSampleLabel.tsx:57-64`: the sample Retry
    - `outputEditor/OutputPlacementsList.tsx:16`: dashboard links
    - "Output actions for {name}" (History only) and "Back to pipelines"
  - `spine/SpineStatusStrip.tsx:31` "Run to update" is gated on the server's `costVerdict.canRun`. That flag is permission-aware: `PipelineAnalyzeReads.scala:169` and `AutoRunTriggerService.scala:120` both use owner OR editor. Fine.
- **Memo comparators:** I confirmed `ROW_COMPARERS` and `OUTPUTS_COMPARERS` are typed with `-?` over every prop. `sameMenu` compares by value, so an empty list and a full list differ. `reorder` is compared by presence. `samePageForDialogs` compares every non-volatile key by identity, so a new primitive `canEdit` key is covered automatically.
- **Keyboard:** grep for keydown, onKeyDown and hotkeys finds only `StepPalette` and `MobilePipelineTabs`. The design's claim holds.
- **Draft writers:** `setOverlay` and `writeKeptDraft` are called only inside `hooks/usePipelineDraft.ts`. Nothing outside `features/pipelines` writes a draft; `store.ts` only imports `keptDraft`. No config editor emits `onConfigChange` on mount: the three `useEffect`s under `stepConfigs/` only fetch sources or sync local text. So the D2 hook guard cannot swallow a legitimate automatic emit for an editor who is still `pending`.
- **Controls the disabled fieldset may not catch:** grep across `stepConfigs/*.tsx` for contentEditable, role="button", tabIndex, onKeyDown and draggable finds nothing. The shared `Select` trigger is a native `<button role="combobox">` (`shared/ui/Select.tsx:165-183`), so the fieldset disables it.
- **Fixture:** `e2e/support/hel1661Fixture.ts` has an owner plus editor and viewer grants, one static source the grantees do not own, a compute step and one Output. It seeds no schedule.
- **Pre-commit:** `.husky/pre-commit` runs `npm run typecheck` and the full `npm test`.
- **Write and read POST endpoints:**
  - Writes go to `/api/pipeline-steps/:id` (PATCH, DELETE) and `/api/pipeline-steps/:id/duplicate` (POST), per `services/pipelineService.ts:150,165,175,181`.
  - Read-only previews are POSTs: `POST /api/pipelines/:id/preview` (`services/outputService.ts:257`, dispatched by `hooks/usePipelinePreviewCache.ts:27` when an Output is previewed) and `POST /api/pipelines/:id/validate-expression`.
- **Spec deltas:** both target capabilities exist under `openspec/specs/`. The deltas are ADDED requirements with scenarios.
- **Placeholders and contradictions:** none blocking. "Executor audits" and "executor re-derives" are explicit tasks with an acceptance signal (task 1.1), not hand-waving.

### Judgement on the asked-about decisions

- **D1 (pending is not editable): sound.** Owners are never `pending`. A viewer never sees a control flash in. An editor sees additions appear once, which mirrors HEL-1661's run entries. One gap: the null-schedule chip has no same-size read-only form (see note).
- **D2 (hook guard plus routing guard, Discard kept): sound and correctly placed.** `discard`, `rebase` and the kept-draft restore stay unguarded, which matches the HEL-1661 Q2 ruling.
- **D3: the hide-actions choice is right and follows HEL-1782.** The read-only presentation of the configuration is under-specified (CR2).
- **D4: the shape is right.** The network watch and the red-first mechanics are wrong as written (CR1, CR4). The copy inventory is incomplete (CR3). The e2e allow-list and fixture are incomplete (CR5).

**Product questions:** I found none that the ticket, the HEL-1661 Q2 ruling or the HEL-1782 precedent does not settle. The edge cases are in the notes below and are design calls, not escalations.

### Verdict: REFUTE

### Change Requests

1. **The D4 network watch is both too narrow and too broad. Redefine it.** The design says "no non-GET request to `/api/pipelines|/api/outputs`".
   - Too narrow: it misses every step write. Step PATCH, DELETE and duplicate go to `/api/pipeline-steps/...` (`services/pipelineService.ts:150,165,175,181`), and that path does not contain `/api/pipelines`.
   - Too broad: on the green build it would fire on read-only POSTs a viewer legitimately sends. `POST /api/pipelines/:id/preview` is sent when an Output is previewed (`outputService.ts:257` via `usePipelinePreviewCache.ts:27`), and there is also `POST /api/pipelines/:id/validate-expression`.
   - Required: state the watch as every non-GET request to `/api/pipelines/**`, `/api/pipeline-steps/**` and `/api/outputs/**`, minus a named allow-list of read-only POSTs: `/api/pipelines/:id/preview`, `/api/pipelines/:id/validate-expression` and `/api/pipelines/:id/draft-preview`.
   - Make the watch cover the whole viewer flow, including opening the Output. Record in the red run that on main it catches the viewer's step write or draft.

2. **D3 has to specify a read-only presentation that a viewer can actually read.** The shared `:disabled` style is `opacity: 0.55; cursor: not-allowed` (`shared/ui/inputs.css:46-51`). Wrapping the config in `<fieldset disabled>` dims every value D3 says the viewer needs, and in both themes `--app-text` at 55% on `--app-surface-soft` is likely below 4.5:1. Disabled native text inputs and textareas also stop text selection in some browsers, so a viewer could not copy a compute expression. Required:
   - Name the treatment. For example, a `step-focused__fieldset--readonly` and `output-editor-sheet--readonly` modifier that keeps the `disabled` semantics but restores full-opacity text and a default cursor, using tokens. Or use `readOnly` on text fields where the shared components support it.
   - Add a task to measure value-text contrast in light and dark. The `e2e/support/stateContrastProbe.ts` tooling exists for this.
   - Apply the same rule to the OutputEditorSheet read-only fieldset.

3. **The viewer-copy inventory is incomplete, and the audit script cannot find copy.** The task 1.1 script greps handlers, not strings. The proposal commits to giving viewer variants to copy that invites an edit or run, and design.md lists only two strings. These also invite editing and are shown to a viewer:
   - `spine/PipelineSpine.tsx:222`: "Add your first transformation step to start shaping this pipeline's output."
   - `spine/PipelineSpine.tsx:228-230`: "No steps yet — join this source into another lane's step to use it."
   - `spine/PipelineSpineLayout.tsx:327-334`: "Nothing to edit yet" / "Add a step on the left, then edit it here…" and "Pick a step on the left to edit it…"
   - `mobile/MobilePreviewTab.tsx:74`: "Add a step on the Steps tab to see the rows it produces."
   - `liveOutput/LiveOutputColumn.tsx:191`: "No Output yet. Add one from the spine."
   - the phone sheet's `ariaLabel="Step editor"` (`MobileStepSheet.tsx:64`)

   Add each one to D3 "Copy" with its viewer string, and add a jest assertion. Also respell the `OutputSheetPreviewCard` replacement as a whole viewer paragraph. Swapping only "Run the pipeline to populate it." for "No rows yet." leaves an incoherent sentence after "…currently shows 'No data available.'" (`OutputSheetPreviewCard.tsx:57-60`).

4. **Spell out the red-first mechanics so every jest red is behavioural, not a compile error.** Tests that import `canEditFromUi` or pass `editable` / `readOnly` fail `tsc` before they fail on behaviour. `.husky/pre-commit` runs `typecheck` and the full `npm test`, so task 1.2's "COMMIT the red tests" cannot pass the hook. Required:
   - The red commit adds the new API surface as inert stubs: `canEditFromUi` returns true for every role, and `editable` / `readOnly` are accepted and ignored. Each red then fails on its assertion. Paste that assertion line into `red-jest.txt`.
   - Task 1.2 names the hook-bypass decision explicitly. Either `git commit -n`, called out in the commit message and in files-modified per CLAUDE.md, or commit only the e2e red and record the jest red without committing it.

5. **Make the e2e allow-list exact and complete, and seed a schedule.** Without both, the scan can be loosened ad hoc, and the static-schedule behaviour has no end-to-end proof.
   - The allow-list must list exact accessible names. Parameterised forms like "Open {OUTPUT_NAME} output" are fine; no regex or prefix wildcards. It must include the read-only controls the design omits: "Back to pipelines", the "Pipeline path" crumb link, "Output actions for {name}" with its "History for {name}" item, "Displayed Output", the live "Output" toggle (disclosure layout), "Previewed step", the OutputSchemaDisclosure toggle, the source-sample Retry (if visible), the step row select's exact name, the sheet's close control, and the phone tabs.
   - The viewer run seeds a schedule: a PUT by the owner through the API on the fixture pipeline. That makes the red cover "Edit schedule" and "Pause schedule", and the green assert the chip is static text (`toHaveCount(0)` for `button[aria-label^="Edit schedule"]`, text visible). The current fixture has no schedule, so only the "Add schedule" absence is exercised.

### Non-blocking notes

- **D1, null schedule.** For an editor the chip's read-only form during `pending` is nothing, so "Add schedule" pops into the header row when analyze resolves. Either reserve the slot (a `visibility:hidden` placeholder of the same size) or accept and record it in the pending-to-resolved screenshots the design already requires.
- **Analyze failed with no result.** A viewer is treated as `editor` and gets edit controls plus a draft that can never save. This is the HEL-1661 rule, accepted in Risks. It is a known exception to AC1 and should be named as such in the PR.
- **"Edit source" for a viewer who can independently edit the source.** This only appears when the source is in the caller's own list. Hiding it matches AC1's literal wording, but it removes a navigation to a page whose writes the server would allow. Edge case; record the choice.
- **Secondary-source pickers** (join, union, lookup, upsert) resolve labels from the caller's own sources list. A viewer may see a blank value where the source is not theirs. This already affects editors and is not new, but it lowers the value of "configuration shown read-only". Worth a follow-up if it shows up in screenshots.
- **The disabled fieldset also disables read-only helpers inside `StepOpEditor`**, such as the ComputeFunctionReference toggle and any disclosure buttons. Acceptable, but the inventory should record them as intentionally disabled.
- **A viewer with a kept draft** sees the `undoNeedsDiscard` / "Keep editing" copy only after a save, which a viewer cannot do. It is unreachable, so no change is needed.
