## ADDED Requirements

### Requirement: Usage page charts render text in the theme text colour
The admin usage page's charts SHALL render their axis tick labels, axis names, legend text and global text style in the live `--app-text` theme token, tracking light/dark theme changes, and that text SHALL measure at least 4.5:1 (WCAG 2.x SC 1.4.3 AA, normal text) against the surface the chart renders on in both themes.

#### Scenario: Usage chart in dark theme
- **WHEN** the owner views the admin usage page in dark theme
- **THEN** every usage chart's axis labels and legend text use the dark theme's `--app-text` colour
- **AND** that colour measures at least 4.5:1 against the rendered card surface

#### Scenario: Usage chart in light theme
- **WHEN** the owner views the admin usage page in light theme
- **THEN** every usage chart's axis labels and legend text use the light theme's `--app-text` colour
