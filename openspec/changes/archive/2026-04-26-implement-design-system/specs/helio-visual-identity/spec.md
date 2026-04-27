## ADDED Requirements

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
