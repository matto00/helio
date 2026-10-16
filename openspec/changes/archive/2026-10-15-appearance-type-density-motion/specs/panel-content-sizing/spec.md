## MODIFIED Requirements

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

### Requirement: Grid layout sizing baseline
In the Comfortable (default) density the panel grid SHALL use `rowHeight: 52`, `margin: [12, 12]` (horizontal and vertical gap between cells, the `--space-3` spacing token), `containerPadding: [0, 0]`, and default panel height of 5 rows, minimum 4 rows. In the Compact density it SHALL use an 8px gutter (`--space-2`) and `rowHeight: 56` (the Comfortable `rowHeight` plus the 4px gutter difference), so panel tops do not move and every panel is exactly 4px taller; the density is a per-user setting defined by the `appearance-preferences` capability. Panel widths vary by breakpoint per `dashboardGridCols`. The Comfortable values SHALL be the documented baseline for computing content area budgets.

#### Scenario: Default panel rendered height
- **WHEN** a panel is placed at the default height of 5 rows in the Comfortable density
- **THEN** its rendered pixel height is (5 × 52) + (4 × 12) = 308px total, with the card content area approximately 308px − (2 × clamp(14px,2vw,22px)) − header_height − footer_height ≈ 190–206px at typical viewport widths
- **AND** in the Compact density it is (5 × 56) + (4 × 8) = 312px, exactly 4px taller, with its top edge at the same position

#### Scenario: Gutter follows the token
- **WHEN** the desktop grid renders two horizontally or vertically adjacent panels
- **THEN** the gap between them is the density's `--density-grid-gap` value: `--space-3` (12px) in the Comfortable (default) density and `--space-2` (8px) in the Compact density
