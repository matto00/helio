## MODIFIED Requirements

### Requirement: Edit pane shows a Display section that swaps with the selected chart type
For a chart Output (`kind === "chart"`), the Output editor MUST render a "Display" section whose controls are
determined by the chart type currently selected in the Output editor's chart type selector —
swapping live as the selector changes, before save. Exactly one type's controls are visible at a time:
- **Line**: Smooth lines (toggle), Point markers (toggle), Area fill (toggle)
- **Bar**: Orientation (vertical/horizontal), Stacking (none/stacked/normalized), Group spacing (0–100%)
- **Pie**: Donut hole size (0–90%), Percentage labels (toggle)
- **Scatter**: Point size field (field select, optional), Color by field (field select, optional) —
  shown only when a DataType is bound, with an explicit "— None —" clear option

The panel detail modal MUST NOT render this section or any chart type selector (see `chart-type-selector`).

Controls MUST use the shared component set and Epic A config-editor patterns (`Select`, the existing
checkbox/slider idioms of `frontend/src/features/panels/ui/editors/`), honoring DESIGN.md tokens and
scales. Non-obvious controls SHALL carry an inline hint.

#### Scenario: Section swaps when chart type changes
- **GIVEN** a chart Output open in the Output editor with chartType `line`
- **WHEN** the user changes the Output editor's chart type selector to `pie`
- **THEN** the Display section replaces the line controls with the pie controls without saving

#### Scenario: Non-chart panels show no Display section
- **WHEN** a non-chart Output is open in the Output editor, or any panel is opened in the panel detail modal's edit mode
- **THEN** no chart Display section is rendered
