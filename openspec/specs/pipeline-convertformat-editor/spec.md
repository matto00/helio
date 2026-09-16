# pipeline-convertformat-editor Specification

## Purpose
Defines the frontend step-card editor for a `convertformat` pipeline step: how the content field and the
format conversion are chosen, and how the in-place overwrite of the source field is disclosed.

## Requirements

### Requirement: The conversion is chosen as one supported pair, never as two free dropdowns

The step-card editor SHALL present the conversion as a single choice among exactly the four supported
conversions (`csv`->`json`, `json`->`csv`, `text`->`markdown`, `markdown`->`text`). It SHALL NOT offer
independent `from` and `to` controls that allow an unsupported pair (including `from == to`) to be
expressed, because such a pair is rejected by the backend with a named 422 at write time.

#### Scenario: Only supported conversions are offerable
- **WHEN** a user opens the conversion control on a `convertformat` step card
- **THEN** the offered choices are exactly the four supported conversions, and no combination of UI
  actions can produce a `from`/`to` pair outside that set

#### Scenario: A chosen conversion writes both keys together
- **WHEN** a user selects the `csv`->`json` conversion
- **THEN** the persisted config carries `from: "csv"` and `to: "json"` as a matched pair

### Requirement: An unsupported persisted pair is preserved, not silently coerced

A persisted step whose `from`/`to` pair is not one of the four supported conversions SHALL have that pair
preserved and shown as the card's current selection, and SHALL NOT be silently rewritten to a supported pair.

#### Scenario: A legacy unsupported pair survives being viewed
- **WHEN** the editor loads a `convertformat` step whose persisted pair is not one of the four
- **THEN** the card shows that pair as its current selection, and merely opening the card does not change it

### Requirement: The field picker offers only content fields and says so

The editor SHALL populate its `field` picker from the analyze input schema restricted to `string-body`
fields, consistent with the existing content-field ops, and SHALL start with no field selected when the
step's config has no `field` yet rather than auto-selecting the first available field.

#### Scenario: Non-content fields are not offerable
- **WHEN** the input schema contains both `string-body` and non-`string-body` fields
- **THEN** only the `string-body` fields appear in the `field` picker

#### Scenario: A freshly added step pre-selects no field
- **WHEN** a new `convertformat` step is added
- **THEN** the `field` picker shows no selection

### Requirement: Overwriting the source field in place is disclosed

Because an absent or empty `outputField` defaults to `field` and overwrites it in place, the editor SHALL
make that consequence visible when no distinct `outputField` is set, and SHALL allow naming a distinct
`outputField` to avoid it.

#### Scenario: Default destination is disclosed
- **WHEN** a `convertformat` step has a `field` selected and no distinct `outputField`
- **THEN** the card states that the converted value replaces that field's own content

#### Scenario: A distinct destination is accepted
- **WHEN** a user supplies an `outputField` different from `field`
- **THEN** the persisted config carries that `outputField` and the disclosure no longer claims in-place
  replacement

### Requirement: A persisted or agent-created step round-trips as an editable card

A `convertformat` step created through `add_pipeline_step` or already persisted SHALL render as a fully
editable step card, not the generic unsupported-step notice, and a config authored through the card SHALL
match the shape documented for the op by `add_pipeline_step` for the same intent.

#### Scenario: An MCP-created step renders as an editable card
- **WHEN** the editor loads a pipeline containing a `convertformat` step created via `add_pipeline_step`
- **THEN** the card shows the configured field, conversion and destination, editable like any other step

#### Scenario: UI and agent authoring agree
- **WHEN** the same conversion intent is authored once through the card and once through
  `add_pipeline_step`
- **THEN** the two persisted configs are equal
