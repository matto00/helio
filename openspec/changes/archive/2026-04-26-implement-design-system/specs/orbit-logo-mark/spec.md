## ADDED Requirements

### Requirement: Orbit SVG mark in command bar
The command bar logo SHALL display the Orbit SVG mark — a circle ring, quarter-arc highlight, and center dot — in place of the current dot placeholder.

#### Scenario: Orbit mark renders instead of dot
- **WHEN** the app command bar renders
- **THEN** an SVG element with the Orbit mark geometry (circle ring, quarter-arc, center dot) SHALL be present where the `.app-command-bar__logo-dot` element previously appeared
- **THEN** no plain dot-only element SHALL remain as the logo mark in the command bar

#### Scenario: Orbit mark uses accent color
- **WHEN** the Orbit mark SVG renders
- **THEN** its fill/stroke SHALL use `var(--app-accent)` so it responds to theme changes and runtime accent overrides

#### Scenario: Orbit mark has a glow effect
- **WHEN** the Orbit mark SVG renders
- **THEN** a `drop-shadow` filter using the accent color SHALL be applied to create the glow effect described in the design specification

### Requirement: Wordmark letter-spacing updated to 0.14em
The `.app-command-bar__wordmark` and `.app-sidebar__wordmark` elements SHALL use `letter-spacing: 0.14em` (reduced from the previous 0.18em).

#### Scenario: Command bar wordmark uses updated tracking
- **WHEN** the command bar renders
- **THEN** the "Helio" wordmark text SHALL have `letter-spacing: 0.14em`

#### Scenario: Sidebar wordmark uses updated tracking
- **WHEN** the sidebar renders
- **THEN** the "Helio" wordmark text in the sidebar SHALL have `letter-spacing: 0.14em`

### Requirement: Orbit mark SVG assets in public directory
Static Orbit mark SVG files SHALL be present in `frontend/public/` for use as favicon and OG image references.

#### Scenario: Orbit mark SVG exists in public directory
- **WHEN** the frontend build is created
- **THEN** at least one Orbit mark SVG file SHALL be present in `frontend/public/`

### Requirement: Sidebar logo-dot updated to Orbit mark
The sidebar logo-dot placeholder SHALL also be replaced with the Orbit SVG mark for visual consistency.

#### Scenario: Sidebar displays Orbit mark
- **WHEN** the app sidebar renders
- **THEN** the Orbit SVG mark SHALL be displayed in place of the previous sidebar dot element
