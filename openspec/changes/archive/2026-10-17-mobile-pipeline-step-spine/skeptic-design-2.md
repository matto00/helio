## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 3d9e5a6cb1b4a95c343856283a074c8d663e801f. The planning artifacts are uncommitted in the change dir.
`openspec validate mobile-pipeline-step-spine --strict` → "Change 'mobile-pipeline-step-spine' is valid".

### What I verified (with evidence)

How I checked: I re-read ticket.md, proposal.md, design.md, tasks.md, the 3 spec deltas and skeptic-design-1.md, then checked each round-1 request against the revised text and the live code.

- **CR1 (about 183 river-driven jest tests): resolved.**
  - D9 now covers them, with a three-way sort (retarget, port, or delete with a named replacement) and a mapping in
    `evidence/test-mapping.md`.
  - Task 4.2 and constraint C6 carry the same requirement.
  - spine.test.tsx:709 gets inverted.
  - Task 5.3 no longer claims "no edits" for the river-driven files.
- **CR2 (superseding requirement): resolved.**
  - "River view and phone footer are retired" now runs the other way: desktop-side obligations that are not about
    placement apply at ≤768px unless this capability says otherwise.
  - It names the five obligations I asked for, and it has a branch-lane validation scenario.
  - Count check: `grep -rc "Layout scope (HEL-1579)" openspec/specs` → 41 paragraphs in 19 capabilities. design.md says
    ~41; proposal.md says ~42 (a nit).
  - FU-1 instead of a Linear id: I cannot verify the driver's instruction from here. The obligation is now carried by a
    normative requirement, not by the follow-up, so a named candidate is enough to trace it. I accept it, with a note
    below.
- **CR3 (schedule on phone): resolved.**
  - D2 and the header requirement add the schedule state, with a "Paused" scenario.
  - `SpineScheduleChip.tsx` exists and renders "Add schedule", the expression, and a visible `Paused` sub-label, with the
    full state in `title`.
- **CR4 (Source/Output card actions): resolved.**
  - D4 and the Steps-tab requirement now say what a card tap does.
  - They keep "Source actions for <name>" (Edit source, Remove from pipeline) and "History for <name>", plus "New output".
  - The chevron is decoration only.
