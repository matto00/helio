## Purpose
Defines the frontend dashboard chrome polish requirements: visual structure, interaction styling,
and the foundation for future appearance customization.
## Requirements
### Requirement: Polished dashboard shell styling
The system SHALL render the existing dashboard experience with a more polished modern visual shell.

#### Scenario: Dashboard shell uses polished structured layout
- **WHEN** the frontend renders the dashboard page
- **THEN** the app shell presents a structured header, sidebar, and content area with a polished layout
- **THEN** the main dashboard content spans most of the viewport width

#### Scenario: Surfaces use rounded premium styling
- **WHEN** the frontend renders dashboard and panel surfaces
- **THEN** those surfaces use rounded edges, subtle depth, and restrained visual treatment

### Requirement: Flexible panel grid foundation
The system SHALL provide a frontend panel-grid foundation that can support future freely placed and resizable dashboard panels.

#### Scenario: Panels render inside a reusable grid layout
- **WHEN** the frontend renders dashboard panels
- **THEN** panels render inside a reusable grid layout foundation instead of a plain static list

### Requirement: Restrained interaction styling
The system SHALL avoid heavy component-library-style click animations while keeping interactions clear and polished.

#### Scenario: Interactive dashboard controls remain low-motion
- **WHEN** the user interacts with dashboard selection controls or theme controls
- **THEN** the UI uses restrained hover, focus, and active states without splashy click animations

### Requirement: Foundation for future appearance customization
The system SHALL keep styling modular so future user-configurable appearance controls can reuse the same theme foundation.

#### Scenario: Styling foundations remain customization-ready
- **WHEN** future tickets add dashboard and panel appearance customization
- **THEN** they can build on the existing tokenized theme foundation instead of replacing the styling system

### Requirement: Dashboard header shows count and add controls only
The dashboard panel-list header SHALL show only the panel-count chip and the add-panel (+) button
when a dashboard is selected. Zoom controls SHALL NOT appear in the header.

#### Scenario: Dashboard header is simplified when dashboard is selected
- **WHEN** a dashboard is selected
- **THEN** the panel-list header shows only the panel-count chip and the add-panel (+) button
- **THEN** zoom controls are NOT in the header; they appear in the floating zoom widget

### Requirement: Dot-grid overlay is visible across all theme and background combinations
The dot-grid pattern on the app shell SHALL remain visible in both light and dark themes,
whether or not the user has set a dashboard background color override.

#### Scenario: Dot-grid is visible with a dark background override in dark mode
- **WHEN** the user has set a dark dashboard background override and dark theme is active
- **THEN** the dot-grid pattern is still distinguishable over the background color

#### Scenario: Dot-grid is visible in light mode with no background override
- **WHEN** no dashboard background override is set and light theme is active
- **THEN** the dot-grid pattern is subtly visible over the default app background

#### Scenario: Dot-grid is visible with a custom background override in light mode
- **WHEN** the user has set a background color override and light theme is active
- **THEN** the dot-grid pattern remains perceptible over the overridden background

### Requirement: Grid background alpha is tuned for legibility in both themes
The `resolveDashboardGridBackground` function SHALL apply alpha values that make the grid
surface subtly distinguishable from the surrounding app shell background in both themes.

#### Scenario: Grid background alpha differs between dark and light themes
- **WHEN** `resolveDashboardGridBackground` is called with the same appearance in dark vs light theme
- **THEN** the returned rgba alpha values differ to account for the luminance difference between themes

