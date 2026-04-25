## MODIFIED Requirements

### Requirement: Reusable theme tokens
The system SHALL expose reusable styling tokens for shared frontend surfaces and interactions. Accent
tokens (`--app-accent` and its derived variants) SHALL additionally support runtime override via
user-selected accent color, applied through inline style properties on `:root`.

#### Scenario: Shared surfaces use centralized theme tokens
- **WHEN** the app shell, sidebar, or panel surfaces are styled
- **THEN** they use centralized theme tokens instead of hardcoded one-off values

#### Scenario: Runtime accent override takes effect immediately
- **WHEN** the user selects a new accent color
- **THEN** `document.documentElement.style.setProperty` SHALL update `--app-accent` and all derived
  accent tokens immediately without a page reload

#### Scenario: Accent token override survives theme switch
- **WHEN** the user switches between dark and light themes after having set a custom accent color
- **THEN** the custom accent color SHALL remain applied across the theme switch
