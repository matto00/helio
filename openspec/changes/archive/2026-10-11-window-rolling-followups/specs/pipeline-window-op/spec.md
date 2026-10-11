## ADDED Requirements

### Requirement: Window step editor input ids are unique per editor instance

Every labelled input in the window step editor (offset, frame size, output column) SHALL use an id unique to that editor instance, so that when two or more window step editors are rendered at once no DOM id is duplicated and each label's accessible name resolves to the input in its own editor.

#### Scenario: Two window editors open at once
- **GIVEN** two window step editors are rendered on the same page with the same function (both `lag`/`lead`, so offset shows; or both `rolling_*`, so frame size shows), each also showing its output-column input
- **WHEN** the DOM ids of their inputs are collected
- **THEN** no id appears more than once
- **AND** each label's `htmlFor` targets the input inside the same editor
