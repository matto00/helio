## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/data-grid/spec.md`.
- Ground truth: `frontend/src/shared/ui/DataGrid.tsx` (1011 lines) and `DataGrid.css` (698 lines)
  in the worktree, read directly — not via the docs.
- **Uniform row height holds.** `DataGrid.css` `.ui-data-grid__table tbody td` sets
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, so a body row cannot wrap to
  a second line. D1's "row height is uniform within a density" premise is CORRECT — the
  hand-rolled fixed-height windowing (D1) is a sound choice, no variable-height measurement
  needed.
- **D2's spacer-`<tr>`-over-`position:absolute` choice is sound.** `.ui-data-grid--full
  .ui-data-grid__table { table-layout: fixed }` (DataGrid.css:137) and the HEL-465 pinned cells
  (`position: sticky` + inline `left: pinnedOffsets[col.key]`, DataGrid.tsx:975-995) both depend
  on ordinary table flow. Absolute rows would break both. Confirmed.
- **HEL-465 pinning is genuinely orthogonal to row windowing.** `pinnedOffsets` is computed from
  column widths only (DataGrid.tsx:292-320), never from row identity or count, and body cells
  read it per-cell. Nothing in the pinning path is row-index-dependent.
- **The scroll container exists and scrolls vertically**: `.ui-data-grid` carries
  `overflow: auto` with `max-height: 320px` / `flex: 1; min-height: 0` (DataGrid.css:43,78,87)
  and is the element `useScrollEdges`' ref is attached to (DataGrid.tsx:789).
- `git show --stat 7a14601f` and `dae1117e` — see CR1 below.
- `grep -n "aria-" DataGrid.tsx` — the table has `role="region"` on the scroll div only; there is
  no `aria-rowcount`/`aria-rowindex`/`role="grid"` anywhere. See CR3.
- Confirmed HEL-1065's two defects are correctly scoped out; I did not treat their presence as a
  design gap.

### Verdict: REFUTE

The core architecture (D1 hand-rolled, D2 spacer rows, D3 measured height, D4 threshold) is
right and I am not asking for it to change. Four specific, cheap revisions are required before
implementation.

### Change Requests

1. **`design.md` "Context" states a verifiably false premise about HEL-520, and `tasks.md` 2.5 /
   AC5 inherit it.** `git show --stat 7a14601f` shows HEL-520 touched **no DataGrid file at all**
   — its changed files are `e2e/focus-presence-guard.spec.ts`,
   `e2e/hel520-focus-presence-guard.regression.spec.ts`, `e2e/support/focusPresenceProbe.ts`,
   `frontend/src/features/pipelines/ui/PipelineDetailHeader.css`, `Modal.test.tsx`, and
   `tokenAuditSweep.css.test.ts`. `grep -n "HEL-520" DataGrid.tsx` returns zero hits, and
   `grep -n "DataGrid\|data-grid\|table" e2e/focus-presence-guard.spec.ts
   e2e/support/focusPresenceProbe.ts` also returns zero hits. There is no "HEL-520 rendered
   focus-presence guard" in this surface to preserve or regress. Correct the Context paragraph
   and restate task 2.5's target as what actually exists: the header-row focusable controls
   (resize handle `role="separator"` tabIndex=0 at DataGrid.tsx:909-919; pin toggle at 893-907;
   filter inputs at 951-961) — all of which live in `<thead>` and are untouched by `<tbody>`
   windowing. Note while correcting it that body cells contain no focusable content today
   (`col.render` is only ever the per-column formatter, TableRenderer.tsx:302), so
   focus-inside-an-unmounted-row is not a live hazard — but say so explicitly rather than leaving
   it to a false citation.

2. **D3's pre-measurement fallback defeats the ticket's own purpose on first paint.** D3 says
   virtualization "falls back to rendering unwindowed (threshold bypass) before any row has
   mounted to measure from." For a 5,000-row table that means mounting 5,000 `<tr>` elements on
   every mount of the component (opening a panel, opening the panel detail modal, a density
   change forcing remeasure) before windowing engages — exactly the accumulated-DOM cost AC1
   exists to remove, just moved from steady-state to mount. Revise D3 to render a bounded
   **initial window** (e.g. the first `overscan`-sized slice, or a slice derived from a
   provisional per-density row-height estimate) on the pre-measurement pass, then correct
   `startIndex`/`endIndex`/spacer heights in the same `useLayoutEffect` that measures the first
   mounted row — before paint, matching the existing `headerRowRef` pattern
   (DataGrid.tsx:474-487). The measured value must still govern; only the pre-measurement render
   changes from "all rows" to "a bounded slice."

3. **Screen-reader row semantics are asserted as preserved but nothing in the plan preserves
   them.** AC5 and the design's Goals both claim screen-reader row semantics are unaffected, and
   `specs/data-grid/spec.md` has no requirement covering it. Verified today: the table is a plain
   `<table>` with no `aria-rowcount` and no `aria-rowindex` (only `role="region"` on the scroll
   container, DataGrid.tsx:789). Windowing therefore silently changes what assistive tech
   perceives from "5,000 rows" to "~30 rows", and D2's two spacer `<tr>`s are announced as two
   additional data rows. Add to `design.md` and `tasks.md` an explicit decision covering: (a)
   `aria-rowcount` on the table reflecting the true total plus `aria-rowindex` on each mounted
   `<tr>` (1-based, header-inclusive per the ARIA spec) — or an equally explicit, justified
   decision not to; and (b) removing the spacer rows from the a11y tree
   (`aria-hidden="true"` / `role="presentation"`). Add a matching `#### Scenario` to
   `specs/data-grid/spec.md`'s virtualization requirement and a Jest assertion in task 3.1 —
   otherwise AC5's screen-reader clause has no verification anywhere in the plan.

