## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: the planning artifacts (ticket.md, proposal.md, design.md, tasks.md, specs/*), which are untracked, on HEAD 361c22f223ee27409b045860aab6ab889bbbb687 (== main), checked against the live tree.

### What I verified (with evidence)
- **Cwd guard:** `assert-cwd.sh` printed READY, branch task/spine-compact-menu-rule/HEL-1671.
- **Round-1 CR1 (stray duplicated THEN):** fixed. The "No gap for an empty markers slot" scenario now has exactly one THEN (specs/pipeline-detail-spine-layout/spec.md).
- **Round-1 CR3 (phone scope):** fixed. D3 and task 2.3 now use `.spine-row:not(.spine-row--phone) .spine-row__markers:empty`. `spine-row--phone` is the real class (SpineStepRow.tsx:143).
- **Round-1 CR4 (non-compact empty-markers test):** fixed. D5.3b, task 1.4 and a new scenario are added at 1100px. The red-on-main claim holds. Outside the compact block, `.spine-row__markers` is `display: inline-flex` (PipelineSpine.css:282-287), and the select has `gap: var(--space-3)` (:219-229). The empty span therefore costs one extra gap today.
- **Round-1 CR2 (hidden ⋮ intercepting a press):** only partly fixed. Option (b) was taken: task 2.3b, D5.3c, and a new scenario. The *mechanism* does not achieve the *contract*. See CR1 below.
- **Item 5:** PipelineSpineHeader.css:345 `@container (max-width: 800px)` (compact chip, next-run text dropped) and :389/:420 `@container (max-width: 600px)`. The delta wording matches. The live spec line 19 still says 1100/900.
- **D4 fixture:** e2e/hel1579-pipeline-spine-layout.spec.ts:57 seeds a `compute` step, and stepNarrowing.ts:111 labels it "Compute column". The measurement is reproducible.
- **D2 backing note from round 1:** addressed. The selected trigger is transparent, and the elementFromPoint check samples the bottom band at 24px and 28px.
- **Hover-gating guard:** pipelineHoverGating.css.test.ts:41 allowlists the exact ungated reveal selector `.spine-row:hover .spine-row__menu`. Adding a property to that same rule keeps it green. The compact block is allowlisted as one unit (:47-48).

### Verdict: REFUTE

### Change Requests
1. **D1's "hidden trigger takes no press" mechanism cannot satisfy D5.3c or the new scenario at 1100px. The design contradicts its own contract.**
   - In regular (non-compact) mode, `.spine-row` is `display: flex` (PipelineSpine.css:183-188). The select is `flex: 1` and is followed by the in-flow sibling `.spine-row__menu` (`flex: none`, :334-338; SpineStepRow.tsx:247-251). The trigger's box therefore lies *outside* the select's box.
   - Task 2.3b gives that menu `pointer-events: none`. A press at the trigger's position then falls through to the `.spine-row` div, not to `.spine-row__select`. That div has no click handler (SpineStepRow.tsx:142-148: only onDragOver/onDrop/title).
   - Result: elementFromPoint returns the row div, D5.3c's "resolves to that row's `.spine-row__select`" fails, and the real `page.mouse.click` selects nothing. The scenario "lands on the row's select button ... and selecting the row then shows its ⋮" is unmet.
   - The touch path D1 relies on gets a 24-28px dead zone at the row's right end instead of a selecting tap.
   - Reproduced in a minimal page with the same structure: a flex row, a `flex:1` button, and a `flex:none` menu with `opacity:0; pointer-events:none`. elementFromPoint at the trigger's centre returned the row div (`hit: "row"`), and the select's right edge equals the trigger's left edge (244 / 244).
   - Compact mode is unaffected, because there the menu is absolute over a full-width select.

   Revise D1, task 2.3b and the D5.3c / scenario wording to one coherent option and record which was taken:
   - (a) In regular mode, the hidden menu also leaves the flow and overlays the select's right end, like compact mode does. The selected row's trigger stays in flow or is reserved explicitly. State the effect on title width at 1100px, because it interacts with D4's measurement.
   - (b) Route a press on the row's hidden-trigger area to selection explicitly, for example an onClick on the row that ignores presses inside the menu. State the a11y implications.
   - (c) Weaken the contract to "does not open the menu" and accept the dead zone. Say so honestly in D1, because it breaks D1's own "tapping an unselected row selects it" premise at the right end.

   Whatever is chosen, D5.3c must assert what the mechanism actually delivers, and that must still be red on main.

### Non-blocking notes
- Task 1.2 / D5: the "derived mode" rule (compact iff the content box is ≤ 226px) is good. Also check it against the CSS's `max-width: 226px`, which is inclusive, so the boundary pixel matches.
- `.playwright-mcp/` in the main checkout received my probe snapshot. It is gitignored (.gitignore:43), so it is harmless.
