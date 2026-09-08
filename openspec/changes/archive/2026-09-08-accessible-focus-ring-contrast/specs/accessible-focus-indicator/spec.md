## Purpose
Guarantees that the keyboard focus indicator is perceivable against whatever surface it lands on, whichever
theme is active and whichever accent the user has chosen, so that keyboard navigation remains usable rather
than merely present.

## ADDED Requirements

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
