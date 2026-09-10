## 1. Windowing core

- [x] 1.1 Add `useVirtualRows`-style hook (or equivalent colocated helper) computing
      `{startIndex, endIndex, topSpacerPx, bottomSpacerPx}` from `scrollTop`, row height, row
      count, and an overscan buffer.
- [x] 1.2 Measure row height from the density-derived value via a mounted-row
      `getBoundingClientRect()`, mirroring the existing `headerRowRef` measurement pattern; see
      task 1.5 for the pre-measurement bounded-window behavior (NOT unwindowed rendering — D3).
- [x] 1.3 Export `VIRTUALIZATION_ROW_THRESHOLD`; below it, render every row normally with zero
      windowing code path engaged.
- [x] 1.4 Render top/bottom spacer `<tr>` (with `colSpan={columns.length}`) inside `<tbody>`
      instead of absolutely-positioned rows, so `table-layout: fixed` and sticky pinned-column
      offsets need no special-casing. Spacer `<td>`s use a dedicated class zeroing padding/
      border/max-width (D6) so rendered spacer height equals the requested px exactly; omit the
      trailing spacer entirely at height 0, and when a nonzero trailing spacer is rendered, apply
      `border-bottom: none` explicitly to the true last data row (not via `:last-child`) so the
      windowed and unwindowed renderings stay equivalent.
- [x] 1.5 Seed the pre-measurement render from a bounded initial window (a per-density row-height
      estimate, not "render every row") per D3; correct `startIndex`/`endIndex`/spacer heights to
      the measured value in the same `useLayoutEffect` that measures the first mounted row.
- [x] 1.6 Add `aria-rowcount` (header-inclusive) to the table and `aria-rowindex` (true 1-based
      position, not window-relative) to each mounted data `<tr>`; mark both spacer `<tr>`s
      `aria-hidden="true"` (D5). Applies identically below the virtualization threshold.

## 2. Preserve existing behaviors under windowing

- [x] 2.1 Verify column widths (`table-layout: fixed`, `DEFAULT_COLUMN_WIDTH`) are unchanged
      windowed vs. unwindowed.
- [x] 2.2 Verify resize handles still work while windowed.
- [x] 2.3 Verify sort and filter (HEL-448/451) still function and re-window correctly on
      row-set changes.
- [x] 2.4 Verify column pinning (HEL-465) sticky offsets are correct under windowing and while
      actively scrolling with pinned columns present.
- [x] 2.5 Verify keyboard scroll, focus (header-row resize handle/pin toggle/filter inputs — all
      in `<thead>`, no HEL-520 guard exists on this surface, see design.md Context), and
      screen-reader row semantics (`aria-rowcount`/`aria-rowindex`, spacer rows hidden from the
      a11y tree, per D5) are unaffected.

## 3. Tests

- [x] 3.1 Jest/RTL: windowing math (mounted row count bounded, spacer heights correct) at several
      thousand rows, more than one density, with stubbed `getBoundingClientRect` — confirm each
      new assertion is red against the pre-fix tree before accepting it. Include assertions for
      `aria-rowcount`/`aria-rowindex` correctness and that spacer rows carry `aria-hidden="true"`.
- [x] 3.2 Jest/RTL: small-table bypass — at/below threshold renders every row, no windowing state
      engaged.
- [x] 3.3 Live verification (running app, real browser): done by the cycle-1 evaluator, cited here
      rather than left open — see `evaluation-1.md` Phase 3. AC1 (stable, bounded DOM node count
      across five scroll positions, `scrollHeight` constant), AC2 (pinning under windowing at a
      deep scroll position with matching sticky offsets, sort re-windowing), and AC4 (no
      horizontal-scroll/column-collapse regression across four breakpoints) were all verified live
      against a real windowed table panel (`aria-rowcount=201`, 75 columns). **Honest scope note:
      the largest live table available in the dev environment was 200 rows** (just above
      `VIRTUALIZATION_ROW_THRESHOLD`), not "several thousand" as the ticket literally states — the
      several-thousand-row case is exercised only by the Jest suite (5,000-row fixtures), not
      measured live in a real browser. Do not read this as "several thousand rows verified live."

## 4. Cleanup

- [x] 4.1 Update `DataGrid.tsx` doc comments for any relevant existing constants
      (`DEFAULT_COLUMN_WIDTH` et al.) if virtualization changes their applicability.
- [x] 4.2 Confirm no regression against HEL-1065's two known pre-existing pin-toggle CSS defects
      (cite, do not fix, if surfaced).
