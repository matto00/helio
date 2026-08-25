# HEL-781: `.panel-list__add` is 28px at mobile widths — below the 44px touch floor

## Description

The panel-list header's "Add panel" control (`.panel-list__add`,
`frontend/src/features/panels/ui/PanelList.css`) renders at 28.00px tall at
both 430px and 768px viewports — below the 44px minimum touch-target size
(DESIGN.md §8, and the convention established by HEL-308/HEL-314).

It is styled `height: var(--control-sm)` with no `@media (max-width: 768px)`
floor rule anywhere, unlike `.ui-empty-state__cta` /
`.ui-empty-state__secondary-cta`, which carry one at `EmptyState.css:219-228`.

Found by the final-gate skeptic during HEL-548 (PR #410). Verified not to be
a regression from that change: the `.panel-list__add` CSS block is
byte-identical between `main` and that branch — HEL-548 only swapped the
button's icon from FontAwesome to lucide.

This is the seventh touch-target finding in this repo (HEL-745, 747, 314,
319, 535, 548-spinoff, this one). HEL-535's cycle-1 defect was a `@media`
block placed ABOVE the base rule, so equal specificity made the floor inert
while a text-matching test passed — do not repeat it.

## Acceptance Criteria

- `.panel-list__add` has a `@media (max-width: 768px)` block setting
  `min-height: 44px`, following the `EmptyState.css:219-228` convention,
  placed AFTER the base rule so source order cannot make it inert.
- Sibling header controls in `PanelList.css` are audited for the same gap;
  any found are fixed the same way.
- Verified by measurement (`getBoundingClientRect().height`), not by reading
  declared CSS: `.panel-list__add` >= 44px tall at 430px and 768px viewports,
  plus a control that should NOT be floored, to prove the probe
  discriminates.
- HEL-777 (merged e0048c3e) added a `::after` hit-expander constraint to
  DESIGN.md's Control-metrics section. This ticket's stated preference is
  the min-height floor (matching the EmptyState.css convention), not an
  `::after` hit expander. If an `::after` hit expander is used instead, it
  must satisfy HEL-777's elementFromPoint bisection verification.
- Evaluate whether a mechanical guard (static CSS test per
  EmptyState.css.test.ts / Skeleton.css.test.ts precedent, or a runtime
  sweep) fits this ticket's scope. If it does not, escalate with a
  recommendation rather than silently widening or dropping it.

## Reference

- `DESIGN.md` §8 (accessibility baseline), §5 (control metrics)
- `frontend/src/shared/ui/EmptyState.css:219-228` — the floor convention to follow
- Found during HEL-548 / PR #410 (`skeptic-final-1.md` note 1, `skeptic-final-2.md` note 4)
