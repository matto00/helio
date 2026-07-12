# text-panel-content-source Specification

## Purpose
Defines the Text panel's Source/Static content modes — binding a single field from a DataType versus authoring literal copy directly — and how bound content resolves over literal content at render time.
## Requirements
### Requirement: Text panel content can be sourced from a DataType or authored statically

A Text panel's config SHALL support two content modes: Source (content resolves from a bound DataType
field via `config.fieldMapping.content`) and Static (content is the literal `config.content` string,
today's behavior). Both modes SHALL be exposed through a single mode toggle in the panel detail modal's
Content editor.

#### Scenario: Static mode is the default for a panel with no binding
- **WHEN** the Content editor is opened for a Text panel with no `dataTypeId` set
- **THEN** the mode toggle shows "Static" selected and the existing content textarea is shown

#### Scenario: Source mode reveals a DataType picker and field select
- **WHEN** the user switches the Content editor's mode to "Source"
- **THEN** a DataType picker appears; selecting a DataType reveals a single field-select control for
  `content`

#### Scenario: Static mode hides the DataType picker
- **WHEN** the Content editor's mode is "Static"
- **THEN** no DataType picker or field-select control is rendered

### Requirement: Bound content takes precedence over literal content at render time

A Text panel SHALL display its resolved bound value (via `fieldMapping.content`) when one is available,
taking precedence over any literal `config.content`. When unbound (no `dataTypeId` or no
`fieldMapping.content`), the literal `config.content` SHALL be displayed unchanged from today's behavior.

#### Scenario: Bound panel renders the DataType field's value
- **WHEN** a Text panel has `dataTypeId` and `fieldMapping.content` set, and the bound DataType has rows
- **THEN** the panel renders the first row's mapped field value as its text

#### Scenario: Unbound panel renders its literal content exactly as before
- **WHEN** a Text panel has no `dataTypeId` set
- **THEN** the panel renders `config.content` exactly as it did before this change

#### Scenario: Bound panel with no data shows the existing no-data state
- **WHEN** a Text panel has `dataTypeId`/`fieldMapping.content` set but the bound DataType has no rows
- **THEN** the panel shows the existing "No data available" state, matching Metric/Chart/Table panels

### Requirement: Switching modes and saving persists the correct config shape

Saving the Content editor in Source mode SHALL PATCH `config.dataTypeId` and `config.fieldMapping.content`
and leave `config.content` unchanged. Saving in Static mode SHALL PATCH `config.content` and clear
`config.dataTypeId`/`config.fieldMapping` to unbound.

#### Scenario: Saving Source mode persists the binding
- **WHEN** the user selects a DataType, picks a field, and saves
- **THEN** `PATCH /api/panels/:id` is called with `config.dataTypeId` and `config.fieldMapping.content` set

#### Scenario: Saving Source mode never nulls the prior literal content
- **WHEN** a Text panel with an existing literal `config.content` is switched to Source mode, bound to a
  DataType and field, and saved
- **THEN** the `PATCH /api/panels/:id` request body omits the `content` key entirely (not `content: null`),
  and the panel's stored `config.content` is unchanged from before the save

#### Scenario: Saving Static mode clears any prior binding
- **WHEN** a previously-bound Text panel is switched to Static mode, given new literal text, and saved
- **THEN** `PATCH /api/panels/:id` is called with `config.dataTypeId` and `config.fieldMapping` cleared and
  `config.content` set to the new text

#### Scenario: Switching to Static preserves prior literal text if unedited
- **WHEN** a bound Text panel with a prior `config.content` value is switched to Static mode without
  editing the textarea, and saved
- **THEN** the prior `config.content` value is what's sent and rendered (no data loss)

