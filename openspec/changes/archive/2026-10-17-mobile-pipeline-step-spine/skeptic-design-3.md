## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 3d9e5a6cb1b4a95c343856283a074c8d663e801f. The planning artifacts are uncommitted in the change dir.
`npx openspec validate mobile-pipeline-step-spine --strict` → "Change 'mobile-pipeline-step-spine' is valid".

### What I verified (with evidence)

I re-read ticket.md, proposal.md, design.md, tasks.md, all three spec deltas and skeptic-design-2.md. I checked the open round-2 items against the revised text and the live code.

- **Round-2 CR1 (sheet identity when an ordinary create's temp id is swapped for the server id): resolved.**
  - **What the artifacts now say.** D5 takes option (a): if the open key disappears in the same commit that `useAddedStepId` reports a new step, the sheet re-keys to that step and stays open, with no exit or entrance animation. It closes only when its key is gone and nothing was added (a removal).
  - **Spec and tests.** The "Step editor sheet" requirement says the same and adds the scenario "Added step stays open through confirmation". Task 3.4 and task 5.2 carry it ("ordinary append confirm keep the sheet open with no close/reopen").
  - **Checked against the code: the re-key can happen in the same commit.**
    - `useStepSelection.ts:61-74` works out which ids were added during render, from state adjusted during render. Its comment at :61-63 says this is so "the very render that swaps a created step's temp id for its server id already knows the new id".
    - `applyCreatedStep.ts` replaces the temp in place (`local.map((s, i) => (i === tempIndex ? createdStep : s))`). So one list update removes the temp id and adds the server id. The extracted `useAddedStepId` therefore reports the server id in the same render that the open key disappears.
  - **Cited lines verified.**
    - `usePipelineStepCreation.ts:97` says "`renderKey` is set for drafts only".
    - `usePipelineStepCreation.ts:193` and `usePipelineLaneStepCreation.ts:110` call `applyCreated(tempStep.id, created)` without a renderKey.
    - `stepRenderKey` is `step.renderKey ?? step.id` (`stepTree.ts:51`).
  - **AI drafts.** The server step keeps renderKey = temp id, so the open key survives the swap. The added server id resolves to the same render key, so nothing changes.
- **Round-2 note (source card must not nest controls): addressed.** D4 and task 2.5 make the mono name the "Edit source" button, as a sibling of the menu and refresh controls, "never nesting them".
- **Round-2 note (empty draft-status slot must take zero height): addressed.**
  - D7 makes the slot a zero-height `data-slot="draft-status"` row with no padding or gap while empty (`:empty`).
  - The floating-pills requirement says "empty, zero-height".
  - Task 5.2 asserts it.
- **Round-2 note (paragraph count): fixed.**
  - `grep -rc "Layout scope (HEL-1579)" openspec/specs` sums to 41.
  - proposal.md:42 and design.md now both say ~41.
- **Placeholders.** A grep for TODO/TBD across proposal, design, tasks and specs finds nothing.
- **D7 positioning premise.** `PipelineDetailPage.css:1-7`: `.pipeline-detail-page` is `position: relative; height: 100%; overflow: hidden`. An absolutely positioned action bar inside it with an inner scroller is therefore sound.
- **AC coverage is unchanged from round 2 and still complete.**
  - AC1: D4 budget plus the D10 e2e.
  - AC2: D5/D6 plus the jest test for every `OpType` and the e2e touch drag and close button.
  - AC3: D7 ResizeObserver clearance plus the e2e.
  - AC4: D10 probe sweep at 375, 390 and 768.

### Verdict: CONFIRM

Every round-1 and round-2 change request is resolved in the artifacts and holds up against the live code. Nothing in the current design blocks implementation.

### Non-blocking notes

- **A wholesale sync can arrive first.** In Case 1 of `applyCreatedStep` (a wholesale sync already brought in the created step), the server id appears while the temp still exists. The "any appeared step opens" rule then moves the sheet to the server step before the temp is dropped. That is the right outcome. The jest test should not assume the swap only ever happens in place.
- **Only the editor is re-keyed.** Key `StepCardFocused` by render key, not the `BottomSheet`. Otherwise the re-key remounts the Modal and replays the entrance, which breaks the D5 promise.
- **A failed create does not close the sheet.** On a failed create the temp step stays (`usePipelineStepCreation.ts:194` comment), so the sheet stays on the disabled temp editor. Make sure the error is visible inside the sheet.
- **Carried over from round 2.**
  - Name FU-1 and FU-2 in the PR body and handback so the driver files them.
  - Record the phone draft-status location on HEL-1631.
  - Explain the opaque Dry run in the PR body.
