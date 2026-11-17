## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: d60b1f799d78291e165bcc1226b4a3c625c66fa0. The change dir and `e2e/hel1692-table-header-touch-scroll.spec.ts` are untracked, and no code has changed yet. I treated the owner ruling as settled. It is recorded in the main checkout's `.concertino/runs/HEL-1692/events.jsonl` at lines 17-18: `escalation.answered`, `answer: ship-pan-y-as-guard`, `answer_source: human`, id `HEL-1692-1794878263254-f8fa5a`.

### What I verified (with evidence)

- **The ruling is reflected in the plan.** ticket.md has an "Owner ruling" section. The proposal, design (D1-D4), tasks (1.1-5.2) and spec delta all cover the revised AC: pan-y, GUARD labels plus mutation, capped-body triage, plain PR disclosure, and a delete-or-follow-up decision on the dead rule. No AC is left without a task.
- **The handle is still `touch-action: none`, and resize is mouse-only.** I checked `DataGrid.css:321-331` and confirmed the computed value live (`handleTA: "none"`). D1's reasoning holds: `touch-action` never applies to mouse input, so the desktop path is unaffected by construction.
- **The `--table` cap rule is dead.** `PanelKind = "output" | "text" | "markdown" | "image" | "divider" | "form"` (`panel.ts:65`). The stack class is `mobile-panel-stack__item--${panel.type}` (`MobilePanelStack.tsx:257`). No .ts/.tsx file produces `mobile-panel-stack__item--table`. `MobilePanelStack.css:102` therefore matches nothing.
- **Which element actually scrolls in a capped Table body. I measured this live, at two widths.** Setup: servers on 7124/10031, a dashboard with one output Table of 80 rows plus 4 Notes cards, phone stack.
  - 375x812: `.mobile-panel-stack__item--output .panel-content` has `scrollHeight 487 == clientHeight 487`, with max-height 487.2px (60dvh). **It does not overflow.** `.ui-data-grid` has `scrollHeight 2854`, `clientHeight 418`, `overflow-y: auto`. **That is the real nested scroller.** The `thead th` is `position: sticky` inside it.
  - 430x932: `.panel-content` is `559 == 559`; `.ui-data-grid` is `2854 / 490`. Same result at both widths.
  - This matches the HEL-451 design comments: `DataGrid.css:19-34`, and `DataGrid.tsx:~140-152` ("the no-scroll invariant still holds in every state the APP itself chooses"). Under that design `.panel-content--table` is deliberately not the scroller, and `.ui-data-grid` gets the vertical cap.
- **Consequence for D3, task 4.1 and the proposal.** They prescribe asserting `scrollHeight > clientHeight` on `.mobile-panel-stack__item--output .panel-content`, and the proposal calls it "the body ... with its own vertical scroller". Neither matches the live tree. The in-progress spec's capped test asserts `.panel-content--table` overflows by more than 100px, so as written it would fail. It would fail loudly, not vacuously, but the plan sends the implementer to the wrong element.
- **The dead-rule deletion (D4 and task 2.3) is under-specified and partly wrong.**
  - `.mobile-panel-stack__item--table` appears in two places in the CSS: the `:54` selector list (container-type override) and the `:102` cap rule.
  - The test's `intrinsicKinds` `"table"` entry (`MobilePanelStack.css.test.ts:45-65`) uses `findRuleBody`, which takes the first `indexOf` match. That entry therefore tests the `:54` list, not the `:102` rule. There is no test entry for the rule D4 deletes.
  - `mobilePanelHeights.ts:39-41` cites `.mobile-panel-stack__item--table .panel-content--table` as the place where the Table cap lives. Deleting the rule would leave that citation dangling, and no task covers it.
