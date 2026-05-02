## MODIFIED Requirements

### Requirement: Panel card container sizing baseline
The panel card container (`.panel-grid-card`) SHALL use `container-type: size` and `container-name: panel-card`
in addition to the existing layout properties. The default `clamp(14px, 2vw, 22px)` padding and `gap: 14px`
remain as the baseline; `@container panel-card` breakpoint rules (defined in the `panel-container-queries`
spec) override these values at compact and spacious sizes. The card border radius SHALL be `--app-radius-lg` (10px).

#### Scenario: Panel card at default grid size
- **WHEN** a panel is rendered at the default 5-row height (rowHeight=52, margin=18), giving approximately 314px total height
- **THEN** the card occupies the full grid cell with ~22px top/bottom padding at wide viewports, leaving roughly 270px for header + content + footer

#### Scenario: Panel card in compact state
- **WHEN** the panel card container dimensions fall below the compact breakpoint (width < 220px or height < 180px)
- **THEN** the container query compact rules SHALL apply, reducing padding to 10px and gap to 8px

#### Scenario: Panel card in spacious state
- **WHEN** the panel card container width is >= 420px and height >= 280px
- **THEN** the container query spacious rules SHALL apply, increasing padding to 20px and title font-size to 1.1rem
