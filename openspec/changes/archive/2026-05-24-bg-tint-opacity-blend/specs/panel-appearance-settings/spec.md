## ADDED Requirements

### Requirement: Panel transparency slider produces a smooth and well-distributed alpha range
The panel transparency slider (0–100) SHALL map to an alpha range that produces a perceptible
and smoothly-distributed change in panel surface opacity across the full slider travel.

#### Scenario: Panel surface is nearly opaque at zero transparency
- **WHEN** a panel's transparency is set to 0
- **THEN** the `buildPanelSurface` function returns an rgba value with an alpha at or near 0.9

#### Scenario: Panel surface is significantly transparent at maximum transparency
- **WHEN** a panel's transparency is set to 100
- **THEN** the `buildPanelSurface` function returns an rgba value with an alpha at or near 0.18

#### Scenario: Panel transparency alpha decreases monotonically across the slider range
- **WHEN** transparency increases from 0 to 100
- **THEN** the resulting surface alpha decreases monotonically with no discontinuities
