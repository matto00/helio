## ADDED Requirements

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
The metric panel value font-size SHALL respond to the container height:
- At container `height < 180px`: value font-size SHALL be `1.25rem`
- At container `height >= 280px`: value font-size SHALL be `2.5rem`

#### Scenario: Metric panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__metric-value` SHALL have `font-size: 1.25rem`

#### Scenario: Metric panel in spacious height
- **WHEN** the panel container height is at least `280px`
- **THEN** `.panel-content__metric-value` SHALL have `font-size: 2.5rem`

### Requirement: Table panel container query overrides
The table panel cell padding SHALL compress at compact container heights:
- At container `height < 180px`: table cell padding SHALL be `2px 6px` and cell height SHALL be `14px`

#### Scenario: Table panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__table th` and `.panel-content__table td` SHALL have `padding: 2px 6px` and `height: 14px`

### Requirement: Text panel container query overrides
The text panel font-size SHALL compress at compact heights:
- At container `height < 180px`: `.panel-content__text-live` font-size SHALL be `0.78rem`

#### Scenario: Text panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__text-live` SHALL have `font-size: 0.78rem`
