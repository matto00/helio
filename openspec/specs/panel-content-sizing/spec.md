# panel-content-sizing Specification

## Purpose
Sizing baseline for panel content areas: documents current padding, font sizes, and element dimensions for each panel type (metric, text, table, chart, state overlays) and the grid layout configuration. Identifies panel types whose content is sparse relative to the default panel container. Produced by HEL-158 as the reference spec for follow-on implementation issues.

## Requirements

### Requirement: Panel card container sizing baseline
The panel card container (`.panel-grid-card`) SHALL use `container-type: size` and `container-name: panel-card`
in addition to the existing layout properties. The default `clamp(14px, 2vw, 22px)` padding and `gap: 14px`
remain as the baseline; `@container panel-card` breakpoint rules (defined in the `panel-container-queries`
spec) override these values at compact and spacious sizes. The card border radius SHALL be `--app-radius-lg` (10px).

#### Scenario: Panel card at default grid size
- **WHEN** a panel is rendered at the default 5-row height in the Comfortable (default) density (rowHeight=52, margin=12, the `--space-3` gutter), giving (5 × 52) + (4 × 12) = 308px total height
- **THEN** the card occupies the full grid cell with ~22px top/bottom padding at wide viewports, leaving roughly 264px for header + content + footer
- **AND** in the Compact density (rowHeight=56, margin=8) the card is 312px tall, exactly 4px taller, at an unchanged top position

#### Scenario: Panel card in compact state
- **WHEN** the panel card container dimensions fall below the compact breakpoint (width < 220px or height < 180px)
- **THEN** the container query compact rules SHALL apply, reducing padding to 10px and gap to 8px

#### Scenario: Panel card in spacious state
- **WHEN** the panel card container width is >= 420px and height >= 280px
- **THEN** the container query spacious rules SHALL apply, increasing padding to 20px and title font-size to 1.1rem

### Requirement: Metric panel sizing
The metric panel (`panel-content--metric`) SHALL use `padding: 12px 16px`, `gap: 4px` between value and label, a value font-size of `2rem` (32px), and a label font-size of `0.75rem` (12px). The value SHALL use `font-family: var(--font-mono)` with `font-variant-numeric: tabular-nums` and `font-weight: 700`. The label SHALL use `text-transform: uppercase` and `letter-spacing: 0.06em`.

#### Scenario: Metric panel with bound data
- **WHEN** a metric panel has a bound data source providing a value and label
- **THEN** the value is displayed at 32px in JetBrains Mono and the label beneath it at 12px uppercase

#### Scenario: Metric panel sparseness at default height
- **WHEN** a metric panel is rendered at the default 5-row height (~270px content area after card padding)
- **THEN** the two-line metric content (value + label) occupies approximately 44px of content height, leaving ~226px unused — classified as SPARSE (content utilization < 60%)

### Requirement: Table panel sizing
The table panel (`panel-content--table`) SHALL fill the full available content height within the panel card
by using `flex: 1`, `flex-direction: column`, `justify-content: flex-start`, `align-items: stretch`,
`overflow-y: auto`, and `min-height: 0`. The `<table>` element SHALL have `height: 100%` so it expands to
fill short tables without dead space, and `min-height: min-content` to avoid collapsing when empty.
Cell padding of `4px 8px`, cell height of `18px`, and font-size of `0.78rem` (12.48px) are unchanged.
Header cells SHALL have `background: var(--app-accent-surface)` and `border: 1px solid var(--app-border-subtle)`.

#### Scenario: Table panel with multiple rows exceeding panel height
- **WHEN** a table panel renders more rows than can fit in the available panel content height
- **THEN** the `.panel-content--table` container SHALL scroll vertically and the panel card boundary SHALL NOT be exceeded

#### Scenario: Table panel with few rows
- **WHEN** a table panel renders 1-3 data rows at the default 5-row panel height
- **THEN** the table SHALL occupy the top of the content area with no dead space gap between the last row and the panel footer area — the table element fills available height

#### Scenario: Table panel fills panel area
- **WHEN** a table panel is rendered at any height in the dashboard grid
- **THEN** the `.panel-content--table` element SHALL fill the full available content height (flex: 1 behaviour), leaving no unused vertical space below the panel card content region

### Requirement: Chart panel sizing
The chart panel (`ChartPanel`) SHALL render via `ReactECharts` with `style={{ height: "100%", width: "100%" }}` and `autoResize: true`. The chart SHALL fill the full content area allocated by the parent panel card after header and footer are subtracted. Internal ECharts padding and label font sizes are managed by ECharts defaults and appearance overrides, not by CSS.

#### Scenario: Chart panel fill at any height
- **WHEN** a chart panel is resized via the grid
- **THEN** the ECharts canvas redraws to fill the new content dimensions within one render cycle

### Requirement: State overlay sizing
Loading, error, and no-data overlays SHALL use `font-size: 0.78rem` (12.48px) for the state label. The loading spinner SHALL be `24px × 24px` with a `3px` border and a `0.7s linear` rotation animation. Error text SHALL use `color: var(--app-danger, #e05252)`.

#### Scenario: Loading state
- **WHEN** a panel is in loading state
- **THEN** a 24px spinner and a "Loading..." label at 12.48px are centered in the content area

