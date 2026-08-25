# design-doc-hit-expander-guidance Specification

## Purpose
Ensures DESIGN.md's sanctioned ::after hit-expander pattern documents the gap/tiling constraint, verification method, and epsilon needed to apply it safely.
## Requirements
### Requirement: DESIGN.md states the hit-expander gap/tiling constraint
`DESIGN.md`'s Control-metrics section SHALL state, for the sanctioned sized `::after`
hit expander: the per-side extension formula `(44 - controlSize) / 2`; the minimum-gap
rule for a cluster of expander-based controls (at least twice the per-side extension);
that `getComputedStyle(el, "::after").width` and neighbouring-painted-box sampling
cannot detect an overlap and that `elementFromPoint` bisection is the required
verification; and the legitimate sub-44px abutting-region reading with the epsilon it
requires, plus an explicit warning against widening the gap to compensate.

#### Scenario: Reader can derive the minimum gap for a new control cluster
- **WHEN** a reader applies the sanctioned `::after` hit-expander pattern to a new
  cluster of controls of a given `controlSize`
- **THEN** `DESIGN.md` states the formula needed to compute the required minimum gap
  between controls, without consulting any ticket or archived `openspec` change

#### Scenario: Reader is warned that computed size is not sufficient verification
- **WHEN** a reader checks `getComputedStyle(el, "::after").width` to confirm the tap
  target is 44px
- **THEN** `DESIGN.md` states that this check (and neighbouring-painted-box sampling)
  cannot detect an overlap between adjacent expanders, and names `elementFromPoint`
  bisection as the required verification method

#### Scenario: Reader does not widen the gap to force a passing measurement
- **WHEN** a reader bisects a correctly-tiled abutting region and reads a value
  just under 44px (e.g. ~43.75px at a 0.25px sampling step)
- **THEN** `DESIGN.md` states that this is the expected, legitimate reading (needing an
  epsilon on the assertion) and explicitly warns against widening the gap past the
  tiling point to push the number over 44

