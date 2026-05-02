## MODIFIED Requirements

### Requirement: Metric panel container query overrides
The metric panel value AND label font-sizes SHALL respond to the container height via container
query breakpoints. Additionally, a trend indicator element, when present, SHALL scale at these
breakpoints.

Compact breakpoint (container `height < 180px`):
- `.panel-content__metric-value` font-size SHALL be `1.25rem`
- `.panel-content__metric-label` font-size SHALL be `0.65rem`
- `.panel-content__metric-trend` font-size SHALL be `0.6rem`

Default (no container query override, height 180px–279px):
- `.panel-content__metric-value` font-size is `2rem` (base style)
- `.panel-content__metric-label` font-size is `0.75rem` (base style)
- `.panel-content__metric-trend` font-size is `0.7rem` (base style)

Spacious breakpoint (container `height >= 280px`):
- `.panel-content__metric-value` font-size SHALL be `2.5rem`
- `.panel-content__metric-label` font-size SHALL be `0.85rem`
- `.panel-content__metric-trend` font-size SHALL be `0.8rem`

#### Scenario: Metric panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__metric-value` SHALL have `font-size: 1.25rem`
- **AND** `.panel-content__metric-label` SHALL have `font-size: 0.65rem`

#### Scenario: Metric panel in spacious height
- **WHEN** the panel container height is at least `280px`
- **THEN** `.panel-content__metric-value` SHALL have `font-size: 2.5rem`
- **AND** `.panel-content__metric-label` SHALL have `font-size: 0.85rem`

#### Scenario: Metric panel at default height
- **WHEN** the panel container height is between 180px and 279px (inclusive)
- **THEN** `.panel-content__metric-value` SHALL have `font-size: 2rem` and `.panel-content__metric-label` SHALL have `font-size: 0.75rem` with no container query override active
