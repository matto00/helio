## ADDED Requirements

### Requirement: A server panel response never hides a still-pending staged edit

When a single-panel save response (a typed subtype save such as output controls, text, markdown, image, divider or
form content, or a title/appearance PATCH) or a batch save response replaces a panel in the client's panel list, the
client SHALL re-apply that panel's still-pending staged update on top of the server copy, using the same shallow
appearance merge used when the edit was staged. The staged update SHALL remain pending and SHALL be sent by the batch
flush exactly once; the subtype save request SHALL NOT carry staged title or appearance fields.

#### Scenario: Staged title survives an output-controls save in the same modal save
- **WHEN** the user edits a panel's title and its output controls in the panel detail modal and saves
- **THEN** the panel shows the new title immediately, after the output-controls save response arrives, and after
  the batch flush completes

#### Scenario: Staged appearance key survives a subtype save without losing stored keys
- **WHEN** a staged appearance patch changes only `background` and a subtype save response then replaces the panel
- **THEN** the panel shows the staged `background` and keeps every other appearance key from the server copy

#### Scenario: Staged fields are flushed exactly once
- **WHEN** the batch flush runs after a modal save that staged a title and saved output controls
- **THEN** exactly one batch request carries the staged title, the output-controls request carries no title or
  appearance, and no later flush re-sends the title

#### Scenario: A panel with nothing staged takes the server copy verbatim
- **WHEN** a subtype save response arrives for a panel with no pending staged update
- **THEN** the local panel equals the server copy
