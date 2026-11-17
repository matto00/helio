## ADDED Requirements

### Requirement: The step preview keeps its title on short narrow-desktop windows
On the narrow-desktop layout, where the live Output is a collapsible section under the centre column, the step preview
SHALL never be shorter than its title row: with the Output section open, the preview's title SHALL remain fully visible
inside the preview's box and the centre column at window heights down to 600px. When the column cannot fit the step
editor, the preview's title row and the open Output section, the step editor SHALL give way by scrolling inside itself
while its first input row stays fully visible. Header content that wraps below the title row MAY be clipped at those
heights, and the preview table body MAY shrink to zero rows.

#### Scenario: 900x600 with the Output section open
- **WHEN** a user opens a pipeline's detail page in a 900x600 window with a filter step selected and opens the Output
  section
- **THEN** the step preview's title is fully visible, and the filter editor's first condition row is fully visible
  inside the editor, in light and dark theme

#### Scenario: 900x700 with the Output section open
- **WHEN** the same page is shown in a 900x700 window with the Output section open
- **THEN** the step preview's title is fully visible and the step editor does not scroll inside itself (unchanged)
