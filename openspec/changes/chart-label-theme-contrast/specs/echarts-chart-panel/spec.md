## ADDED Requirements

### Requirement: Chart text with an inherited panel colour resolves to the panel's theme text colour
When a chart panel's `appearance.color` is `"inherit"`, absent, or empty, the rendered chart's axis tick labels, axis
names, legend text and global text style SHALL use the same text colour the panel card's body text resolves to: the
live `--app-text` theme token, on untinted and tinted panels alike. The card's contrast flip is applied defensively
(chart and card share one rule), but it does not trigger for an inherited colour at the current tint strength, so the
token is what renders. This SHALL hold for line, bar, scatter and pie charts in both light and dark themes, and the resolved
colour SHALL measure at least 4.5:1 (WCAG 2.x SC 1.4.3 AA, normal text) against the panel surface it renders on. When
`appearance.color` is an explicit colour value, the chart SHALL use that colour unchanged.

#### Scenario: Default panel in dark theme gets readable axis labels
- **WHEN** a line, bar or scatter chart panel with `appearance.color: "inherit"` renders in dark theme
- **THEN** its axis tick labels, axis names and legend text use the dark theme's `--app-text` colour
- **AND** that colour measures at least 4.5:1 against the rendered panel surface

#### Scenario: Default pie panel legend is themed
- **WHEN** a pie chart panel with `appearance.color: "inherit"` renders in light or dark theme
- **THEN** its legend text uses that theme's `--app-text` colour

#### Scenario: Panel with no stored colour behaves like inherit
- **WHEN** a chart panel's appearance has no `color` value
- **THEN** its chart text resolves exactly as for `appearance.color: "inherit"`

#### Scenario: Tinted panel chart text equals the card text and stays readable
- **WHEN** a chart panel with `appearance.color: "inherit"` has a background tint
- **THEN** the chart text equals the colour the panel card's body text resolves to (currently the `--app-text` token)
- **AND** it measures at least 4.5:1 against the tinted surface (dark `#514611`: 8.19, light `#fdf3be`: 14.94)

#### Scenario: Explicit panel colour is honoured
- **WHEN** a chart panel has `appearance.color` set to an explicit colour such as `"#336699"`
- **THEN** its axis labels, axis names and legend text use `"#336699"`
