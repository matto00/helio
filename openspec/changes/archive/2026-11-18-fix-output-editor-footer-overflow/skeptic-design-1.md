## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 506c224423f3777f8090ef1f6705a501f9bd303e (change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/output-editor-footer-overflow/HEL-1752`.
- **Ticket vs ticket.md**: Linear HEL-1752 has exactly one expected outcome ("at 375px the confirm label fits its button
  (wraps or shortens within the design language), in light and dark") plus an agent note about "Add as tail with
  aggregate" wrapping to three lines. ticket.md's other three ACs (add-tail fit, keep the full label, desktop unchanged)
  are orchestrator additions. The add-tail fold-in is justified: the Linear agent note names it and it is the same rule.
  "Keep the dashboard count" narrows Linear's "or shortens", which is the orchestrator's call (C16). design.md
  Decision 2 calls this "driver/owner direction"; nothing in Linear shows an owner ruling.
- **Evidence screenshot** (`.concertino/runs/HEL-1733/evidence/.concertino/scratch/HEL-1733/sk-phone-dark-confirm-delete.png`):
  the confirm button is squeezed to about 125px. "Confirm / delete / (removes / from 1" spills above the 32px border box
  and "dashboard)" is cut off. Delete, Cancel and Save share one row. This matches the stated root cause.
- **Root-cause claims against the live tree**:
  - `OutputEditorSheet.css:90-94`: `.output-editor-sheet__footer { display:flex; justify-content:flex-end; gap:var(--space-3) }`,
    with no `flex-wrap`. Confirmed.
  - `OutputEditorSheet.css:100-102`: `.output-editor-sheet__delete { margin-right:auto }`. Confirmed.
  - `Modal.css:203-217`: `.ui-modal-btn` has `display:inline-flex; height:var(--control-md); padding:0 var(--space-4)`.
    Confirmed. Lines 272-288 hold the 44px `::after` expander under `(max-width:768px),(pointer:coarse)`. Confirmed.
  - `Modal.tsx:261`: the footer is rendered as `<footer class="ui-modal__footer">{footer}</footer>`. Confirmed.
  - `OutputEditorSheet.tsx:291` uses `size="lg"`, so `.ui-modal--lg` gives `width:min(720px, 100vw-32px)`. At 375px the
    dialog is 343px and the footer content box is 343-40 = 303px (design.md says ~295, close enough).
- **Token math for Decision 2**: `--control-md` is 32px (`theme.css:140`), `--text-sm` is 14px, and body
  `line-height:1.5` is inherited by buttons through `font: inherit` (`theme.css:528-541`), so one line is 21px.
  `box-sizing:border-box` is global.
- **Desktop arrangement today, derived from CSS**: `.output-editor-sheet__footer` is a flex item of `.ui-modal__footer`
  (`justify-content:flex-end`). Nothing sets `flex:1` or `width:100%` on it (grep: no other `.ui-modal__footer`
  descendant rule). So on desktop the inner row is only max-content wide and is pushed to the right. Delete's
  `margin-right:auto` has no effect there: Delete sits next to Cancel, not at the dialog's left edge. It only reaches the
  left edge at 375px, where the row fills the footer. I did not confirm this in a running app at this gate; it comes
  from CSS reading.
- **Affected e2e specs** (grep for `Add as tail with aggregate` / `Confirm delete` / `output-editor-sheet` in `e2e/`):
  `hel908-full-flow.spec.ts:110` clicks "Add as tail with aggregate" (metric kind),
  `hel1390-chart-tail-aggregate-live.spec.ts` covers the chart add-tail seam, and `hel1744-insight-panel.spec.ts:226`
  queries the sheet. tasks.md 3.2 lists only hel1733 and hel1510.
- **Challenged self-approvals**:
  - *Folding in add-tail*: accepted. It is the same rule with the same cause, and Linear's agent note names it.
  - *Scoping to the sheet, not `.ui-modal-btn`*: accepted. A global `height:auto` would touch every modal. The selector
    `.output-editor-sheet__footer .ui-modal-btn` (0,2,0) beats `.ui-modal-btn` (0,1,0), and the media block sets no
    height.
  - *`flex-wrap` + `height:auto` over a copy change*: accepted in direction. A 41-character label at 14px (~290-310px,
    plus 32px padding) cannot fit one line in a 303px footer, so a two-line button is the only option that keeps the
    count. Revision 3 covers the DESIGN.md reconciliation.
  - *E2E geometry only*: accepted in principle, since jsdom cannot lay out. Range-rect containment and the distinct-top
    line count measure content, not CSS text. But the desktop-unchanged claim is not guarded (Revision 1).

### Verdict: REFUTE

The direction is sound. Each revision below is a small artifact edit, but two of them (1, 2) leave the "desktop
unchanged" AC open to an implementation that passes every planned check while breaking it.

### Change Requests

1. **Pin the vertical padding and guard the single-line height.** Decision 2 / task 2.1 says "spacing-scale vertical
   padding" without naming a token, yet design.md claims "single-line buttons keep exactly `--control-md` height".
   That holds only if 21px line + 2x padding + 2px border <= 32px:
   - `--space-1` (4px) gives 31px, so `min-height:32px` wins and height is unchanged.
   - `--space-2` (8px) gives 39px, so every footer button at every width grows 7px.

   A competent implementer could pick either. The planned 1280 check (one shared `top`, single-line labels) would pass
   on the 39px version. Fix:
   - (a) name the token in design.md and task 2.1 (e.g. `padding-block: var(--space-1)`), with the arithmetic;
   - (b) add to task 1.1 an assertion that every single-line footer button's rendered height equals the computed
     `--control-md`. Read it from `getComputedStyle`, not a literal 32. Check at 1280 and for Cancel/Save at 375;
   - (c) add a 1.2 mutation (padding raised to `--space-2`) that turns that assertion red.
2. **State the desktop arrangement as it actually is.** ticket.md AC 4 and the design describe today's desktop as
   "Delete left, Cancel/Save right". From the CSS (see above), today Delete is the leftmost item of a right-aligned
   group, not at the dialog's left edge. Before writing the 1280 assertion, measure the current arrangement on the
   running app (before the CSS change). Reword AC 4, the spec's "Desktop footer unchanged" scenario, and the 1280
   assertion to encode what is measured: Delete's left edge compared with the footer's left edge, plus one shared row.
   Otherwise the spec either asserts something false of today (red for the wrong reason) or quietly takes on a layout
   change. If the planner wants Delete at the far left on desktop, that is a scope addition and must be stated as one.
3. **Address the create-mode wrap and DESIGN.md §5 in Risks.**
   - The Risks section only covers the confirm state. In create mode (Cancel ~80px, "Add as tail with aggregate"
     ~214px, Save ~62px, 12px gaps, 303px line), greedy wrapping depends on font metrics. It can put Cancel alone,
     right-aligned, on line 1 with Add-tail and Save on line 2. Or it can put Cancel and Add-tail on line 1 with Save
     alone on line 2. HEL-1757 is changing e2e fonts, so the result may differ between e2e and real browsers.
   - State which arrangements are acceptable. Make task 3.1 judge the create-mode screenshot in both themes against
     that statement, and consider whether a deterministic grouping is needed.
   - Separately, DESIGN.md §5 says footer buttons are "all at `--control-sm/md` height", and §3 "Control metrics" names
     two-line wrapped labels as the old failure mode. Record in design.md that a two-line confirm (min-height
     `--control-md`, no 44px inflation) is a deliberate, scoped exception, justified by the ticket's "wraps" wording.
     Today it is silently outside the design standard.
4. **Complete the affected-spec list in task 3.2.** Add `e2e/hel908-full-flow.spec.ts` (clicks "Add as tail with
   aggregate" at line 110), `e2e/hel1390-chart-tail-aggregate-live.spec.ts` (the add-tail seam) and
   `e2e/hel1744-insight-panel.spec.ts` (queries the sheet at line 226). Per C12, they run in full.
5. **Correct the authority attribution.** design.md Decision 2 says "Rejected per driver/owner direction". Linear's
   ticket allows "wraps or shortens", and no owner ruling is recorded. Attribute the keep-the-count constraint to the
   orchestrator's scope (ticket.md AC 3 / C16), not to the owner.

### Non-blocking notes

- design.md says ~295px content width. The derived value is 303px (343px dialog minus 2x `--space-5`). It changes no
  conclusion.
- Task 1.1 should also assert the confirm button's `textContent` equals the full "Confirm delete (removes from 1
  dashboard)". The spec requires it, and the geometry checks alone would pass on a shortened label.
- `::after` expander (Decision 3): on a two-line ~47px button the 44px strip is shorter than the box. That is harmless,
  because the box itself is clickable. No change needed.
