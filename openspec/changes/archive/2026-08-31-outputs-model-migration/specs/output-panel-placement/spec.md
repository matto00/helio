## Purpose

A dashboard Panel is a placement of an Output (or dashboard-native content); this
capability owns the placement's persisted shape and how it resolves to rendered
data.

## ADDED Requirements

### Requirement: Panel kind discriminates placement from content
The system SHALL persist `panels.kind` as one of `output | text | markdown |
image | divider`, non-null.

#### Scenario: Existing panels are backfilled from their prior type
- **WHEN** the migration backfills `panels.kind` for every existing panel from
  its prior `type` column
- **THEN** every panel ends up with a valid, non-null `kind`

### Requirement: An output panel references its Output
The system SHALL persist `panels.output_id`, nullable, `REFERENCES
outputs(id) ON DELETE CASCADE`, populated only for panels with `kind = output`.

#### Scenario: Deleting an Output cascades to its placements
- **WHEN** an Output with one or more placements is deleted
- **THEN** every panel referencing it via `output_id` is deleted

### Requirement: A previously-bound panel migrates to an output placement
The system SHALL, for every panel previously bound to a pipeline-output
DataType (directly, or via a metric), create an Output carrying the panel's
prior visualization config and set the panel's `kind = output` /
`output_id` to that Output.

#### Scenario: A metric-bound panel gains a tail step
- **WHEN** a migrated panel previously carried HEL-292 `aggregation` or a
  `metric_id`
- **THEN** the migration creates an aggregate (or groupBy+aggregate) tail step
  under the panel's pipeline's last trunk step, attaches the new Output there,
  and the metric's format carries into the Output's `config.format`

### Requirement: An unrecognized field-mapping slot is dropped and logged, not persisted
The system SHALL, while lifting a panel's `fieldMapping` into its Output's
`config`, drop any key that is not a valid slot for the Output's kind and log
the drop, rather than persisting or rejecting it.

#### Scenario: A panel with an invalid slot name migrates cleanly
- **WHEN** a panel's `fieldMapping` contains a key that is not a valid slot for
  its kind (e.g. `{"x","y"}` on a kind with no such slots)
- **THEN** the migration drops that key, logs it, and completes the panel's
  migration to an output placement using only its valid slots

### Requirement: Content panels retain their literal-content fields
A content panel (`kind ∈ {text, markdown, image, divider}`) SHALL continue to expose `content`
(markdown source or null), `imageUrl`/`imageFit` (image panels), and their existing divider
fields — these are unaffected by the retirement of DataType binding, since content panels never
carried a binding.

#### Scenario: Markdown content panel is unaffected
- **WHEN** a `kind = markdown` content panel is retrieved after this migration
- **THEN** its `content` field is unchanged from its pre-migration value

#### Scenario: Image panel fields are unaffected
- **WHEN** a `kind = image` panel is retrieved after this migration
- **THEN** its `imageUrl` and `imageFit` fields are unchanged from their pre-migration values
