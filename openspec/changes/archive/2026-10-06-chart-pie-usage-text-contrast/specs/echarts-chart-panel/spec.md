## ADDED Requirements

### Requirement: Pie slice labels use the chart's resolved text colour
A pie chart panel's slice labels SHALL render in the same resolved text colour as the chart's legend: the live `--app-text` theme token when the panel's `appearance.color` is `"inherit"`, absent or empty, and the explicit colour unchanged when one is set. Slice labels SHALL NOT carry a contrasting outline that substitutes for the text colour's own contrast. With an inherited colour, the slice label text SHALL measure at least 4.5:1 (WCAG 2.x SC 1.4.3 AA, normal text) against the panel surface it renders on, in both light and dark themes. Slice label placement and content (including the optional percent formatter) are unchanged.

#### Scenario: Default pie panel slice labels in dark theme
- **WHEN** a pie chart panel with `appearance.color: "inherit"` renders in dark theme
- **THEN** its slice labels use the dark theme's `--app-text` colour
- **AND** that colour measures at least 4.5:1 against the rendered panel surface

#### Scenario: Default pie panel slice labels in light theme
- **WHEN** a pie chart panel with `appearance.color: "inherit"` renders in light theme
- **THEN** its slice labels use the light theme's `--app-text` colour

#### Scenario: Percent labels keep the resolved colour
- **WHEN** a pie chart panel has percent labels enabled
- **THEN** the slice labels show percentages and still use the resolved text colour

#### Scenario: Explicit panel colour applies to slice labels
- **WHEN** a pie chart panel has `appearance.color` set to an explicit colour such as `"#336699"`
- **THEN** its slice labels use `"#336699"`
