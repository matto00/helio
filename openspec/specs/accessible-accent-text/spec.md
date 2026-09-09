# accessible-accent-text Specification

## Purpose
Keeps accent colour legible wherever it is used as text a person reads, by expressing that obligation separately from the accent used decoratively — so meeting a contrast floor never costs the user their chosen brand colour elsewhere, and so a background the text can actually land on cannot be left out of the reckoning.

## Requirements

### Requirement: Accent used as readable text meets the text contrast floor
Where the accent colour is used to render text a user reads, it SHALL achieve a contrast ratio of at least
4.5:1 against the background that text is rendered on, in every theme the application offers, and for every
accent the user can select. This SHALL hold for the application's default accent and theme as shipped.

#### Scenario: Accent text is readable on every theme surface
- **WHEN** accent-coloured text is rendered on any surface the application's theme defines
- **THEN** it meets at least a 4.5:1 contrast ratio against that surface

#### Scenario: Every accent choice satisfies the floor
- **WHEN** the user selects any available accent
- **THEN** accent-coloured text still meets the floor, in every theme

#### Scenario: The shipped default is not an exception
- **WHEN** the application is used as shipped, with no accent or theme changed
- **THEN** accent-coloured text meets the floor

### Requirement: The obligation is scored against every background the text can land on
The colour carrying this obligation SHALL be derived by scoring it against **every** background accent text
can actually be rendered on — including backgrounds that are themselves derived from the accent — rather than
against a nominated subset. A background class omitted from scoring SHALL be treated as unverified, not as
passing.

#### Scenario: Accent-tinted backgrounds are scored
- **WHEN** accent text is rendered on a background that is itself tinted from the accent
- **THEN** that combination is one the derivation scored, and it meets the floor

#### Scenario: Adjusting the text cannot be cancelled by the background moving with it
- **WHEN** the text colour is adjusted to meet the floor on a background derived from the same accent
- **THEN** the resulting contrast is measured on the adjusted pair rather than assumed from the untinted case

#### Scenario: An unscored background class is not treated as conforming
- **WHEN** a background class exists that the derivation did not score
- **THEN** it is reported as unverified rather than counted as satisfying the floor

### Requirement: The text obligation is expressed separately from the decorative accent
The colour satisfying the text floor SHALL be expressed separately from the accent used decoratively, so that
satisfying the floor does not alter fills, borders or other non-text uses of the user's chosen accent.

#### Scenario: Meeting the text floor does not restyle non-text accent uses
- **WHEN** the text colour is adjusted to meet the floor
- **THEN** accent fills and borders render in the user's chosen accent, unchanged

#### Scenario: The non-text focus indicator is unaffected
- **WHEN** the text obligation is satisfied
- **THEN** the focus indicator's colour remains derived independently of theme, exactly as before

### Requirement: A proposed colour must be one the derivation can produce
Any colour asserted to satisfy the floor SHALL be a value the derivation itself can emit. A colour that
satisfies the ratio but is unreachable by the derivation SHALL NOT be accepted as evidence that the floor is
met.

#### Scenario: An unproducible colour is rejected
- **WHEN** a colour is proposed that meets the ratio but the derivation cannot emit it
- **THEN** it is rejected, and the derivation's actual output for that input is scored instead
