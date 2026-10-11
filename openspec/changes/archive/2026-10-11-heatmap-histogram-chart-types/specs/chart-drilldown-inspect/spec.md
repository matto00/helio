## ADDED Requirements

### Requirement: Heatmap and histogram elements are not selectable
Clicking a heatmap cell or a histogram bar SHALL NOT store a selection descriptor, open the Inspect view or apply a
cross-filter, and hovering these elements SHALL NOT show a pointer cursor in the rendered chart or otherwise advertise them as
clickable.
Heatmap and histogram panels SHALL still be narrowed as cross-filter targets by selections made on other panels.

#### Scenario: Click on a histogram bar
- **WHEN** the user clicks a bar of a histogram panel
- **THEN** no selection is stored, no Inspect view opens and the cursor over the bar is not a pointer

#### Scenario: Heatmap as a cross-filter target
- **WHEN** a selection on another panel cross-filters a dashboard that contains a heatmap bound to the same pipeline
- **THEN** the heatmap re-renders from the narrowed rows
