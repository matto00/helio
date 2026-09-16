## Purpose

Defines the frontend step-card editor for an `analyzewithai` pipeline step, whose central concern is an
ordered output-schema editor: the order the user sees is the order the backend receives and enforces.

## ADDED Requirements

### Requirement: The output schema editor is ordered, and display order is the emitted order

The editor SHALL present `outputSchema` as an ordered list of `{name, type}` rows with an explicit
affordance to reorder them, and SHALL emit the schema as a JSON ARRAY whose element order is exactly the
order displayed. It SHALL NOT emit the declared fields as a JSON object, whose key order the backend's
serializer does not preserve.

#### Scenario: Declared order is preserved on the wire
- **WHEN** a user declares fields `b` then `a` and the step is persisted
- **THEN** the persisted config's `outputSchema` is an array ordered `b`, `a`

#### Scenario: Reordering changes the emitted order
- **WHEN** a user moves the second declared field above the first
- **THEN** the persisted `outputSchema` array order reflects the new display order

#### Scenario: Analyze reports the declared columns in declared order
- **WHEN** a step with declared fields in a given order is analyzed
- **THEN** the step's reported output columns appear in that same declared order

### Requirement: Only model-producible types are offerable

Each declared field's `type` SHALL be chosen from exactly `string`, `integer`, `float` and `boolean`. The
editor SHALL NOT offer a type outside that set, since the backend rejects such a config with a named 422.

#### Scenario: The type control offers exactly four types
- **WHEN** a user opens a declared field's type control
- **THEN** the offered types are exactly `string`, `integer`, `float`, `boolean`

### Requirement: The declared schema is capped at the backend's supported entry count

The editor SHALL NOT allow more than 50 declared output fields, matching the backend's
`MaxOutputSchemaEntries`, and SHALL make the limit evident rather than allowing a 51st row to be added and
rejected on save.

#### Scenario: A 51st declared field cannot be added
- **WHEN** a step already declares 50 output fields
- **THEN** the editor does not allow a further field to be added, and states that the limit is reached

### Requirement: Declared-name problems are shown inline before saving

The editor SHALL surface, inline on the card, a declared name that is empty, duplicated, or equal to
`inputField`, and SHALL surface an empty declared schema — each of which the backend rejects — rather than
allowing the condition to surface only as a failed request.

#### Scenario: A duplicate declared name is flagged
- **WHEN** two declared fields are given the same name
- **THEN** the card shows an inline error naming the duplication

#### Scenario: A declared name colliding with the input field is flagged
- **WHEN** a declared field is named the same as `inputField`
- **THEN** the card shows an inline error naming the collision

#### Scenario: An empty declared schema is flagged
- **WHEN** a step has no declared output fields
- **THEN** the card shows an inline error stating at least one output field is required

### Requirement: The input field picker offers only string-bearing fields

The editor SHALL populate `inputField` from the analyze input schema restricted to `string` and
`string-body` fields, matching what the backend accepts, and SHALL start with no selection on a freshly
added step.

#### Scenario: Only string-bearing fields are offerable
- **WHEN** the input schema mixes string, content and numeric fields
- **THEN** only the `string` and `string-body` fields appear in the `inputField` picker

### Requirement: A persisted or agent-created step round-trips as an editable card

An `analyzewithai` step created through `add_pipeline_step` or already persisted SHALL render as a fully
editable card, not the unsupported-step notice, and a config authored through the card SHALL match the
shape documented for the op by `add_pipeline_step` for the same intent.

#### Scenario: An MCP-created step renders as an editable card
- **WHEN** the editor loads a pipeline containing an `analyzewithai` step created via `add_pipeline_step`
- **THEN** the card shows its input field, instruction and ordered declared schema, editable

#### Scenario: UI and agent authoring agree
- **WHEN** the same extraction intent is authored once through the card and once through
  `add_pipeline_step`
- **THEN** the two persisted configs are equal, including `outputSchema` element order
