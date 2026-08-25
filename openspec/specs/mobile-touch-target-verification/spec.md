# mobile-touch-target-verification Specification

## Purpose
Mechanically enforces the DESIGN.md 44px mobile touch-target floor by measuring rendered geometry at
runtime, so an inert, wrong-axis, or vacuously-measured floor fails CI instead of shipping.

## Requirements

### Requirement: Rendered-geometry measurement, not stylesheet text
The guard SHALL measure interactive controls' rendered geometry via `getBoundingClientRect()` (or
equivalent runtime DOM measurement) at defined mobile viewport widths. The guard SHALL NOT determine
pass/fail by matching text or brace structure in CSS source files.

#### Scenario: Inert `@media` floor is caught
- **WHEN** a control's mobile touch-target floor is declared in an `@media` block placed above its
  base rule, at equal specificity, so the floor never actually applies at runtime
- **THEN** the guard fails for that control, because its rendered `height`/`width` reflects the
  ineffective floor, not the string in the source file

### Requirement: Both-axis measurement
The guard SHALL assert both the rendered height and the rendered width of each covered control meet
the 44px floor. A control that satisfies the floor on only one axis SHALL fail the guard.

#### Scenario: Height-only floor with a fixed width
- **WHEN** a control declares `min-height: 44px` but also declares a fixed `width` below 44px
- **THEN** the guard fails for that control, because its rendered width does not meet the floor even
  though its rendered height does

### Requirement: No vacuous pass
For each covered surface, the guard SHALL fail if it matches zero visible, non-exempt (rendered,
non-`display:none`, non-zero-area) floored candidate controls at the measured viewport width. Matching
only a non-visible element, or only elements explicitly exempted from the floor, does not satisfy this
requirement. A control that is intentionally hidden at a given width (per DESIGN.md) is asserted hidden
by a dedicated, separate assertion, distinct from the floor sweep, and never counts toward this
requirement's non-zero match count.

#### Scenario: Surface renders nothing at the tested width
- **WHEN** a surface's candidate controls are all hidden (e.g. `display: none`) at the tested viewport
  width, so no visible candidate is found
- **THEN** the guard fails for that surface rather than passing with zero assertions performed

#### Scenario: Expected-hidden control coexists with a floored sibling on the same surface
- **WHEN** a surface contains one control that is intentionally hidden at the tested width (asserted
  hidden via its own dedicated assertion) and a second, floored control that is visible at that width
- **THEN** the surface's floor sweep still requires and finds the second control as a real, non-zero
  visible-floored match — the hidden control's dedicated assertion does not substitute for it

### Requirement: Discriminates floored from intentionally-unfloored controls
The guard SHALL support an explicit, auditable exemption mechanism (an allowlist entry with a reason
and, for a newly-discovered violation, a follow-up ticket id) for controls intentionally exempt from
the 44px floor (per DESIGN.md, e.g. a native `input[type="color"]` swatch, or an allowlisted known
violation). An exempt control SHALL be confirmed to exist (still rendered) but SHALL NOT be required to
meet the floor, and SHALL NOT by itself satisfy the "no vacuous pass" requirement's non-zero
visible-floored-match count for its surface.

#### Scenario: Exempt control stays exempt
- **WHEN** the guard sweeps a surface containing both floored controls and one exempt
  (intentionally-unfloored) control
- **THEN** the guard passes for the exempt control at its actual (sub-44px) rendered size, proving the
  guard distinguishes floored from exempt controls rather than blanket-asserting on everything, while
  still requiring the surface's other, floored controls to meet the floor

### Requirement: `::after` hit-expander bisection
For controls using the sanctioned `::after` hit-expander pattern (DESIGN.md Control-metrics), the guard
SHALL determine the real hit extent via `elementFromPoint` bisection along both axes, not via
`getComputedStyle(el, "::after")` or box-based measurement. The passing threshold SHALL be
`>= 44 - samplingStep` (an epsilon accounting for bisection step size), never a literal `>= 44`.

#### Scenario: Overlapping expanders steal a neighbour's taps
- **WHEN** two adjacent `::after`-expanded controls are tiled closer than twice the expander's
  per-side extension, so their expanded hit regions overlap and the later-painted sibling's expander
  covers part of the earlier control's nominal hit area
- **THEN** `elementFromPoint` bisection measures the earlier control's real (reduced) hit extent and
  the guard fails for it, even though `getComputedStyle(el, "::after").width` would report a full 44px
