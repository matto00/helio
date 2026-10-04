## ADDED Requirements

### Requirement: A chart panel with no stored chart appearance renders with the default chart appearance
When a chart panel's stored appearance has no `chart` sub-object (absent or cleared), the rendered chart SHALL
apply the default chart appearance — the same default the appearance editor pre-fills — so its tooltip,
axes, gridlines, fonts, legend and hover emphasis are themed exactly as for a panel that stores that default
explicitly, in both light and dark themes. The stored appearance SHALL NOT be modified by rendering. A panel
that does store a `chart` sub-object SHALL render from its stored values unchanged.

#### Scenario: Chart-less panel gets the themed tooltip
- **WHEN** a chart panel with no stored `appearance.chart` is rendered
- **THEN** its tooltip is shown with the app's themed background, border, shadow, radius and mono value font

#### Scenario: Chart-less panel matches an explicitly-defaulted panel
- **WHEN** one chart panel has no stored `appearance.chart` and another identical panel stores the default
  chart appearance explicitly
- **THEN** both render the same chart option (tooltip, axes, gridlines, fonts, legend, series colors, hover
  emphasis) in light theme and in dark theme

#### Scenario: Stored tooltip-disabled appearance still hides the tooltip
- **WHEN** a chart panel stores `appearance.chart` with `tooltip.enabled: false`
- **THEN** the tooltip is not shown

#### Scenario: Rendering does not write appearance
- **WHEN** a chart panel with no stored `appearance.chart` is rendered and the dashboard is reloaded
- **THEN** the panel's stored appearance still has no `chart` sub-object
