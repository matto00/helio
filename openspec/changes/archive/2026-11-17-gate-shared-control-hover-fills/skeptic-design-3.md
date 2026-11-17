## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD fd3fbe7d098e6518cfd5ea44469a5a398cde2742. There are no implementation commits; the change dir is untracked.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ... branch=task/gate-shared-hover-fills/HEL-1675`.
- **Scope is unchanged and still accurate.** `grep -rn ':hover' frontend/src/shared --include=*.css` gives 38 lines in
  20 files, which matches design Context.
- **Round-2 CR1 (IconButton): resolved.** D4 now says that, with this fixture, the only shared IconButton in the sheet
  is the Modal Close button, and it moves IconButton to phone-page instance 5. I checked that instance against the code:
  - `SourceSampleLabel.tsx` renders `<IconButton size="xs" aria-label="Refresh sample of ${sourceName}">` with
    `disabled={loading}`, inside `<div aria-busy={loading}>`. So the "aria-busy false and enabled again" signal is real.
  - It renders through `SpineSourceCard` and `PipelineSpine`, and `PipelineMobileLayout.tsx:195` mounts `PipelineSpine`,
    so the button is reachable on the phone page.
  - `IconButton.css:62/73/85` are `:hover:not(:disabled)`, so the button can show red only after it is enabled again.
    D4 already waits for that.
  - "If it cannot be made red, guard + probe only" is stated.
- **Round-2 CR2 (`.ui-modal-btn` route): resolved.**
  - Route A is now page Save, then `cascadeRequired` (`usePipelineDraftSave.ts:297-300`), and the executor must confirm
    the trigger first.
  - Route B is the leave guard. `useDraftLeaveGuard.ts` intercepts an in-app `a[href]` click while `hasDraft`, and
    `PipelineDraftDialogs.tsx:70-95` renders `ui-modal-btn--secondary`/`--danger` in that case. So route B exists.
  - The Planner Notes no longer claim a sheet-opened dialog.
- **Round-2 CR3 (spec): resolved.** The spec is split into an in-sheet scenario (trigger, item, Select trigger,
  disclosure summary) and a phone-page scenario (refresh icon button, modal footer button). "Desktop hover unchanged"
  now refers to both scenarios. No sheet-opened dialog is asserted.
- **Round-2 CR4 (threshold): resolved.** The expected red set is 1, 3, 4 and likely 5, and 2 and 6 depend on
  reopen-at-point. The escalation rule is "1 or 3 not red, or fewer than four of six". That is consistent with the
  expectation and stops the plan from silently falling back to guard-only coverage.
- **New instance 4 (disclosure summary):**
  - `StepPreviewTable.tsx:279-289` renders `OutputSchemaDisclosure` above the small threshold.
  - `seedPipeline(..., wide)` exists (`e2e/support/hel1582Phone.ts:24-37`).
  - The hover rule is real (`disclosureSummary.css:40`, colour only).
  - The trigger is a button with `aria-expanded` (`OutputSchemaDisclosure.tsx`) that stays mounted.
- **Tidy and guard prerequisites still exist:**
  - `pipelineHoverGating.css.test.ts`
  - `frontend/src/test/` (the target directory for the extracted parser)
  - DESIGN.md `## 5. Buttons` (line 483)
  - `realTap` (`e2e/support/hel1668.ts:150`)
- **Placeholders, contradictions, AC coverage:**
  - There are no TBDs. The tasks map 1:1 to D3-D6.
  - Every AC is covered: the touch e2e is red first (1.1/2.5), the guard covers shared CSS (2.2), and desktop is
    unchanged (2.5/2.6 in both themes).
  - Both follow-ups are filed (3.1).
  - There is no contract or API change, so no delta is needed.

### Verdict: CONFIRM

All four round-2 change requests are addressed with routes that exist in the live tree. The red-or-not-covered rule
and the escalation threshold mean a wrong guess about red-ness gets caught at execution and cannot be silently claimed.
The notes below are corrections the executor should apply. None of them makes the plan unsound, because each affected
instance already has a defined fallback.

### Non-blocking notes

1. **D4 instance 2: the example contradicts its own rule.** The rule says to pick an item that "stays enabled after it
   acts". The example is "Move up on the middle step". On a 3-step trunk, that move puts the step at index 0, where Move
   up is disabled (`useSpineStepActions.tsx`: `disabled: blocked || index === 0`). `ActionsMenu.css:62` is
   `:hover:not(:disabled)`, so the reopened item can never read red. Use "Move down" on the first step instead. The step
   lands at index 1, where Move down stays enabled. It is also the 2nd item in both menus: index 0 only adds "Insert
   step before" after the move items.
2. **Reopen-at-point (instances 2 and 6) has a physical problem.** `realTap` ends by moving the mouse to the tap point.
   Reopening the menu or dialog by tapping the trigger, Save & run, or a link moves the hover point to that new control,
   away from the item or footer button being read. As written, both instances will probably never be red. If the
   executor wants them red, reopen without moving the pointer, for example with keyboard activation of the focused
   trigger. Otherwise expect "guard + probe only" for both. Either outcome is already within the threshold.
3. **Instances 1, 3 and 4 open a scrim over the trigger** (`popover__scrim` in `ActionsMenu.tsx:120` and
   `OutputSchemaDisclosure`, `ui-select__scrim` in `Select.tsx:199`). Whether hover comes back to the trigger after
   Escape is an empirical question. The red-first run answers it, and the escalation rule (1 or 3 not red) covers the
   bad case.
4. **Naming in D4:**
   - The disclosure has no `open` attribute. The settle signal is `aria-expanded` and the "Output schema" panel being
     visible or gone.
   - The phone page's save pill is "Save & run" (`MobilePipelineActions.tsx:75-78`).
   - The leave-guard secondary button is "Keep editing", not "Stay"/Cancel.
