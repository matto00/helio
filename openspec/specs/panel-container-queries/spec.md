# panel-container-queries Specification

## Purpose
TBD - created by archiving change css-container-queries-panels. Update Purpose after archive.
## Requirements
### Requirement: Panel card establishes CSS container context
The `.panel-grid-card` element SHALL have `container-type: size` and `container-name: panel-card` applied so
that all descendant elements can use `@container panel-card` rules that respond to the panel's rendered pixel
dimensions rather than the viewport.

#### Scenario: Container type declared on panel card
- **WHEN** a panel card is rendered in the dashboard grid
- **THEN** the `.panel-grid-card` element SHALL have CSS `container-type: size` and `container-name: panel-card`
  active, verifiable via `getComputedStyle` or browser DevTools container query inspection

#### Scenario: Inner content responds to panel resize
- **WHEN** the user drags a panel resize handle to change the panel's height or width
- **THEN** any active `@container panel-card` rules SHALL recalculate against the new container dimensions
  within the same render frame (no JavaScript required)

### Requirement: Compact container breakpoint (width < 220px or height < 180px)
When the panel container is in compact state, layout SHALL compress to maximize usable area:
- `.panel-grid-card` padding SHALL be `10px` (overriding the default `clamp(14px, 2vw, 22px)`)
- `.panel-grid-card` gap SHALL be `8px` (overriding the default `14px`)
- `.panel-grid-card__title` font-size SHALL be `0.85rem`

#### Scenario: Very narrow panel card
- **WHEN** the panel card container width is less than `220px`
- **THEN** the card padding SHALL be `10px` and the title font-size SHALL be `0.85rem`

#### Scenario: Very short panel card
- **WHEN** the panel card container height is less than `180px`
- **THEN** the card padding SHALL be `10px` and the gap SHALL be `8px`

### Requirement: Spacious container breakpoint (width >= 420px and height >= 280px)
When the panel container is in spacious state, layout SHALL have slightly increased type for readability:
- `.panel-grid-card__title` font-size SHALL be `1.1rem`
- `.panel-grid-card` padding SHALL be `20px`

#### Scenario: Wide and tall panel card
- **WHEN** the panel card container width is at least `420px` AND height is at least `280px`
- **THEN** the card padding SHALL be `20px` and the title font-size SHALL be `1.1rem`

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

### Requirement: Table panel container query overrides
The table panel cell padding SHALL compress at compact container heights:
- At container `height < 180px`: table cell padding SHALL be `2px 6px` and cell height SHALL be `14px`

#### Scenario: Table panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__table th` and `.panel-content__table td` SHALL have `padding: 2px 6px` and `height: 14px`

### Requirement: Text panel container query overrides
The text panel font-size SHALL respond to the panel container dimensions via container query
breakpoints using the `panel-card` named container:

Compact breakpoint (container `height < 180px`):
- `.panel-content__text-live` font-size SHALL be `0.78rem`

Default (no container query override, height 180px–279px):
- `.panel-content__text-live` font-size is `0.9rem` (base style)

Spacious breakpoint (container `height >= 280px`):
- `.panel-content__text-live` font-size SHALL be `1.1rem`

Additionally, `.panel-content--text` SHALL have `overflow-y: auto` so that text content
is scrollable rather than clipped when it exceeds the available panel height.

#### Scenario: Text panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__text-live` SHALL have `font-size: 0.78rem`

#### Scenario: Text panel at default height
- **WHEN** the panel container height is between 180px and 279px (inclusive)
- **THEN** `.panel-content__text-live` SHALL have `font-size: 0.9rem` with no container query override active

#### Scenario: Text panel in spacious height
- **WHEN** the panel container height is at least `280px`
- **THEN** `.panel-content__text-live` SHALL have `font-size: 1.1rem`

#### Scenario: Text panel content overflow
- **WHEN** a text panel has content that exceeds the available height at any font-size
- **THEN** the `.panel-content--text` element SHALL scroll rather than clip or overflow the panel boundary

