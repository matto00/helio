## ADDED Requirements

### Requirement: The indicator's presence is established by rendered measurement, not by its declaration
Whether a focusable element presents a focus indicator SHALL be determined by measuring the running
application in its focused state, not by reading the element's style declarations. A declared indicator that
does not become perceivable when the element is focused SHALL be treated as absent.

#### Scenario: A declared indicator that never paints counts as absent
- **WHEN** an element declares a focus indicator that does not become perceivable when the element receives
  focus
- **THEN** that element is treated as having no focus indicator

#### Scenario: Presence is measured on the focused element in the running application
- **WHEN** an element's focus indicator is assessed
- **THEN** the assessment is made against the element in its focused state as actually rendered

### Requirement: Clipping counts as absence
A focus indicator that is painted outside the bounds its element's ancestors permit SHALL be treated as
absent for the region affected, regardless of the contrast it would achieve if unclipped.

#### Scenario: An indicator clipped by an ancestor is not credited
- **WHEN** an element's focus indicator is clipped away by an ancestor that hides overflow
- **THEN** that element does not present a conforming focus indicator

<!-- CR3 (evaluation-1.md): occlusion (a focus indicator covered by a differently-stacked painted element) is
NOT covered by this requirement or by this change's implementation. A rendered-hit-test-based detector was
built and found methodologically unsound — `document.elementsFromPoint` returns the topmost HIT-TESTABLE
element at a point, and neither `outline` nor `box-shadow` ever expands an element's hit-test box, so the
detector could not distinguish "painted behind a sibling" from "correctly painted on top of something
unclickable" (confirmed live against `.app-skip-link`, whose correctly z-index-stacked ring sampled as 100%
"occluded"). See `e2e/support/focusPresenceProbe.ts`'s module comment for the full account. A sound version
needs real paint-order resolution (stacking-context comparison or pixel-level screenshot diffing) and is
owned by **HEL-1063**, not a requirement of this change. -->

### Requirement: A focus state conveyed only by outline, border, or shadow is adjudicated rather than deferred
Where the focus state is conveyed only by an outline, border, or shadow rather than by a change of surface
colour, that indicator SHALL be measured against the non-text contrast floor. Conveying focus through those
channels SHALL NOT place the indicator outside the reach of enforcement, and SHALL NOT be recorded as an
outcome requiring no judgement.

#### Scenario: An outline-only focus indicator is measured
- **WHEN** an element conveys focus solely by an outline
- **THEN** that outline is measured against the floor and the result is a pass or a failure

#### Scenario: Deferral is not an outcome
- **WHEN** an element's focus state is conveyed only through a border or shadow channel
- **THEN** the result is not recorded as unadjudicated
