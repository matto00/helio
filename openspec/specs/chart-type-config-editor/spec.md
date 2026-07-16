# chart-type-config-editor Specification

## Purpose
Chart-type-specific "Display" section in the panel edit pane that swaps live with the selected chart type, riding the existing dirty/save/cancel contract with mobile-grade touch targets.
## Requirements
### Requirement: Edit pane shows a Display section that swaps with the selected chart type
For `panel.type === "chart"`, the panel edit pane MUST render a "Display" section whose controls are
determined by the chart type currently selected in the Appearance section's chart type selector —
swapping live as the selector changes, before save. Exactly one type's controls are visible at a time:
- **Line**: Smooth lines (toggle), Point markers (toggle), Area fill (toggle)
- **Bar**: Orientation (vertical/horizontal), Stacking (none/stacked/normalized), Group spacing (0–100%)
- **Pie**: Donut hole size (0–90%), Percentage labels (toggle)
- **Scatter**: Point size field (field select, optional), Color by field (field select, optional) —
  shown only when a DataType is bound, with an explicit "— None —" clear option

Controls MUST use the shared component set and Epic A config-editor patterns (`Select`, the existing
checkbox/slider idioms of `frontend/src/features/panels/ui/editors/`), honoring DESIGN.md tokens and
scales. Non-obvious controls SHALL carry an inline hint.

#### Scenario: Section swaps when chart type changes
- **GIVEN** a chart panel open in edit mode with chartType `line`
- **WHEN** the user changes the chart type selector to `pie`
- **THEN** the Display section replaces the line controls with the pie controls without saving

#### Scenario: Non-chart panels show no Display section
- **WHEN** a non-chart panel is opened in edit mode
- **THEN** no chart Display section is rendered

### Requirement: Display options ride the existing dirty/save/cancel contract
Edited display options MUST participate in the edit pane's unified dirty tracking, be persisted through
the existing typed-config PATCH on Save (alongside binding fields), and revert on Cancel/discard.
Editing options for the selected type MUST merge into the per-type keyed map without altering other
types' stored entries. An untouched section persists nothing.

#### Scenario: Save persists only the edited type's options
- **GIVEN** a chart panel with stored `chartOptions.line` and chartType `bar`
- **WHEN** the user edits bar options and saves
- **THEN** the PATCH carries `chartOptions` with the new `bar` entry and the untouched `line` entry intact

#### Scenario: Cancel reverts unsaved display edits
- **WHEN** the user edits display options then cancels and confirms discard
- **THEN** reopening edit mode shows the previously saved options

#### Scenario: Untouched display section persists nothing
- **WHEN** the user saves the edit pane without touching the Display section
- **THEN** the outgoing PATCH omits the `chartOptions` key entirely

### Requirement: Display controls meet mobile touch-target standards
At viewport widths ≤768px, every interactive Display-section control MUST have a hit area of at least
44px, extending the existing `@media (max-width: 768px)` block in `PanelDetailModal.css`; the CSS-lock
test MUST pin the new rules. The section MUST NOT introduce horizontal overflow at 390px width.

#### Scenario: Touch targets at mobile width
- **WHEN** the edit pane renders at 390px viewport width with the Display section visible
- **THEN** each Display control's interactive box is at least 44px tall
- **AND** the modal content does not overflow horizontally

