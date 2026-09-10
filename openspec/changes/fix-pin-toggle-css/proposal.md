## Why

HEL-465 shipped column pinning with two documented, owner-ratified CSS gaps in the pin toggle: the
header-label overlap fix and the coarse-pointer tap-target fix are both present in the CSS but
inert (measured live, root causes identified) — `padding-right` on the `<th>` reserves space but
creates no clip boundary, and `min-height` is a no-op on `display: table-cell`. The regression tests
added for both fixes assert CSS declaration text only and stayed green while the fixes were inert.

## What Changes

- Add a class to the label `<span>` already inside `SortableTh`'s button (`SortableTh.tsx`) and
  constrain it (`max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0`, plus `min-width: 0` on the button itself), scoped to a pinnable `DataGrid` header
  only, so header labels actually ellipsize before the pin-toggle icon, relying on the `<th>`'s
  existing padding reservation for the icon's own space (not stacking a second reservation).
- Change `.ui-data-grid__table thead th { min-height: 48px }` to `height: 48px` inside the existing
  `@media (max-width: 430px), (pointer: coarse)` query, so the header row actually grows to give the
  44px pin-toggle control (and its focus ring) room inside the row's clip box.
- Replace/supplement the three CSS-declaration-text Jest assertions in `DataGrid.test.tsx` for these
  two fixes with Playwright geometry assertions (rendered layout, both themes) that are proven to
  fail against the pre-fix tree.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `table-panel-column-pinning`: adds requirements that the pin-toggle affordance does not visually
  overlap the column header label, and that the toggle (and its focus ring) remains fully inside its
  header cell at coarse-pointer/narrow-viewport sizes, with the 44px touch-target floor preserved.

## Impact

- `frontend/src/shared/ui/DataGrid.css` — CSS rule changes (label ellipsis constraint, row-height fix).
- `frontend/src/shared/ui/SortableTh.tsx` — one-line JSX change adding a class to the existing label
  `<span>` so it can be targeted by the scoped ellipsis rule.
- `frontend/src/shared/ui/DataGrid.test.tsx` — CSS-declaration-text assertions removed/updated;
  the same-media-query co-location guard between the row-height and control-floor rules is retained.
- New/updated Playwright e2e coverage for both fixes, both themes.
- No backend, schema, or API changes. AC3 (pin-state persistence) is explicitly out of scope — the
  dev environment cannot exercise it (HEL-904 residue: the dev user owns zero Outputs).

## Non-goals

- Re-investigating or re-deriving the root causes (both already probe-confirmed live in the ticket).
- Any change to pin/unpin behavior, persistence, or column-order logic.
- Fixing the pre-existing, unrelated gap where `.sortable-th__btn` has no ellipsis affordance for a
  sortable column's own direct `<th>` text-overflow rule (noted in the codebase, out of scope here).
