## Purpose
Defines requirements for the Helio visual identity system, covering typography selection, color tokens, and overall aesthetic direction.

## Requirements

### Requirement: Visual direction prototyping and selection
The system SHALL have a documented visual identity selected from at least 3 prototyped design directions.

#### Scenario: Multiple directions are prototyped before selection
- **WHEN** the visual redesign is implemented
- **THEN** at least 3 distinct visual directions (differing in color palette, typography, and overall aesthetic) SHALL have been evaluated
- **THEN** a single winning direction SHALL be selected and documented

#### Scenario: Winning direction is documented
- **WHEN** a winning visual direction is selected
- **THEN** the chosen palette (all `--app-*` token values for dark and light themes), font names and weights, and key component aesthetic
  descriptions SHALL be recorded in the design document

### Requirement: Distinctive typography system
The system SHALL use a distinctive font pairing that differentiates Helio from generic SaaS dashboard tools.

#### Scenario: Fonts are loaded and applied
- **WHEN** the app shell renders
- **THEN** the display/heading font and body font SHALL be loaded (via Google Fonts or Fontsource) and applied via `font-family` in `theme.css`

#### Scenario: Fallback fonts are specified
- **WHEN** the primary fonts fail to load
- **THEN** a suitable system font fallback SHALL be present in the `font-family` stack

### Requirement: Cohesive color token system
The system SHALL define a complete set of `--app-*` CSS custom properties that form the Helio brand palette.

#### Scenario: Dark theme tokens cover all surface types
- **WHEN** `[data-theme="dark"]` is applied
- **THEN** all `--app-bg`, `--app-surface`, `--app-text`, `--app-accent`, `--app-border`, and `--app-shadow` token variants SHALL have values
  consistent with the chosen dark direction

#### Scenario: Light theme tokens cover all surface types
- **WHEN** `[data-theme="light"]` is applied
- **THEN** all `--app-bg`, `--app-surface`, `--app-text`, `--app-accent`, `--app-border`, and `--app-shadow` token variants SHALL have values
  consistent with the chosen light direction

### Requirement: Visually distinct from the prior design
The redesigned UI SHALL look clearly different from the previous Inter/indigo/slate-based aesthetic.

#### Scenario: Font family changes
- **WHEN** the redesign is applied
- **THEN** the primary font family SHALL NOT be Inter alone

#### Scenario: Color palette changes
- **WHEN** the redesign is applied
- **THEN** the dark background color SHALL NOT be `#070b14` and the primary accent SHALL NOT be `#8ea0ff`

### Requirement: Core app shell restyling
The core app shell components SHALL be updated to reflect the chosen visual direction.

#### Scenario: App shell surfaces use new tokens
- **WHEN** the app shell (sidebar, topbar, panel grid area) renders
- **THEN** all surface colors, border radii, shadows, and typography SHALL reflect the new design token values

#### Scenario: Component aesthetic matches the direction
- **WHEN** buttons, inputs, cards, and nav items render
- **THEN** their visual treatment (borders, backgrounds, hover states) SHALL be consistent with the chosen aesthetic direction

### Requirement: Space Grotesk as primary sans-serif font
The system SHALL use Space Grotesk as the primary sans-serif font, replacing DM Sans, loaded via Google Fonts and applied as the root `font-family` in `theme.css`.

#### Scenario: Space Grotesk is loaded and applied
- **WHEN** the app shell renders
- **THEN** Space Grotesk SHALL be loaded from Google Fonts and applied as the primary `font-family` in `theme.css`
- **THEN** DM Sans SHALL NOT be referenced in any font loading or font-family declarations

#### Scenario: Fallback fonts are specified for Space Grotesk
- **WHEN** Space Grotesk fails to load
- **THEN** system-ui or sans-serif SHALL be applied as the fallback font family

### Requirement: JetBrains Mono as the designated monospace font
The system SHALL use JetBrains Mono as the designated monospace font, loaded via Google Fonts and assigned to `--font-mono` in `theme.css`, for use in tabular data, metric values, chart ticks, code blocks, and keyboard shortcut displays only.

#### Scenario: JetBrains Mono is loaded
- **WHEN** the app shell renders
- **THEN** JetBrains Mono SHALL be loaded from Google Fonts alongside Space Grotesk

#### Scenario: JetBrains Mono is not used for body or headings
- **WHEN** any body text or heading element renders
- **THEN** JetBrains Mono SHALL NOT be applied to those elements

### Requirement: Wordmark letter-spacing set to 0.14em
The Helio wordmark in the command bar and sidebar SHALL use letter-spacing of 0.14em (reduced from the previous 0.18em).

#### Scenario: Command bar wordmark uses 0.14em tracking
- **WHEN** the command bar renders
- **THEN** the "Helio" wordmark text SHALL have `letter-spacing: 0.14em`

#### Scenario: Sidebar wordmark uses 0.14em tracking
- **WHEN** the sidebar renders
- **THEN** the "Helio" wordmark text in the sidebar SHALL have `letter-spacing: 0.14em`
