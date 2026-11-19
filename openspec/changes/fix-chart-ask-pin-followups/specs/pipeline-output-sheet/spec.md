## ADDED Requirements

### Requirement: Chart preview fills its card
The Output editor's chart preview SHALL draw its chart at the full content height of its preview card (within 4px),
not a fixed smaller height, at desktop and phone widths and in light and dark themes.

#### Scenario: Desktop
- **WHEN** a chart Output with preview rows is open in the Output editor at a 1280px-wide viewport
- **THEN** the rendered chart's height equals the preview card's content height within 4px

#### Scenario: Phone
- **WHEN** the same Output editor is open at a 375px-wide viewport
- **THEN** the rendered chart's height equals the preview card's content height within 4px, and the editor's scroll
  extent remains bounded by its content
