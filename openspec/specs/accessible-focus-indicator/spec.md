# accessible-focus-indicator Specification

## Purpose
Guarantees that the keyboard focus indicator is perceivable against whatever surface it lands on, whichever
theme is active and whichever accent the user has chosen, so that keyboard navigation remains usable rather
than merely present.

## Requirements

### Requirement: The focus indicator meets the non-text contrast floor everywhere it can appear
The keyboard focus indicator SHALL achieve a contrast ratio of at least 3:1 against every surface it can be
rendered against, in every theme the application offers, and for every accent the user can select. This
SHALL hold for the application's default accent and theme as shipped.

#### Scenario: The indicator is perceivable on every surface
- **WHEN** an element receives keyboard focus on any surface the application renders
- **THEN** the focus indicator meets at least a 3:1 contrast ratio against that surface

#### Scenario: Every accent choice satisfies the floor
- **WHEN** the user selects any available accent
- **THEN** the focus indicator still meets the floor against every surface, in every theme

#### Scenario: The shipped default is not an exception
- **WHEN** the application is used as shipped, with no accent or theme changed
- **THEN** the focus indicator meets the floor

### Requirement: The indicator's colour is derived, not chosen
The focus indicator's colour SHALL be derived from the active accent by the smallest adjustment that
satisfies the contrast floor, rather than being an independently picked value. Deriving it minimally SHALL
keep the indicator recognisably related to the user's chosen accent while guaranteeing the floor.

#### Scenario: The indicator tracks the chosen accent
- **WHEN** the user changes accent
- **THEN** the focus indicator changes correspondingly rather than remaining a fixed colour

#### Scenario: No more adjustment than necessary
- **WHEN** an accent already satisfies the floor unaided
- **THEN** the indicator is that accent, unmodified

### Requirement: The indicator's obligation is independent of decorative accent use
The contrast obligation carried by the focus indicator SHALL be expressed separately from the accent used
decoratively, so that changing one cannot silently change the other. Adjusting the indicator to satisfy the
floor SHALL NOT alter the accent's appearance elsewhere in the application.

#### Scenario: Satisfying the floor does not restyle the app
- **WHEN** the indicator's colour is adjusted to meet the floor
- **THEN** every other use of the accent renders exactly as before

#### Scenario: The two cannot be re-coupled unnoticed
- **WHEN** a change makes the indicator's colour equal to the raw accent for an accent that does not satisfy
  the floor
- **THEN** that change is rejected rather than shipped

### Requirement: The contrast obligation binds on whichever mechanism conveys focus
The focus indicator's contrast obligation SHALL attach to whatever visual mechanism actually conveys focus —
an outline, a border, a shadow, or any combination — rather than to one nominated mechanism. Suppressing one
mechanism and conveying focus by another SHALL NOT relieve the obligation, and SHALL NOT place the resulting
indicator beyond the reach of whatever check enforces the floor.

#### Scenario: Conveying focus by a border carries the same floor as an outline
- **WHEN** a focused element suppresses its outline and conveys focus by changing its border colour instead
- **THEN** that border meets at least a 3:1 contrast ratio against the surfaces adjacent to it

#### Scenario: Switching mechanism cannot evade enforcement
- **WHEN** a change moves a focus indicator from one mechanism to another
- **THEN** the new mechanism is covered by enforcement rather than becoming an unchecked exception

#### Scenario: Unconditional suppression is not a focus state
- **WHEN** a rule removes an element's outline unconditionally rather than within a focus state
- **THEN** that element still presents a focus indicator meeting the floor when it receives keyboard focus

### Requirement: A sub-threshold decorative layer is not credited as the indicator
Where a focus treatment combines a layer that meets the contrast floor with one that does not, only the
conforming layer SHALL be treated as the focus indicator. A decorative layer below the floor SHALL NOT be
counted toward satisfying it, whether alone or in combination.

#### Scenario: A low-contrast halo does not satisfy the floor
- **WHEN** a focus treatment pairs a conforming border with a translucent halo below the floor
- **THEN** the floor is judged on the border alone, and the halo is treated as decoration

#### Scenario: Decoration alone is insufficient
- **WHEN** the only thing distinguishing a focused element from an unfocused one is a layer below the floor
- **THEN** that element does not present a conforming focus indicator

### Requirement: Unfixed sites are named rather than omitted
Where a site conveying focus is deliberately left unchanged, it SHALL be identified explicitly together with
the reason, and SHALL carry a filed item that owns the remainder. Silent omission SHALL NOT be treated as
completion.

#### Scenario: A deferred site is traceable
- **WHEN** a site conveying focus is knowingly left non-conforming
- **THEN** it is named with its reason and an owning item, rather than passing unremarked

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
