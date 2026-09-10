## Context

See proposal.md - Why. `DataGrid.tsx`'s `full` variant has grown substantially since HEL-458 was
filed: HEL-448 (sort), HEL-451 (filter), HEL-469 (per-column formatting), and HEL-465 (`dae1117e`,
column pinning via `position: sticky` cumulative offsets on the leading contiguous run of columns)
all now render alongside the plain row markup this ticket windows. **HEL-520 (`7a14601f`) does NOT
touch this surface** — verified via `git show --stat 7a14601f` (design-gate skeptic round 1): its
changed files are `e2e/focus-presence-guard.spec.ts`, `e2e/hel520-focus-presence-guard.regression.spec.ts`,
`e2e/support/focusPresenceProbe.ts`, `PipelineDetailHeader.css`, `Modal.test.tsx`, and
`tokenAuditSweep.css.test.ts`, none of which reference `DataGrid`/`data-grid`/`table`. There is no
"HEL-520 rendered focus-presence guard" to preserve here; an earlier draft of this doc cited one
and was corrected. What the header row DOES have today, confirmed live: a resize handle
(`role="separator"`, `tabIndex=0`, DataGrid.tsx:909-919), a pin toggle (DataGrid.tsx:893-907), and
filter inputs (DataGrid.tsx:951-961) — all in `<thead>`, all untouched by `<tbody>` windowing.
Body cells contain no focusable content today (`col.render` is only ever the per-column
formatter, `TableRenderer.tsx:302`), so focus-inside-an-unmounted-row is not a live hazard.
`frontend/package.json` has no existing windowing/virtualization dependency (`react-window`,
`@tanstack/react-virtual`, etc. all absent) — there is no existing mechanism to join, unlike
HEL-444's guard-consolidation precedent.

## Goals / Non-Goals

**Goals:**
- Window `full`-variant row rendering above a threshold, computing height from the
  density-derived per-row height, with a spacer mechanism that preserves total scroll height and
  scroll position math.
- Preserve every other full-variant behavior byte-for-byte: `table-layout: fixed` widths, resize,
  sort, filter, pinning offsets, keyboard scroll/focus, screen-reader row semantics.

**Non-Goals:**
- `preview` variant virtualization (never grows beyond a handful of rows).
- Server-side pagination or any change to `fetchPanelPage`/"Load more" (out of scope per ticket).
- Panel-grid (dashboard-level) virtualization (HEL-353).
- Fixing HEL-1065's two pre-existing CSS-only pin-toggle defects (header-label/icon overlap on
  truncating columns; sub-44px tap target with split focus ring at ≤430/coarse-pointer) — cite and
  move on if surfaced.

## Decisions

**D1 — Hand-rolled windowing, no new dependency.** No windowing library is present in
`frontend/package.json` today, so there is no existing mechanism to extend (unlike HEL-444's
guard consolidation, which found and joined eight already-existing `*.css.test.ts` guards). A
from-scratch windowing hook (`useVirtualRows` or similar, colocated with `DataGrid.tsx`) computing
`(scrollTop, rowHeight, rowCount, overscan) -> {startIndex, endIndex, topSpacerPx, bottomSpacerPx}`
is small (~40 lines), has zero third-party dependency-tree/bundle-size impact (directly consistent
with the HEL-353 bundle-size coordination the ticket calls out), and needs no tree-shaking
justification. A library remains the fallback if the hand-rolled hook proves to need real-DOM
measurement subtleties (variable-height rows, ResizeObserver-driven remeasurement) beyond a fixed
per-density row height — not needed here, since row height is uniform within a density.

**D2 — Windowing renders as a top/bottom spacer `<tr>` pair inside `<tbody>`, not `position:
absolute` rows.** `table-layout: fixed` and `position: sticky` pinned-column offsets (HEL-465)
both depend on ordinary table flow layout; absolutely-positioned rows would break `<tbody>` row
semantics (screen readers — see D5) and interact badly with sticky positioning context. A leading spacer `<tr>` with `height: <n>px` (rows above the window) and a
trailing spacer `<tr>` (rows below) preserves total scrollable height and keeps every visible row
an ordinary `<tr>` at its correct flow position — sticky pinned-column offsets and `colSpan`-based
spacer cells need no special-casing beyond `colSpan={columns.length}` on each spacer.

**D3 — Row height source: reuse the same density-driven row-height value CSS already encodes**,
read via a single `getBoundingClientRect()` measurement of the first mounted row (mirrors the
existing sticky-offset measurement pattern in `DataGrid.tsx`'s `useLayoutEffect`, which already
measures `headerRowRef` rather than hardcoding a header height) — never a new hardcoded constant.
**Corrected (design-gate skeptic round 1, CR2):** the pre-measurement pass does NOT fall back to
rendering every row unwindowed — for a 5,000-row table that would mount 5,000 `<tr>`s on every
component mount (opening a panel, opening the panel-detail modal, a density change forcing
remeasure), moving the ticket's own cost from steady-state to mount instead of removing it.
Instead, the pre-measurement render uses a **bounded initial window**: a provisional per-density
row-height estimate (one small lookup table keyed by `DataGridDensity`, seeded from each
density's own padding/font-size CSS values already documented at the top of this file, e.g. via
`--space-*`/`--text-*` tokens) sized to render only an `overscan`-sized initial slice. The same
`useLayoutEffect` that measures `headerRowRef` today also measures the first mounted body row
before paint and corrects `startIndex`/`endIndex`/spacer heights from the estimate to the real
measured value — matching the existing `headerRowRef` pattern (DataGrid.tsx:474-487) exactly. The
measured value governs from that point on; only the pre-measurement render changes from "all
rows" to "a bounded slice."

