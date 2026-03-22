### Requirement: Each panel type renders a visually distinct body
The panel grid MUST render a different body content area for each panel type (`metric`, `chart`, `text`, `table`). Each body SHALL be recognisable as its type without requiring a label.

#### Scenario: Metric panel renders a large value placeholder
- **WHEN** a panel with `type: "metric"` is displayed in the grid
- **THEN** the panel body shows a large placeholder value (e.g. "--") with a sub-label

#### Scenario: Chart panel renders a bar-chart skeleton
- **WHEN** a panel with `type: "chart"` is displayed in the grid
- **THEN** the panel body shows a set of height-varied bars representing a chart placeholder

#### Scenario: Text panel renders placeholder text lines
- **WHEN** a panel with `type: "text"` is displayed in the grid
- **THEN** the panel body shows faded placeholder text lines

#### Scenario: Table panel renders a table skeleton
- **WHEN** a panel with `type: "table"` is displayed in the grid
- **THEN** the panel body shows a table structure with header row and placeholder data rows

### Requirement: Unknown panel types degrade gracefully
If a panel has an unrecognised or missing type value, the grid MUST render a fallback body rather than crashing or leaving the body blank.

#### Scenario: Panel with unknown type falls back to metric rendering
- **WHEN** a panel with an unrecognised type is displayed
- **THEN** the metric placeholder is shown as a safe fallback

### Requirement: Type badge is visible on each panel card
Each panel card in the grid MUST display the panel's type as a small visible label so users can identify the type at a glance without relying solely on the placeholder content.

#### Scenario: Type badge shown on panel card
- **WHEN** any panel is displayed in the grid
- **THEN** a small type badge (e.g. "metric", "chart") is visible on the card
