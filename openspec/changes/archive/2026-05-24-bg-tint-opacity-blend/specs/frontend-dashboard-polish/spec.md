## ADDED Requirements

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
