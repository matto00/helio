## ADDED Requirements

### Requirement: Panel detail modal does not expose a chart type selector
The panel detail modal MUST NOT display a chart type selector for any panel type. A chart panel's chart type is
chosen on its bound Output's configuration; a panel's previously stored `appearance.chart.chartType` (set through the
appearance write API) still takes precedence when the panel renders.

#### Scenario: No chart type selector for a chart panel
- **WHEN** an output panel bound to a chart Output is opened in the panel detail modal
- **THEN** no chart type control (no "Chart type" label and no chart-type radio options) is present

## REMOVED Requirements

### Requirement: Panel detail modal shows chart type selector for chart panels
**Reason**: The selector has not been rendered since HEL-909 (the detail modal mounts the appearance editor with its
chart section disabled); chart type is chosen on the Output.
**Migration**: Choose the chart type in the Output editor; a stored panel `chartType` still overrides it at render.

### Requirement: Chart type selector offers at least four chart types
**Reason**: No selector is rendered in the panel detail modal.
**Migration**: The Output editor's chart type options govern; the allowed set is enforced by the appearance write
validation in `panel-appearance-settings`.

### Requirement: Selected chart type is included in the Save payload
**Reason**: No selector is rendered, so the detail-modal Save never changes `chartType`.
**Migration**: None; a stored value is still honoured at render (see the ADDED requirement above).

### Requirement: Chart type selector is visually distinct from colour and transparency controls
**Reason**: No selector is rendered.
**Migration**: None.

### Requirement: Default chart type is line when none is stored
**Reason**: With no selector, the default is a render-time resolution, specified in `panel-appearance-settings`
(panel's stored type, else the Output's, else line).
**Migration**: See `panel-appearance-settings` "Appearance writes validate chart type".
