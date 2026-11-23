## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed at HEAD e3eda3eda28683075c616a0ebd9935ad4c89b9f9. The planning artifacts are uncommitted in the change dir. Paths are under `frontend/src/features/pipelines/` unless noted.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/pipeline-viewer-read-only/HEL-1794`.

#### Round-2 CR1 (schedule premise): addressed in design, specs and tasks

- **The premise holds on the tree.** `backend/.../PipelineScheduleService.scala` gates `find` and `put` on `pipelineRepo.findByIdOwned`, which I read again. `SpineScheduleChip.tsx:18-28` renders "Add schedule" when `schedule === null`. The chip is mounted at `PipelineSpineHeader.tsx:196` and `MobilePipelineHeader.tsx:188`.
- **design.md** is fixed in four places:
  - The Context block now records the owner-only schedule.
  - D3 "Schedule chip" no longer has a static-text branch.
  - D1 says the schedule chip is "not rendered while `pending`".
  - D4 re-purposes the owner PUT as a guard. The red is "Add schedule" plus "Set schedule". The mutation names the null-schedule "Add schedule" chip. The editor control asserts "Add schedule", and the design notes that an editor's save 404s today and is out of scope.
- **The specs** (`pipeline-detail-spine-layout`, `pipeline-detail-mobile-layout`) now say "no schedule chip and no schedule set/edit/pause/resume". The static-text clause is gone.
- **tasks.md 3.1** now reads "schedule chip and schedule menu items absent (owner PUTs a schedule in the e2e as a guard)".

#### Round-2 non-blocking notes: all taken

- `analyze-proposal` is on the network-watch allow-list.
- The contrast probe now points at both `stateContrastProbe.ts` and `stateContrast.mjs`, and it includes ancestor opacity.
- D2 states the call order and the hoist. I confirmed both:
  - `usePipelineDraft` is at `usePipelineDetailPage.ts:57`, `usePipelineDirtyAndOwner` at `:115` and `usePipelineRunRole` at `:126`.
  - `usePipelineRunRole.ts` contains only two `useAppSelector` reads plus the pure `runRoleOf`, so hoisting it is safe.
- The region aria-label viewer variant is in the copy table. The original is at `PipelineSpineLayout.tsx:277`.
- The `pipelineMobileTestKit.tsx:29-30` "Step editor" lookup is called out.

#### The orchestrator's position on the schedule product question is sound

The question is whether grantees can read a schedule, and whether editors can write one. The answer does not change what this ticket builds:

- **Ticket and AC1:** they require that a viewer sees no actionable edit control. Today a viewer's only schedule surfaces are the "Add schedule" chip and the "Set schedule" menu item, and both are write affordances. They are hidden under either answer.
- **A "yes" answer:** it would only add a read-only schedule fact for viewers. That needs a backend change, which the ticket's "frontend only" note and the design's Non-Goals exclude, and no AC requires it.
- **Editors:** they keep today's behaviour, with "Add schedule" present and a save that 404s. That is a pre-existing editor gap, not a regression from this change.

Routing the gap to a Delivery follow-up (`workflow-state.md` `DELIVERY_FOLLOWUPS`) is correct. I raise no ESCALATION.

#### Fresh checks on the current artifacts

- **SpineStepRow menu:** the row renders its `ActionsMenu` whenever the viewport is not phone (`SpineStepRow.tsx:252-256`), whatever `menuItems` holds. D3's "the executor confirms both are already conditional, else makes them so" covers this. The grip is already conditional on `reorder` (`:149`). The comparers at `:324,326` handle the `[]`/`undefined` change, as the design says.
- **Copy table:** I checked every source string by grep against the tree:
  - `PipelineSpine.tsx:222`
  - `PipelineSpineLayout.tsx:329,333`
  - `MobilePreviewTab.tsx:74`
  - `LiveOutputColumn.tsx:191`
  - `MobileStepSheet.tsx:63-64`
  - `OutputSheetPreviewCard.tsx:59`
  - `OutputHistoryModal.tsx:51`
- **Coverage of the ACs:**
  - AC1 (no edit control, desktop and phone, light and dark) is covered by D3, tasks 3.1-3.5 and the D4 exact allow-list scan.
  - AC2 (no draft) is covered by the D2 hook and routing guards, tasks 2.2/2.3, and the e2e draft attempt with a sessionStorage check.
  - AC3 (e2e red first) is covered by task 1.2 and C15.
  - The driver notes are covered: the inventory script (1.1), the hook guard, the Discard ruling, the editor control on helio_app_test-backed fixture users, and the HEL-1809 comparators.
- **No new placeholders.** Every task has an acceptance signal.

### Verdict: CONFIRM

### Non-blocking notes

1. **Fix before execution (one clause; the orchestrator can do it in place).** `proposal.md:8` still says a viewer can "read the schedule (a static fact, not a button)". That contradicts design D3, both spec deltas and tasks 3.1, which all agree the chip is absent. Implementation is not ambiguous, because spec, design, tasks and e2e all agree. But round 2's CR1 asked for the premise to be corrected everywhere, and this file is archived with the change. Replace the clause with "see no schedule control (a grantee never receives the schedule; follow-up)". The final gate should check that the archived proposal is consistent.
2. The `.spine-row__menu` wrapper (`SpineStepRow.tsx:253`) should not render when `menuItems` is empty, as well as the trigger. Otherwise an empty fixed-width cell stays in a viewer's row. Judge it in the final-gate screenshots against an editor's row.
3. If a viewer's Pipeline actions menu ends up holding only "Run history", it stays in the allow-list. If the executor's inventory shows the menu disappearing in some state, the allow-list must not require it.
