## Why

HEL-772 (PR #409, merged `98862321`) added a clause to `DESIGN.md`'s Control-metrics
section sanctioning a sized `::after` hit expander as an alternative to
`min-width`/`min-height: 44px`. The clause describes the mechanism but omits the
gap/tiling constraint that makes it safe, so a reader applying the pattern elsewhere
would believe `getComputedStyle` confirms a 44px tap target when the real, bisected
extent can be well under that (HEL-772 measured 35.75px at an 8px gap).

## What Changes

- Extend the existing `::after` hit-expander clause in `DESIGN.md`'s Control-metrics
  section (no new heading) to state: the per-side extension formula
  `(44 - controlSize) / 2`; the minimum-gap rule (twice the per-side extension); that
  `getComputedStyle(el, "::after").width` and neighbouring-painted-box sampling cannot
  detect overlap, and `elementFromPoint` bisection is the required verification; the
  legitimate sub-44px abutting-region reading (~43.75px at a 0.25px step) and the
  epsilon it requires, with an explicit warning against widening the gap past the
  tiling point to force the number over 44.
- No code changes — documentation only.

## Capabilities

### New Capabilities

- `design-doc-hit-expander-guidance`: `DESIGN.md`'s documented guidance for the sized
  `::after` hit-expander pattern (gap/tiling rule, verification method, epsilon) — a
  documentation-content capability, not runtime behavior; its scenarios are checkable
  by reading `DESIGN.md`, not by executing code.

### Modified Capabilities

(none)

## Impact

- `DESIGN.md` only. No frontend/backend code, schema, or API changes.

## Non-goals

- Not re-litigating the 44px tap-target floor or the `::after` mechanism itself
  (both already sanctioned by HEL-772).
- Not scoping which selectors the pattern applies to (that's HEL-778).