- **G1 is failable.** It is a static computed-`touch-action` check along the hit chain. Restoring `none` on the handle makes it red directly. Sound.
- **G2's failability plan has a loophole.** Mutation on the `th` or a header ancestor is good. The fallback, "show G2 failable on the Notes-card control", does not mutate G2's own drag path. All it would show is that the harness honours touch-action. That would not meet the ruling's "shown failable by mutation". The fallback is also unnecessary: the Notes-card control already shows that Chromium honours `touch-action: none` on a stack card. Injecting it on the Table's own card, `.mobile-panel-stack__item--output`, which is on G2's hit chain, should turn G2 red.
- **G3 is failable** by neutralising the mousedown path. Sound.
- **Honesty of the framing.** proposal.md "Why", first sentence: "a vertical drag that starts on a Table header's column-resize handle does not scroll the page". That states the unreproduced symptom as observed fact, and the same paragraph's measurement (8/8 scrolled) contradicts it. Task 2.1's code comment, "the property only ever blocked panning", has the same problem. The PR body is likely to be drafted from these sentences.
- **The hel1656 stale comment** is at `e2e/hel1656-pull-to-refresh.spec.ts:111` and is covered by task 2.2.

Environment note: the measurement created one throwaway dev-DB user, `hel1692-skeptic-1794881018359@example.com`, with one dashboard, source, pipeline and output. The e2e teardown registry does not record it. Servers were stopped with `stop-servers.sh` (`STOPPED ports=7124,10031`).

### Verdict: REFUTE

### Change Requests

1. **Name the real nested scroller (D3, task 4.1, proposal "What Changes", spec rationale).**
   - Live measurement at 375 and 430 shows the 60dvh cap sits on `.mobile-panel-stack__item--output .panel-content`, but that element does not overflow. The vertical scroller is `.mobile-panel-stack__item--output .ui-data-grid`, and the sticky header lives inside it.
   - Revise D3 and task 4.1 so that, immediately before the drag:
     - C1's overflow and `scrollTop === 0` assertions are made on `.ui-data-grid`, located inside the card through the live cap selector.
     - `.panel-content` is additionally asserted not to be scrolled away from `scrollTop` 0, so neither scroller can absorb the drag unnoticed.
   - Correct the proposal's sentence calling `.panel-content` the body "with its own vertical scroller".
   - Note in the spec that the header drag starts inside this scroller when the body overflows. The requirement's "whenever the Table's own body cannot scroll further" already covers that case; say so explicitly.
2. **Make D4 and task 2.3 unambiguous and correct.**
   - State whether only the `:102` cap rule is deleted, or whether `--table` is also removed from the `:54` selector list (which then requires dropping `"table"` from `intrinsicKinds`).
   - Remove the false claim that the `:102` rule has an entry in `MobilePanelStack.css.test.ts`. Its `"table"` entry tests `:54`.
   - Add updating the dangling citation in `mobilePanelHeights.ts:39-41` to point at the live `.mobile-panel-stack__item--output .panel-content` cap.
3. **Close G2's failability loophole (design D2, task 2.1).**
   - G2's mutation must sit on G2's own drag path. Climb from the hit `th` to its header ancestors and stop at the Table card `.mobile-panel-stack__item--output`, the same card-level injection the Notes control showed Chromium honours.
   - Drop the "show G2 failable on the Notes-card control" fallback.
   - If no element on the Table's own path blocks the pan, stop and report it. G2 cannot then be claimed as failable, which the ruling requires.
4. **Do not state the unreproduced symptom as fact.**
   - Reword proposal.md "Why", sentence 1, as the reported, spec-predicted behaviour that did not reproduce in Chromium (8/8 scrolled) and remains untested on iOS WebKit.
   - Reword task 2.1's code-comment brief from "only ever blocked panning" to "could only block panning, never enable a touch resize".
   - Together these keep the PR body and code comment honest under the ruling.

### Non-blocking notes

- The in-progress `e2e/hel1692-table-header-touch-scroll.spec.ts` still labels the handle test `red-first` and its header says the drag "used to be dead". Task 1.1 must relabel both as GUARD, per the ruling and C2.
- That spec has a desktop guard (G3), but no G1 static touch-action assertion yet. Task 1.1 covers adding it.