- **CR5 (sheet mechanics): resolved.**
  - (a) No body drag path; `touch-action: none` on the handle and header.
  - (b) No transform at rest: constraint C7, with a unit test and a spec scenario.
  - (c) `open` is held through the exit animation.
  - (d) Veto order: request close first, spring back if vetoed.
  - (e) The entrance override is by specificity.
  - Checked against Modal.css on main:
    - `.ui-modal[open]` uses `ui-modal-in … backwards`, and the comment at lines 13-18 confirms the
      transform/containing-block hazard.
    - Main has no `data-motion` rule in Modal.css (that is HEL-1584's branch). D6(e) names the scope it must beat.
    - `Modal` takes `className` (Modal.tsx:38), so it can be composed without editing it.
- **CR6 (sheet identity): only partly resolved. See Change Request 1.**
  - The AI-draft swap is handled.
  - `useStepSelection.ts:63-74`'s added-step logic is extracted rather than copied.
  - Duplicate and shape steps are included.
  - But the ordinary create path breaks the stated close rule.
- **CR7 (Runs loader): resolved.**
  - D8 adds `ensureRunHistoryLoaded()`, and task 5.2 asserts `historyOpen` stays false.
  - `useRunHistory.ts:68` already computes `fresh`, so "loads unless fresh" is well-defined.
- **CR8 (partial badge): resolved.**
  - D4 keeps "N steps" and `TruncatedRowCountBadge` visible.
  - The spec has a "Partial counts visible" scenario.
- **Scenario-name claim: verified.**
  - I copied `openspec/` to `.concertino/scratch/HEL-1582/skeptic-d2/` and renamed the scenario there.
  - `openspec validate --strict` then fails with: `MODIFIED "Desktop pipeline detail renders…" omits scenario(s) the
    current spec still has: "Phone layout unchanged"… archive refuses to drop them`.
  - Keeping the name with a corrected body is the correct response.
- **Other checks**
  - `--control-lg` is 40px (theme.css:69), so D7 and task 3.6 agree.
  - The touch-target and contrast utilities named in D10 exist (hel813 specs, `state-surface-contrast-guard.spec.ts`).
  - The height budget is rechecked under pessimistic sizes (source 88, output 76, 8 gaps of 8px): the list ends at about
    672 against a bar top of about 692. That is tight but feasible, and the D10 e2e asserts it.

### Verdict: REFUTE

Seven of the eight round-1 requests are fully resolved, and the design is close to ready. CR6 is not.

D5 fixes the AI-draft swap. It does not fix the far more common case: a normal append, insert or lane add, where a step appears with a temp id and is then swapped for a server id. As written, every normal add would close the sheet when the server confirms it. Task 5.2 does not test this case.

### Change Requests

1. **Say what the open sheet does when an ordinary create swaps its temp id for the server id, and add a test.**
   - **Why the current rule fails.** Only drafts keep a `renderKey` through the swap:
     - `usePipelineStepCreation.ts:97` says "`renderKey` is set for drafts only".
     - The non-draft callers `usePipelineStepCreation.ts:193` and `usePipelineLaneStepCreation.ts:110` call
       `applyCreated(tempStep.id, created)` with no renderKey.
     - `usePipelineDraftCreate.ts:84` is the only caller that passes one.
   - **What happens today under D5, step by step:**
     1. The user adds a step.
     2. The temp step appears, `useAddedStepId` reports it, and the sheet opens keyed by the temp id.
     3. The editor is disabled ("Saving step…").
     4. The server confirms. The temp step is replaced by a step with a server id and no renderKey (its key is now the
        server id).
     5. No step has the open key any more. D5 ("closes only when no step has that key") and the spec ("removing the open
        step SHALL close the sheet") then require the sheet to close: exit animation, then Modal focus restore.
     6. In the same commit, the server id counts as "appeared", so "any step that appears opens in the sheet" reopens it.
   - **Effect.** A visible close/reopen and a focus jump on every normal add, or a race between the exit animation and
     the new open.
   - **Fix.** Pick one and state it in D5 and in the "Step editor sheet" requirement:
     - **Option (a), recommended.** If the open key disappears in the same render that `useAddedStepId` reports a new
       step, the sheet re-keys to the new step and stays open, with no exit or entrance animation. Only a disappearance
       with no replacement closes it. This mirrors how `useStepSelection` lets `lastAdded` take over.
     - **Option (b).** Resolve the open key through the create seam: carry the temp id to the persisted step, for example
       by passing `renderKey` for non-draft creates as well. This changes shared step state, so state that desktop is
       unaffected.
   - **Test.** Add a jest scenario next to "AI temp→server swap keeps sheet open" in task 5.2: an ordinary append in a
     sheet that is already open stays open through the server confirm (no close callback, no remount flash) and ends up
     showing the persisted step's enabled editor. Add a matching spec scenario.

### Non-blocking notes

- **FU-1 and FU-2.** These are follow-up candidates, not filed tickets. Their traceability now depends on the
  orchestrator's handback and the PR body naming them. Make sure both do, so the driver actually files them.
- **Source card markup.** The tappable source card contains its own "Source actions" menu button and the sample-label
  refresh control. Do not make the card body one `<button>` that wraps them, because nested interactive elements are
  invalid. Use a sibling or stretched-link pattern.
- **Empty `draft-status` slot.** It must take zero height (and no gap) while empty. Otherwise it eats the AC1 budget and
  the bar clearance.
- **Paragraph count.** proposal.md says "~42" and design.md says "~41"; the grep finds 41.
- **Round-1 notes still open for the PR.** Record the phone draft-status location on HEL-1631, and explain in the PR body
  why Dry run is opaque.
