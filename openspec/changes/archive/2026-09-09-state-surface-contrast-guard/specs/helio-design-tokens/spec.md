## ADDED Requirements

### Requirement: An interactive state background is chosen for contrast, not for ramp position
An interactive state background SHALL be chosen so that it contrasts measurably with the surface it renders on, rather than by taking the next position on the elevation ramp. Where a theme's ramp saturates — so that no "more elevated" value is distinguishable from the surface in that theme — the state SHALL move in whichever direction is visible in that theme, even if that direction is opposite to the ramp's.

The light theme's ramp saturates at its top: the elevated rung and the top surface hold the same value, so a state layered on a top surface has no lighter value available and must go darker, while the same state in dark theme must go lighter.

#### Scenario: A state on a saturated ramp position uses a contrasting value
- **WHEN** a state renders on a surface at the top of a theme's elevation ramp
- **THEN** it uses a value that contrasts with that surface, rather than the ramp's adjacent rung

#### Scenario: Documentation records the saturation rule
- **WHEN** the design documentation describes the elevation ramp
- **THEN** it records that the ramp does not govern interactive state backgrounds and says what does
