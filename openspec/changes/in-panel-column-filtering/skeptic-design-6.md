## Skeptic Report — design gate (round 5, skeptic-design-6.md)

Scope: the REVISED D10. D10a and the owner's authorization of the reframe are settled and not
re-litigated. Implementation is not required to exist.

### What I verified (with evidence)

Every line reference in the revised D10 checks out at HEAD (`61cba49a`, rebased onto `origin/main`
`95b6c619`):

- `DataGrid.tsx:376` un-filtered early return, `:383` `.ui-data-grid__empty-wrap`, `:390` `rootClasses`,
  `:402` `<div className={rootClasses} role="region" ref={scrollRef}>`, `:554` `--columns` row,
  `:263-267` the three row refs + `stickyOffsets` + `stickyCellMaxWidth`, `:269-297` the effect
  (deps `[filterable, filterExpanded, resolvedColumns.length, resolvedDensity, scrollRef]` — no width).
- `DataGrid.css:1-4` `.ui-data-grid { border-radius; overflow: auto }`, `:62-63` `table-layout: fixed`
  scoped to `--full`, `:66-81` thead-th truncation (`white-space: nowrap` + ellipsis), `:122-128`
  `tbody td` truncation (`max-width: 240px` tbody-only), `:228-240` `.ui-data-grid__sticky-cell`,
  `:260-262` the `73a2dd0c` reset whose selector list is EXACTLY the three cells D10 removes,
  `:402-405` `.ui-data-grid__empty-row`.
- `PanelContent.css:50-52` `.panel-content--text, .panel-content--table { overflow-y: auto }`;
  `:110-116` `.panel-content--table` flex-column, `align-items: stretch`, `min-height: 0`.
- `PanelDetailModal.css:19-23` `__inner` flex-column `height:100%`; `:61-66` `__view-body`
  `flex: 1; display:flex; flex-direction:column; min-height:0` — so the modal's vertical scroller is
  also `.panel-content--table`, same as the panel.
- No CSS outside `DataGrid.css` selects `.ui-data-grid` at all (grepped all `frontend/src/**/*.css`).
- Four `<DataGrid>` call sites: `TableRenderer.tsx:431` (full) and three `variant="preview"` sites
  (`StepCard.tsx:382`, `SourceDetailPanel.tsx:288`, `SqlTab.tsx:223`).
- `DataGrid.test.tsx` — enumerated every affected test by line (see CR5).

**Corrections 1–6 assessed one by one:**

| # | Correction | Holds? |
| --- | --- | --- |
| 1 | Toolbar/quick BEFORE the scroll container | **Yes, and it is right** — `.panel-content--table` is the scroller on BOTH surfaces, verified above. The message-AFTER reasoning does NOT hold — CR1. |
| 2 | Scroller named per surface, established by measurement | **Yes**, and it is now factually correct for both surfaces. But it names the wrong sticky scrollport implication — CR4. |
| 3 | Reset becomes fully dead, deleted outright | **Yes, correct.** Selector list at `:260-262` is exactly the three removed cells; `thead th`/`tbody td` group untouched. But the *presentational* rules for the same chrome are not disposed of — CR2. |
| 4 | Two guards retargeted-or-deleted, mutation-shown | **Partially** — the process rule is right, the enumeration is wrong and the named replacements were dropped — CR5. |
| 5 | Shell survives, only tbody rows absent | **Yes, the trap is closed.** But the now-genuinely-empty `<tbody>` is unspecified — CR6. |
| 6 | `__frame` naming / no modifiers / className routing | **Naming is right** (`__empty-wrap` at `:383` confirmed). The rest of round 1's CR6 was dropped — CR3. |

**Does the reframe still kill `stickyCellMaxWidth`?** Yes. With no `colSpan` cell left, no element
inherits the 12,160px `table-layout: fixed` width, the chrome is naturally frame-width, and nothing
measures a viewport. That part is real. **But moving the chrome out creates two needs D10 has not
noticed** — CR2 (the chrome's styling is keyed to `th`-in-table selectors and to a density modifier
that is no longer an ancestor) and CR4 (the surviving measurement).

