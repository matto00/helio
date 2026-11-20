# HEL-1749: Home opening placeholder: one skeleton bar per line at 431-604px

## Description

origin_kind: followup
origin_ticket: HEL-1737

This was deferred from HEL-1665 and again from HEL-1737. At 431-604px, Home's opening-line loading placeholder covers two lines of hidden sentence but shows a single skeleton bar centred over them. It should show one bar per line, like the other skeletons.

**Direction.** Pure CSS on the existing hidden placeholder (`.home-opening__ghost`) if possible. For example, make each line fragment its own bar with an inline span that has the skeleton background and `box-decoration-break: clone`. Reuse the existing skeleton token and animation, with no JS line counting and no change to `Skeleton`.

## Acceptance Criteria

- One bar per line at 431-604px, in light and dark, matching the existing skeleton look.
- The hel1665 0px series and the HEL-1737 placeholder sweep (320-1300px, zero differing widths) stay green.

## Driver notes (claims to verify)

- Verify the direction works in the Playwright Chromium build (note `-webkit-box-decoration-break` needs) before committing to it.
- hel1665 specs were split by HEL-1778 into several files; find them by test title.
- Respect the reduced-motion behaviour of the existing skeleton animation. Grep e2e/ for any selector altered.
- Frontend CSS (plus placeholder markup) only; no migration, no backend change.
