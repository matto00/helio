# accessible-focus-indicator Specification

## ADDED Requirements

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
