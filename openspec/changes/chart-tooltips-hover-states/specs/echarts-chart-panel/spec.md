## ADDED Requirements

### Requirement: Chart tooltip uses themed shadow, radius, and mono value font
The chart tooltip SHALL apply the app's shadow (`--app-shadow-soft`) and
radius (`--app-radius-md`) tokens, and SHALL render its value text in the
app's monospace font (`--font-mono`), in addition to the already-themed
background/border/base-text-color.

#### Scenario: Tooltip box carries shadow and radius
- **WHEN** a chart panel's tooltip is shown
- **THEN** the tooltip's rendered box carries the app's soft-shadow and
  medium-radius styling

#### Scenario: Tooltip values render in the mono font
- **WHEN** a chart panel's tooltip is shown
- **THEN** the numeric value text uses the app's monospace font family

### Requirement: Multi-series charts show an axis-trigger tooltip
Bar and line charts with more than one series sharing a category x-axis
SHALL show an axis-trigger tooltip listing every series' value at the
hovered x. Bar and line charts with exactly one series, and pie and scatter
charts (which have no shared category axis), SHALL keep an item-trigger
tooltip (unchanged).

#### Scenario: Hovering a shared-x point on a multi-series bar/line chart
- **WHEN** the user hovers a category on a bar or line chart with more than
  one series
- **THEN** the tooltip lists every series' name and formatted value at that
  category

#### Scenario: Pie, scatter, and single-series bar/line charts keep item-trigger tooltips
- **WHEN** the user hovers a pie slice, a scatter point, or a point on a
  bar/line chart with exactly one series
- **THEN** the tooltip shows only that slice's or point's own value, not an
  axis-wide comparison

### Requirement: Tooltip values honor the chart's existing number formatting
Tooltip values SHALL use the same number-formatting convention the chart's
axis labels already use, with no separate unit/label-format system.

#### Scenario: Tooltip value matches axis-label formatting
- **WHEN** a chart tooltip renders a numeric value
- **THEN** that value is formatted identically to how the same number would
  render on the chart's own axis label

### Requirement: Hover emphasis is subtle and respects reduced motion
Series/point hover SHALL show a subtle highlight (series emphasis / point
enlarge). When the user's OS/browser signals a reduced-motion preference,
the emphasis SHALL apply with no animated transition.

#### Scenario: Hovering a series or point shows subtle emphasis
- **WHEN** the user hovers a series or a data point
- **THEN** that series/point is visibly, subtly highlighted (e.g. slightly
  enlarged or brightened) relative to its resting state

#### Scenario: Reduced-motion preference suppresses the emphasis transition
- **WHEN** the user's browser reports `prefers-reduced-motion: reduce`
- **THEN** the hover emphasis still applies but with no animated transition

### Requirement: Tooltip, axis-trigger, and hover-emphasis styling re-resolve on theme or accent change
Tooltip and hover-emphasis colors SHALL reflect the live theme (light/dark)
and accent color at all times, without requiring the chart to remount.

#### Scenario: Tooltip colors update after a light/dark toggle
- **WHEN** the user toggles between light and dark theme while a chart panel
  is mounted
- **THEN** the next tooltip shown uses the newly active theme's colors,
  without the chart remounting

#### Scenario: Hover emphasis color updates after an accent change
- **WHEN** the user changes the active accent color while a chart panel is
  mounted, with no theme toggle
- **THEN** the next hover emphasis shown uses the newly active accent color,
  without the chart remounting
