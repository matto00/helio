## MODIFIED Requirements

### Requirement: Panel card container sizing baseline
The panel card container (`.panel-grid-card`) SHALL use `container-type: size` and `container-name: panel-card`
in addition to the existing layout properties. The default `clamp(14px, 2vw, 22px)` padding and `gap: 14px`
remain as the baseline; `@container panel-card` breakpoint rules (defined in the `panel-container-queries`
spec) override these values at compact and spacious sizes. The card border radius SHALL be `--app-radius-lg` (10px).

#### Scenario: Panel card at default grid size
- **WHEN** a panel is rendered at the default 5-row height (rowHeight=52, margin=12, the `--space-3` gutter), giving (5 × 52) + (4 × 12) = 308px total height
- **THEN** the card occupies the full grid cell with ~22px top/bottom padding at wide viewports, leaving roughly 264px for header + content + footer

#### Scenario: Panel card in compact state
- **WHEN** the panel card container dimensions fall below the compact breakpoint (width < 220px or height < 180px)
- **THEN** the container query compact rules SHALL apply, reducing padding to 10px and gap to 8px

#### Scenario: Panel card in spacious state
- **WHEN** the panel card container width is >= 420px and height >= 280px
- **THEN** the container query spacious rules SHALL apply, increasing padding to 20px and title font-size to 1.1rem

### Requirement: Grid layout sizing baseline
The panel grid SHALL use `rowHeight: 52`, `margin: [12, 12]` (horizontal and vertical gap between cells, the `--space-3` spacing token), `containerPadding: [0, 0]`, and default panel height of 5 rows, minimum 4 rows. Panel widths vary by breakpoint per `dashboardGridCols`. These values SHALL be the documented baseline for computing content area budgets.

#### Scenario: Default panel rendered height
- **WHEN** a panel is placed at the default height of 5 rows
- **THEN** its rendered pixel height is (5 × 52) + (4 × 12) = 308px total, with the card content area approximately 308px − (2 × clamp(14px,2vw,22px)) − header_height − footer_height ≈ 190–206px at typical viewport widths

#### Scenario: Gutter follows the token
- **WHEN** the desktop grid renders two horizontally or vertically adjacent panels
- **THEN** the gap between them is the `--space-3` value (12px)

## ADDED Requirements

### Requirement: A minimum-height card takes a tighter vertical rhythm
A desktop grid card at the minimum height (4 rows, `h <= 4`) SHALL use `padding-block: var(--space-3)` and `gap: var(--space-2)`, so that at the 12px grid gutter (a 244px card) the chart canvas floors of the footnoted-chart requirements still hold. Cards taller than the minimum SHALL keep their existing padding and gap.

#### Scenario: Minimum-height card
- **WHEN** a panel is rendered at the minimum height (4 rows) on the desktop grid
- **THEN** its vertical padding is `--space-3` and the gap between its header, body and footer is `--space-2`

#### Scenario: Taller card
- **WHEN** a panel is rendered at 5 rows or more
- **THEN** its padding and gap are unchanged
