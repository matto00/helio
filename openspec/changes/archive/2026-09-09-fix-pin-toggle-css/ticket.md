# HEL-1065: Fix two shipped-but-inert pin-toggle CSS fixes on HEL-465 (header label overlap + coarse-pointer tap-target clip)

## Description

HEL-465 (column pinning on table panels) shipped with two known, documented gaps in the pin toggle's CSS, deliberately not blocked on for delivery per an owner-ratified ship-with-documented-gap decision at the end of a 5-round final-gate loop. Both remaining defects are single-file CSS (`frontend/src/shared/ui/DataGrid.css`), no logic change, and both root causes are already identified and probe-confirmed live on the running app — this ticket is to *apply* the specified one-line fixes and verify them, not to re-investigate.

Full history and evidence: `openspec/changes/column-pinning-table-panels/skeptic-final-4.md` and `skeptic-final-5.md` in the HEL-465 branch (`feature/column-pinning-table-panels/HEL-465`, merged).

## Issue 1: Header label still paints under the pin icon on truncating columns

`.ui-data-grid__th--pin-reserve`'s `padding-right` reservation is **inert** — verified by live A/B toggle (removing it produces an identical overlap count, 4/7 cells at a sampled scroll position). Measured: 28/75 header cells overlap with 3 columns pinned (8 of them genuinely truncating), both themes, unchanged from before the "fix".

**Root cause (measured):** `overflow: hidden` clips at the element's **padding box**, not its content box, so `padding-right` on the `<th>` reserves layout space but no clip boundary. The label lives in `.sortable-th__btn`, which computes `overflow: visible; white-space: nowrap; text-overflow: clip` — its text simply overflows the content box and paints across the reserved padding band, under the icon.

**Specified fix:** constrain the **label element**, not the cell's padding — give `.sortable-th__btn` (or a wrapper) an explicit `max-width: calc(100% - var(--space-9))` plus `overflow: hidden; text-overflow: ellipsis; min-width: 0`, so the label ellipsizes before the icon. Keeping the `<th>`'s `padding-right` is harmless but is not the fix.

**Verification:** re-measure `labelUnderPinIcon = 0` across the table **with columns pinned** (test the pinned state specifically — the bare/unpinned table under-counts), in both themes.

## Issue 2: Pin toggle clipped at ≤430px / coarse pointer (tap target below the 44px floor, broken focus ring)

The `min-height: 48px` added to `.ui-data-grid__table thead th` inside the `(max-width: 430px), (pointer: coarse)` media query is **inert** — `min-height` does not apply to `display: table-cell` (CSS 2.1 §17.5.3/§10.7); the browser silently discards it. Measured at a real 420px viewport: `<th>` renders 34.5px (unchanged), button clipped top+bottom, effective tap target 44×34.5 (below the ticket's own 44px floor), focus ring split into two disconnected 9px/8.5px-clipped bars rather than a complete ring.

**Root cause (probe-confirmed live, with restore):** swapping `min-height: 48px` → `height: 48px` (probe only) grows the row to 48.0px and eliminates the clip entirely, with the 44px control untouched.

**Specified fix:** change `min-height: 48px` to `height: 48px` on `.ui-data-grid__table thead th` inside the same existing media query. Do not create a new breakpoint. Do not shrink the control below 44px — that floor is non-negotiable (an accessibility minimum, and the ticket's own rule).

**Verification:** measure at a real ≤430px viewport with a coarse pointer specifically (the desktop/mouse surface is unaffected): button box fully inside its `<th>`, computed focus-ring extent (`rect ± outline-offset ± outline-width`) also fully inside it, in both themes.

## Also worth doing while in this file (REQUIRED for this delivery, not optional)

The three Jest tests added across HEL-465's final rounds (`DataGrid.test.tsx`) assert CSS declaration *text* only, and are green whether or not the fix has any rendered effect — they were "green-for-broken" for both issues above, through five final-gate rounds. **This delivery must close that loop**: replace or supplement those tests with rendered-geometry assertions (Playwright, not Jest/jsdom — jsdom cannot measure real layout/clip/text-overflow) that can actually fail when the effect is absent:

- `labelUnderPinIcon === 0` measured **with columns pinned** (the bare/unpinned table under-counts).
- Button box and computed focus-ring extent (`rect ± outline-offset ± outline-width`) fully inside the `<th>`, measured at a real **≤430px viewport with a coarse pointer** (the desktop surface is unaffected).
- Both checks in **both themes**.
- Each new assertion must be proven to go **red** against the pre-fix tree (`3baa1ebf`) — if it cannot be made to fail there, it is not testing the right thing.

## Non-issue, recorded for completeness — OUT OF SCOPE

AC3 (pin-state persistence) was never observed round-tripping live against a real backend write during HEL-465's delivery — the dev-environment user owns zero Outputs, so every write 403s (HEL-904 residue in the shared dev DB, unrelated to this ticket's code). This traces to code + unit tests + an established idiom (mirrors `persistColumnSort`), not a known defect — **no action needed here**; do not spend a cycle on it.

## Acceptance Criteria

1. `.sortable-th__btn` (or its label wrapper) is given an explicit max-width/overflow/ellipsis constraint so header labels ellipsize before the pin-toggle icon; `labelUnderPinIcon === 0` measured with columns pinned, in both themes.
2. `.ui-data-grid__table thead th`'s `min-height: 48px` inside the existing `@media (max-width: 430px), (pointer: coarse)` query is changed to `height: 48px` (same breakpoint, no new one); the pin-toggle button box and its computed focus-ring extent are fully inside the `<th>` at a real ≤430px/coarse-pointer viewport, in both themes; the control itself is never shrunk below 44px.
3. `DataGrid.test.tsx`'s three CSS-declaration-text-only tests for these two fixes are replaced or supplemented with Playwright geometry assertions that are proven to fail (red) against the pre-fix tree and pass (green) against the fixed tree, covering both issues above, both themes, and (for issue 2) the correct pinned/coarse-pointer/viewport preconditions.
4. AC3 (pin-state persistence) is explicitly out of scope for this delivery — do not attempt to verify it.
