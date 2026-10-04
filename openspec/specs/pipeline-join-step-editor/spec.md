# pipeline-join-step-editor Specification

## Purpose
Make the `join` pipeline step authorable from the pipeline UI through a dedicated editor whose persisted config round-trips identically with backend and agent authoring.

## Requirements

### Requirement: Join is offered as an authorable step
The pipeline step catalog SHALL report the `join` kind as authorable, and the pipeline step palette SHALL
offer it to the user. Adding a join step from the palette SHALL succeed with the seed config
`{"secondaryInput": {"kind": "source", "dataSourceId": ""}, "joinKey": "", "joinType": "inner"}` and SHALL
NOT be rejected for its empty, not-yet-chosen right input.

#### Scenario: Catalog reports join authorable
- **WHEN** a client requests the pipeline step catalog
- **THEN** the `join` entry is reported authorable, and `groupby` is the only entry reported unauthorable

#### Scenario: Join appears in the palette and can be added
- **WHEN** a user opens the step palette on a pipeline and chooses "Join tables"
- **THEN** a join step is created with the seed config, and its card opens a join editor

### Requirement: Join editor configures right input, key and type
The join step editor SHALL let the user choose:
- the right-hand input, as either a data source or another lane of the same pipeline (the same choices
  offered by union and lookup)
- the join key, from the step's input schema fields
- the join type, from exactly the types the backend executes: `inner` and `left`

The editor SHALL describe what each join type does to unmatched rows.

#### Scenario: Choosing each control persists the change
- **WHEN** the user picks a right-hand data source, a join key `id`, and join type `left`
- **THEN** the step's persisted config is
  `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "joinKey": "id", "joinType": "left"}`

#### Scenario: Lane as the right-hand input
- **WHEN** the user picks another lane's step as the right-hand input
- **THEN** the persisted `secondaryInput` is `{"kind": "lane", "stepId": "<stepId>"}`

### Requirement: Persisted join config round-trips identically with backend and agent authoring
A join config written by the editor SHALL have exactly the keys `secondaryInput`, `joinKey`, and `joinType`,
with no legacy `rightDataSourceId`. The backend SHALL accept it, decode it, and return it unchanged on read.
Agent-facing documentation of the join config SHALL name the same keys. A shared fixture SHALL be read by
both client and server tests, so that a renamed or added key on either side fails a test.

#### Scenario: UI-authored config is accepted and returned unchanged
- **WHEN** the editor-authored join config is submitted as a step's config and the step is read back
- **THEN** the returned config equals the submitted config, key for key

#### Scenario: Seam drift is caught
- **WHEN** either side renames a join config key
- **THEN** the shared-fixture seam test fails

### Requirement: Stored values the editor cannot represent are shown, never silently replaced
Opening a join step whose stored config the editor's controls cannot express SHALL display the stored
value as-is, and SHALL NOT persist a change until the user edits the step. Cases include:
- a lane reference
- a `joinType` other than `inner`/`left`
- a `joinKey` absent from the current input schema

An unsupported `joinType` SHALL be visibly flagged as one that will fail at run time.

#### Scenario: Unknown join type is flagged, not coerced
- **WHEN** a join step stored with `joinType: "outer"` is opened
- **THEN** neither supported type is shown as selected, a notice names `outer` as unsupported, and the
  stored value is unchanged until the user picks a type

#### Scenario: Key missing from input schema remains visible
- **WHEN** a join step stored with `joinKey: "legacy_id"` is opened and the input schema has no
  `legacy_id`
- **THEN** the key selector still shows `legacy_id` as the current selection

### Requirement: A UI-built join executes with real rows
A join built entirely through the UI SHALL run, and SHALL produce joined output rows. Right-side columns
that collide with left columns SHALL use the existing `right_<name>` naming.

#### Scenario: Inner join of two sources through the UI
- **WHEN** a user builds a pipeline on source A, adds a join step choosing source B, key `id`, type `inner`,
  and runs it
- **THEN** the output contains one row per matching `id` pair, carrying A's columns, B's non-key columns,
  and `right_<name>` for colliding names