#### Scenario: Error state
- **WHEN** a panel encounters a data fetch error
- **THEN** the error message is displayed at 12.48px in `--app-danger` color, centered

### Requirement: Grid layout sizing baseline
In the Comfortable (default) density the panel grid SHALL use `rowHeight: 52`, `margin: [12, 12]` (horizontal and vertical gap between cells, the `--space-3` spacing token), `containerPadding: [0, 0]`, and default panel height of 5 rows, minimum 4 rows. In the Compact density it SHALL use an 8px gutter (`--space-2`) and `rowHeight: 56` (the Comfortable `rowHeight` plus the 4px gutter difference), so panel tops do not move and every panel is exactly 4px taller; the density is a per-user setting defined by the `appearance-preferences` capability. Panel widths vary by breakpoint per `dashboardGridCols`. The Comfortable values SHALL be the documented baseline for computing content area budgets.

#### Scenario: Default panel rendered height
- **WHEN** a panel is placed at the default height of 5 rows in the Comfortable density
- **THEN** its rendered pixel height is (5 × 52) + (4 × 12) = 308px total, with the card content area approximately 308px − (2 × clamp(14px,2vw,22px)) − header_height − footer_height ≈ 190–206px at typical viewport widths
- **AND** in the Compact density it is (5 × 56) + (4 × 8) = 312px, exactly 4px taller, with its top edge at the same position

#### Scenario: Gutter follows the token
- **WHEN** the desktop grid renders two horizontally or vertically adjacent panels
- **THEN** the gap between them is the density's `--density-grid-gap` value: `--space-3` (12px) in the Comfortable (default) density and `--space-2` (8px) in the Compact density

### Requirement: Identified sparse panel types
The following panel types are classified as SPARSE at the default 5-row height (content utilization < 60% of available content area) and SHALL be addressed in follow-on implementation tickets:

- **Metric**: ~44px content (value + label) in ~270px area — **SPARSE**
- **Text**: varies by content length; a single short string is **SPARSE**
- **Table**: sparse at 1-2 rows

The **Chart** panel is not classified as sparse because ECharts fills the full container.

#### Scenario: Metric panel flagged for sizing improvement
- **WHEN** a metric panel is at default height
- **THEN** implementation tickets SHALL increase the value font-size and/or add supporting statistics to increase content density

#### Scenario: Table panel flagged for sizing improvement
- **WHEN** a table panel renders fewer than 3 rows at default height
- **THEN** implementation tickets SHALL consider increasing cell padding or row height to fill available space

### Requirement: Text panel sizing for literal content
The text panel (`panel-content--text`) SHALL use `padding: 12px 16px` (inherited from `.panel-content`),
`gap: 8px` between lines, and `overflow-y: auto` to confine content within the panel boundary.
Live content SHALL use font-size that scales with the container height via container queries
(defined in the `panel-container-queries` spec):
- Compact (`height < 180px`): `var(--text-xs)` (`0.75rem`)
- Default (`height 180px–279px`): `var(--text-sm)` (`0.875rem`)
- Spacious (`height >= 280px`): `var(--text-lg)` (`1.125rem`)

Placeholder skeleton lines SHALL be `height: 10px` with `border-radius: var(--app-radius-sm)` (`6px`): the long line at
85% width and the short line at 60% width.

A text panel's live content is its own literal `config.content`; a text panel has no data binding, and no fetched row
data SHALL change what it renders.

#### Scenario: Text panel with literal content at default height
- **WHEN** a text panel has non-empty `config.content` at the default height (180px–279px)
- **THEN** the text SHALL render at `var(--text-sm)` (`0.875rem`) left-aligned with `white-space: pre-wrap`
- **AND** the content fills the panel width and wraps naturally at the container boundary

#### Scenario: Text panel with literal content at spacious height
- **WHEN** a text panel has non-empty `config.content` and the container height is >= 280px
- **THEN** the text SHALL render at `var(--text-lg)` (`1.125rem`)

#### Scenario: Text panel sparseness at default height
- **WHEN** a text panel is rendered at the default height with short text content
- **THEN** a single short string occupies one line of about 18px (`var(--text-sm)` at the computed `line-height: normal`), far below 60% of the content area, classified as SPARSE

#### Scenario: Text panel content overflow at spacious height
- **WHEN** a text panel has long content and the container height is >= 280px
- **THEN** the `.panel-content--text` element scrolls rather than overflowing the panel boundary

### Requirement: A minimum-height card takes a tighter vertical rhythm
A desktop grid card at the minimum height (4 rows, `h <= 4`) SHALL use `padding-block: var(--space-3)` and `gap: var(--space-2)`, so that at the 12px grid gutter (a 244px card) the chart canvas floors of the footnoted-chart requirements still hold. Cards taller than the minimum SHALL keep their existing padding and gap.

#### Scenario: Minimum-height card
- **WHEN** a panel is rendered at the minimum height (4 rows) on the desktop grid
- **THEN** its vertical padding is `--space-3` and the gap between its header, body and footer is `--space-2`

#### Scenario: Taller card
- **WHEN** a panel is rendered at 5 rows or more
- **THEN** its padding and gap are unchanged
