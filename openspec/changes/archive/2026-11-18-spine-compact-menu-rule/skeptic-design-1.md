## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: the planning artifacts (ticket.md, proposal.md, design.md, tasks.md, specs/*) as untracked files on HEAD 361c22f223ee27409b045860aab6ab889bbbb687 (== main), against the live tree.

### What I verified (with evidence)
- Cwd guard: `assert-cwd.sh` printed READY, branch task/spine-compact-menu-rule/HEL-1671.
- Item 1 premise: `PipelineSpine.css:86` `.spine-card__menu` has no opacity rule, so it is always visible. `:334-344` regular `.spine-row__menu` is opacity 0 and revealed by hover, focus-within or --selected. The compact block `:430-520` cancels the selected reveal (`:489` opacity 0) and sets `pointer-events: none` (`:485`). CONFIRMED.
- Item 2 premise: the compact grid is `auto minmax(0,1fr) auto auto` with `column-gap: var(--space-2)`. `.spine-row__markers:empty` is display:none, but the markers track stays, so the summary and count are separated by 2 gaps. The test in D5.3 would therefore be red on main. CONFIRMED. `:empty` is reliable here because SpineStepRow.tsx:179-240 renders only conditional children, with no whitespace text nodes.
- Item 3 premise: e2e/hel1608-spine-count-overlap.spec.ts checks overlap and containment only. It has no compact-mode assertion. CONFIRMED.
- Item 5 premise: PipelineSpineHeader.css:345 `@container (max-width: 800px)` (compact chip, 16ch, next-run hidden) and :389 `@container (max-width: 600px)` (paused icon dropped). The live spec line 19 says 1100/900. The delta wording matches the CSS. CONFIRMED.
- D1 rationale: DESIGN.md:506-516 (HEL-1675) treats a hover reveal as a named exception. Card surfaces are buttons (`.spine-card__open`). The argument against "all hover-only" holds. The arithmetic against "all always-visible" (148px content box, 24-28px trigger, lane indent) is consistent with the CSS.
- D2 placement: this is feasible. The title keeps the full span of line 1. The trigger goes on a trailing line-2 track, absolute at the row's right edge, and the row is `position: relative`. The vertical-overlap risk is acknowledged, with an elementFromPoint check and a fallback.
- D5 red-first: D5.2 is red on main (selected compact trigger opacity 0). D5.3 is red on main (2 gaps). D5.1 is honestly labelled as a guard that turns red under mutation. These are real.
- Hover-gating guard: pipelineHoverGating.css.test.ts:28,47 allowlists the whole compact container as one unit, so the D2 rules inside it stay covered.
- `openspec validate spine-compact-menu-rule --type change`: valid. Validation does not catch the defect in CR1.

### Verdict: REFUTE

### Change Requests
1. **Stray duplicated line in the spec delta.** `specs/pipeline-detail-spine-layout/spec.md:26` repeats line 12 verbatim ("- **THEN** every step title in the spine ... editor-action checks still pass"). It sits under the "No gap for an empty markers slot" scenario and gives that scenario a second, unrelated THEN. When archived, it would corrupt the canonical spec. Delete line 26 and the blank line before it. Reproduced with grep: hits at lines 12 and 26.
2. **The new SHALL "A hidden ⋮ SHALL NOT intercept a pointer press meant for the row" applies "at every desktop width", but no task implements it outside compact mode, and main violates it there.** In regular mode `.spine-row__menu` is `opacity: 0` with pointer events live and stays in flow (PipelineSpine.css:334-338). On a no-hover touch device above 768px, a tap where an unselected row's invisible ⋮ sits opens that row's menu instead of selecting the row. That is the exact touch path D1 relies on ("tapping an unselected row selects it"). Either:
   - (a) scope that sentence to compact rows, or
   - (b) add a task and an e2e or unit assertion that the regular hidden trigger does not take a press. One way is `pointer-events: none` until hover, focus-within or selected, in a form the hover-gating guard accepts.

   Record which option was taken in design.md D1.
3. **D3's "move `.spine-row__markers:empty` to the base rules" contradicts the Non-Goal "Phone rows (`spine-row--phone`) are untouched".** Phone rows render the same `.spine-row__markers` span inside a flex select. A base rule therefore also removes the 12px gap on the phone list, which the spec scopes to desktop ("at every desktop width"). Change D3 and task 2.3 to scope the rule so phone rows are excluded, for example `.spine-row:not(.spine-row--phone) .spine-row__markers:empty` or the desktop-only spine container. Otherwise state explicitly that the phone change is intended and add it to scope.
4. **The non-compact half of the empty-markers SHALL has no test.** The delta requirement ("A step row with no markers SHALL spend no width or gap on an empty markers slot") covers every desktop width, and D4's item-4 decision depends on reclaiming that gap at 1100px. Yet D5.3 and the only scenario cover compact rows only. Add a D5 assertion at 1100px (non-compact). One option: the empty markers element has `display: none`, or the title-to-count spacing equals one flex gap. Make it red on main and record the red. Also extend the "No gap" scenario's WHEN or add a scenario so the spec is not compact-only.

### Non-blocking notes
- D2: the compact menu currently has an opaque backing (`background: var(--app-bg)`, accent gradient on the selected row). If the selected trigger keeps that backing and its 24/28px box rises a few px into line 1, the backing, not just the glyph, can clip the title's descenders at the far right. The elementFromPoint check should sample the bottom band of the title's visible box, not only its centre. The coarse-pointer 28px trigger in the "align to bottom padding" fallback still rises about 4px into line 1, so measure that variant too, or drop the backing on the selected row.
- D4 / task 3.1: the hel1608 spec seeds only "sort" steps. Name which spec or seed provides the "Compute column"-class label measured at 1100px, for example the hel1579 fixture, so the before/after numbers are reproducible.
- Task 1.2: "1024 checked for its own mode". State which mode 1024px is expected to be in, at list default and max, so the assertion is deterministic rather than discovered.