4. **Spacer-cell geometry is unspecified against the existing `tbody td` rules, and the
   total-height math depends on it.** D2 / task 1.4 say only "a spacer `<tr>` with
   `height: <n>px` ... `colSpan={columns.length}`". A spacer `<td>` inherits
   `.ui-data-grid__table tbody td` (DataGrid.css:333-340): `border-bottom: 1px solid`,
   `max-width: 240px`, plus the active density's `padding` (DataGrid.css:346-360). Two
   consequences the plan must pin down: (a) the spacer needs its own class zeroing padding and
   border so its rendered height equals the requested `n` exactly — any per-spacer delta makes
   `scrollHeight` disagree with `rowCount * rowHeight` and the scrollbar drifts/jumps as the
   window slides; and (b) `.ui-data-grid__table tbody tr:last-child td { border-bottom: none }`
   (DataGrid.css:342-344) currently suppresses the final hairline — with a trailing spacer row
   present, `:last-child` becomes the spacer and the last **data** row regains a border it does
   not have today, a windowed-vs-unwindowed divergence the spec's "equivalent rendering"
   requirement forbids. State whether the bottom spacer is omitted entirely at height 0 (which
   also fixes this at the bottom of the scroll but not mid-scroll) and how the last-child rule is
   re-targeted.

### Non-blocking notes

- **Name the scroll source.** Task 1.1's hook signature takes `scrollTop` as an input but nothing
  in the plan says where it comes from or how a scroll re-renders. The container is
  `.ui-data-grid` (DataGrid.tsx:789), whose ref is `useScrollEdges`' returned `RefObject` — a
  plain `RefObject`, not a callback ref, so the windowing hook can read the same object without
  ref composition, and `useScrollEdges` already attaches a `{ passive: true }` scroll listener to
  it (useScrollEdges.ts:66). Worth one sentence in D2 so the implementer does not add a second
  `ref={}` to that div and clobber the scroll-shadow affordance.
- `TableRenderer` never passes `density` (confirmed at TableRenderer.tsx:673 and the standing
  comment at DataGrid.css:415), so `resolvedDensity` is always `DEFAULT_DENSITY.full` in the live
  app. The measured-height approach (D3) is correct regardless, but the multi-density coverage in
  tasks 3.1/3.3 will be synthetic — worth noting so it is not mistaken for live app coverage.
- D4 deferring the exact `VIRTUALIZATION_ROW_THRESHOLD` value to a live measurement is a
  legitimate empirical deferral, not a placeholder — tests bind to the exported constant. No
  action needed.