**Is `stickyOffsets.columns` a legitimate survivor?** The HEIGHT-vs-WIDTH distinction is real, not a
loophole: `columns: headerHeight + toggleHeight + quickHeight` collapses to `headerHeight` post-D10,
and `thead th` is `white-space: nowrap` + ellipsis (`DataGrid.css:66-81`), so header height is
genuinely width-invariant — it does not inherit finding 3's stale-on-resize mechanism. **That is the
wrong question, though.** See CR4: the measurement may compute a correct number that no longer
affects anything.

### Verdict: REFUTE

D10's direction is right and its central claim holds. Six mechanical revisions below; CR1 and CR4 are
the ones that would otherwise reach a fourth final gate.

### Change Requests

1. **Move the filtered-empty message BEFORE the scroll container too; the "the table is short"
   reasoning is unsound.** Whether the message is below the fold is decided by the height of the
   *scroller* (`.panel-content--table`), not by the height of the table inside it. In the
   filtered-empty state with filters expanded, the scroller's content is: toolbar + quick-filter row
   + (header row + per-column filter row + empty tbody) + message + `.panel-content__disclosure`
   (`TableRenderer.tsx:444`, itself already after the grid). A minimum-height dashboard panel is
   easily shorter than that stack, so the message goes below the fold in exactly the state the ticket
   calls the sharpest ("a filter matching nothing… renders as a confident answer, and wrong").
   Deferring this to "verify rather than infer" also leaves a geometric decision open at
   implementation time, which is the pattern this gate exists to stop. Required: state the ordering as
   toolbar → quick-filter → filtered-empty message → `.ui-data-grid`, i.e. **all** frame chrome
   precedes the scroll container, and state the invariant in terms of the scroller's height, not the
   table's.

2. **Re-home the chrome's presentational CSS, which the move silently deletes.** The toolbar and
   quick-filter rows get their entire visual treatment from table-cell selectors that will no longer
   match: `.ui-data-grid__filter-toggle-row th` (`DataGrid.css:274-279` — `background:
   var(--app-surface-soft)`, `border-bottom`, `padding: var(--space-1) var(--space-2)`),
   `.ui-data-grid__filter-row th` (`:185-190` — same recipe), and `.ui-data-grid__empty-row`
   (`:402-405` — `padding: var(--space-4) var(--space-3)`, `text-align: left`) for the message.
   D10-3 lists what is deleted but never says these must be replaced; as written the chrome ships as
   unstyled bare controls on a bare background. Compounding this: density/variant modifiers
   (`ui-data-grid--condensed` etc.) live on `.ui-data-grid`, which after the reframe is a **sibling**
   of the chrome, not its ancestor — so `.ui-data-grid--condensed .ui-data-grid__table th` can no
   longer reach the toolbar at all. Required: name the frame-level replacement rules (surface,
   border, padding, and the DESIGN.md tokens they use), and state explicitly whether the chrome
   responds to density — and if it must, which element carries the modifier class for it.

3. **Finish the frame contract; round 1's CR6 was only half-answered.** The revision covers naming
   and `className` routing but dropped the rest. Required, explicitly: (a) the frame carries
   `min-width: 0` / `min-height: 0` — it becomes the flex item of `.panel-content--table` (flex
   column, `align-items: stretch`, `min-height: 0`) and, in the modal, of that same box under
   `__view-body`, so every ancestor flex/height rule that used to land on `.ui-data-grid` now lands on
   the frame; (b) `.ui-data-grid--full .ui-data-grid__table`, the scroll-shadow modifiers
   (`--scroll-left`/`--scroll-right`, `DataGrid.css:16-30`) and `border-radius` stay on the scroll
   container; (c) the frame is introduced for **all four** call sites, including the three
   `variant="preview"` consumers (`StepCard.tsx:382`, `SourceDetailPanel.tsx:288`,
   `SqlTab.tsx:223`), and must be layout-neutral for them — no CSS outside `DataGrid.css` selects
   `.ui-data-grid`, so nothing breaks by selector, but the new element becomes their flex/grid item
   and that must be stated rather than assumed; (d) the un-filtered empty early-return
   (`DataGrid.tsx:376-388`) does **not** get a frame, so the component's root element is
   conditionally the frame, a `<p>`, or `.ui-data-grid__empty-wrap`.