**D5 — Screen-reader row semantics (design-gate skeptic round 1, CR3).** Today's table has no
`aria-rowcount`/`aria-rowindex` (only `role="region"` on the scroll container, DataGrid.tsx:789)
— windowing would otherwise silently change what assistive tech perceives from "5,000 rows" to
"~30 rows," and the two spacer `<tr>`s would be announced as additional data rows. Decision: the
`<table>` gets `aria-rowcount={totalRowCount + 1}` (header-inclusive, per the ARIA spec), each
mounted data `<tr>` gets `aria-rowindex` reflecting its true 1-based position (header row = 1,
first data row = 2, etc. — NOT its position within the mounted window), and both spacer `<tr>`s
get `aria-hidden="true"` so they are excluded from the accessibility tree entirely. This applies
identically below the virtualization threshold (bypass path) for consistency, where
`aria-rowcount` simply equals the full row count with no spacers to hide.

**D6 — Spacer-cell geometry (design-gate skeptic round 1, CR4).** A spacer `<td>` inherits
`.ui-data-grid__table tbody td`'s `border-bottom: 1px solid`, `max-width: 240px`, and the active
density's padding (DataGrid.css:333-360) — any of that adds to the requested spacer height, so
`scrollHeight` would disagree with `rowCount * rowHeight` and the scrollbar would drift as the
window slides. Decision: spacer `<td>`s get a dedicated class (e.g.
`.ui-data-grid__row-spacer-cell`) zeroing `padding`, `border`, and `max-width`, so the rendered
`<tr>` height equals the requested `n` exactly. Separately, `.ui-data-grid__table tbody
tr:last-child td { border-bottom: none }` (DataGrid.css:342-344) currently suppresses the final
hairline on the last row; with a trailing spacer present, `:last-child` would retarget onto the
spacer and the true last data row would regain a border it doesn't have unwindowed — a
windowed-vs-unwindowed divergence the `specs/data-grid/spec.md` "equivalent rendering"
requirement forbids. Decision: omit the trailing spacer `<tr>` entirely when its height would be
`0` (the common case at the bottom of the scroll range), and when a nonzero trailing spacer IS
rendered, give the true last data row an explicit `border-bottom: none` itself (a class on that
row) rather than relying on the CSS `:last-child` selector, so the divergence cannot occur at any
scroll position.

**D7 — Scroll source (non-blocking note, round 1; recorded as a decision so the implementer does
not duplicate it).** The scroll container is `.ui-data-grid` (DataGrid.tsx:789), whose ref is
`useScrollEdges`'s returned `RefObject` — a plain `RefObject`, not a callback ref, so the
windowing hook reads the same object rather than attaching a second `ref={}` to that div (which
would clobber the scroll-shadow affordance). `useScrollEdges` already attaches a `{ passive: true
}` scroll listener to it (useScrollEdges.ts:66); the windowing hook's own scroll subscription
reuses that same element.

**D4 — Virtualization threshold: same order of magnitude as `deriveColumns`'s existing "first 50
rows" heuristic, but independently tunable.** A literal exported constant
(`VIRTUALIZATION_ROW_THRESHOLD`), not derived from the 50-row column-sampling constant (different
concern — sampling vs. rendering cost). Exact value set during implementation from a live
measurement of where DOM-node accumulation becomes visually janky, not guessed.

## Risks / Trade-offs

- [Risk] jsdom cannot verify real scroll/height geometry (AC1/AC4) → Mitigation: Jest/RTL covers
  the windowing math and threshold bypass in isolation (stubbed `getBoundingClientRect`, matching
  the existing sticky-offset test pattern); AC1/AC4 verified live in the running app per the
  ticket's own "verified in the app" wording, with before/after DOM-node-count and scroll
  screenshots as evidence.
- [Risk] Interaction with HEL-465 pinning under scroll (the sharpest existing interaction, per
  driver brief) → Mitigation: explicit live scroll test with pinned columns present at several
  thousand rows, not just a static render.
- [Risk] A windowing assertion whose precondition guarantees it (HEL-1060) → Mitigation: every new
  test asserts against a row count comfortably above the threshold, at more than one density, and
  is confirmed red against the pre-fix tree before being accepted.
- [Note, non-blocking, round 1] `TableRenderer` never passes `density` to `DataGrid` today
  (`TableRenderer.tsx:673`; `resolvedDensity` is always `DEFAULT_DENSITY.full` in the live app) —
  D3's measured-height approach is correct regardless (it measures whatever density is active),
  but multi-density coverage in the test suite is necessarily synthetic (passing `density`
  directly to `DataGrid` in tests), not exercised end-to-end through the live app today.

## Planner Notes

Self-approved: hand-rolled windowing (D1) rather than escalating the library-vs-hand-rolled
question — the ticket already directs "keep a hand-rolled or lightweight approach consistent with
the repo's dependency posture," and the repo's dependency posture (zero existing windowing
libraries) makes hand-rolled the consistent choice, not an ambiguous judgment call.
