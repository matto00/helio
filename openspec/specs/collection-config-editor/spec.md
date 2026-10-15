# collection-config-editor Specification

## Purpose
Defines how the Output editor sheet edits a collection-kind Output: the item field-mapping slots, the format and conditional-format controls, the grid layout written on create, and which config keys an edit sends.

## Requirements

### Requirement: The Output editor sheet presents collection fields
For a `collection` Output the Output editor sheet SHALL present three item field-mapping slots (`value`, `label`,
`unit`, each a column select), a `Format` select (options `number`, `integer`, `currency`, `percent`, `duration`, `durationMs`, labelled Number, Integer, Currency ($), Percent (%), Duration, Duration (ms)), and the
conditional-formats rules editor. It SHALL NOT present a base-type or layout control. Creating a collection Output SHALL
write `layout: "grid"`.

#### Scenario: Collection kind shows item fields, format and conditional formats
- **WHEN** the Output editor sheet is open with kind `Collection`
- **THEN** it shows the Value, Label and Unit item field selects, a Format select and the conditional formats editor, and no layout or base-type control

#### Scenario: A new collection Output is created with the grid layout
- **WHEN** the user chooses kind Collection in a new Output and saves
- **THEN** the create request's `config.layout` is `"grid"`

### Requirement: Editing a collection Output sends only the changed config keys
Edit-mode Save of a collection Output SHALL send one `PATCH /api/outputs/:id` whose `config` carries only the keys the
user changed (an explicit `null` clears a key), because the server shallow-merges `config`. A stored `layout` the sheet
has no control for SHALL therefore survive an edit.

#### Scenario: Format change patches only format
- **WHEN** the user opens a collection Output stored with `layout: "list"`, changes only the Format, and saves
- **THEN** the PATCH `config` is `{ format: "<chosen>" }` and the stored `layout` remains `"list"`
