## ADDED Requirements

### Requirement: Markdown Output Content is literal-only
The Output sheet SHALL offer a markdown Output's Content only as a literal multiline editor. It SHALL NOT offer a field/column-bound mode for Content, and SHALL NOT persist `fieldMapping.content` for a markdown Output.

#### Scenario: No bound mode is offered
- **WHEN** the user selects the Markdown kind in the Output sheet
- **THEN** the Content slot shows only a literal text editor, with no field/literal mode toggle and no column picker

#### Scenario: Saved config carries no mapping
- **WHEN** the user saves a markdown Output with literal content
- **THEN** the persisted config has `content` equal to the literal text and an empty `fieldMapping`

#### Scenario: Legacy mapping is not resurrected
- **WHEN** the sheet opens a markdown Output whose stored config contains `fieldMapping.content`
- **THEN** it opens in literal mode and the next save writes an empty `fieldMapping`

### Requirement: Slotless kinds reject fieldMapping with an explicit message
The Output create/update API SHALL reject a non-empty `fieldMapping` on a kind with no slots (`table`, `markdown`) with 400, and the message SHALL state that the kind has no fieldMapping slots.

#### Scenario: Agent sends a markdown content mapping
- **WHEN** a create or update supplies `fieldMapping: {content: "col"}` for a markdown Output
- **THEN** the response is 400 and the message says markdown has no fieldMapping slots