4. **SEVENTH ASSUMPTION — establish that the surviving sticky machinery does anything, or delete it.**
   D10 keeps `stickyOffsets.columns` and its `useLayoutEffect` on the reasoning that the per-column
   filter row must stack below the header row. That presumes the sticky *engages*. `.ui-data-grid` is
   `overflow: auto` on **both** axes (`DataGrid.css:1-4`), so `.ui-data-grid` — not the ancestor
   `.panel-content--table` — is the nearest scrolling ancestor and therefore the sticky scrollport for
   every `thead` row; and D10-1 itself establishes that `.ui-data-grid` has no height cap and never
   scrolls vertically on either surface. If that is right, `position: sticky; top: <offset>` on the
   header and per-column filter rows is **inert**, and the measurement effect survives the reframe
   producing a number nothing consumes — the same class of dead geometry the reframe exists to
   remove, and precisely the "fix one invariant, the next one surfaces" pattern that halted this
   ticket. Required: establish by measurement, per surface, whether the header row and the per-column
   filter row actually pin during vertical scroll. If they do not, delete `stickyOffsets`, the
   `useLayoutEffect`, `headerRowRef`, and the `position: sticky` declarations along with the rest —
   which also makes the success criterion total (no layout measurement of any kind remains). If they
   do, name the scrollport that makes them pin and state what re-triggers the measurement.

5. **D10-4 under-enumerates the invalidated tests and drops the named replacements.** At HEAD the
   reframe invalidates, at minimum: `DataGrid.test.tsx:405` (sticky-cell carries the pin), `:421`
   (per-row sticky-cell wrapper counts), `:749` (the filtered-empty message renders as a `colSpan`
   row inside `tbody`), `:805` and `:840` (THREE distinct increasing sticky offsets — `:840` is a
   mutation-failable guard on machinery D10 *keeps*, and D10 never mentions it), `:880` and `:915`
   (the computed inline `maxWidth`), `:936` and `:948` (STATIC SOURCE guards on the reset rule and on
   `.ui-data-grid__sticky-cell`). D10 cites only two ranges. Required: enumerate all of them, and
   restore the three named replacement guards round 1's CR4 asked for, which the revision replaced
   with a generic process rule — (a) no element inside `<table>` carries `colSpan`; (b) no inline
   `maxWidth` is computed anywhere in `DataGrid` (the failable form of the success criterion);
   (c) toolbar, quick-filter and the filtered-empty message all precede `.ui-data-grid` in DOM order
   (the failable form of CR1). `:730` (filtered-empty renders the full grid shell) survives and is
   the existing guard for D10-5 — say so.

6. **Specify the now-genuinely-empty `<tbody>`.** D10-5 closes the trap (shell survives) but creates a
   state that has never existed on this surface: a `<tbody>` with zero rows, where previously the
   `colSpan` empty row filled it. Required: state its rendered appearance — height/min-height, whether
   the header's `border-bottom` is left dangling over nothing, and that it must not collapse to a 0px
   sliver — and add it to the light/dark rendered-geometry verification list.

### Non-blocking notes

- Round 1's suggested 7th invariant ("no element inside `<table>` spans more than one column") was not
  added to D10-6. CR5(a) makes it failable in Jest; consider also stating it as an invariant, since it
  is the single sentence that makes findings 1–3 structurally unreachable.
- `.concertino/runs/HEL-451/HANDOFF.md` is stale in two ways that could mislead an executor: it says
  the branch is NOT rebased (it is, onto `95b6c619`), and the task framing says "no implementation has
  started" while all five implementation commits are present at HEAD (`git diff origin/main...HEAD` =
  34 files). D10 is correctly written as a delta from that existing code; the handoff should say so.
