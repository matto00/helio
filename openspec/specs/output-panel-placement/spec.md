# output-panel-placement Specification

## Purpose
A dashboard Panel is a placement of an Output (or dashboard-native content); this
capability owns the placement's persisted shape and how it resolves to rendered
data.

## Requirements

### Requirement: Panel kind discriminates placement from content
The system SHALL persist `panels.kind` as one of `output | text | markdown |
image | divider | form`, non-null.

`form` joins the set in the form-panel change. It is neither a placement of an Output nor
purely dashboard-native content: it binds to a `dataset` data source and writes to it. The
prior placement-versus-content dichotomy therefore gains a third category, and a consumer
MUST NOT infer "carries no binding" from "is not `output`" — `form` carries a source binding.
The database CHECK constraint on `panels.kind` SHALL admit `form`; without that widening a
`form` panel cannot be inserted at all.

#### Scenario: Existing panels are backfilled from their prior type
- **WHEN** the migration backfills `panels.kind` for every existing panel from
  its prior `type` column
- **THEN** every panel ends up with a valid, non-null `kind`

#### Scenario: A form panel persists its kind
- **WHEN** a `form` panel is created
- **THEN** its row persists `kind = 'form'` and the kind CHECK constraint admits it

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

### Requirement: Placement creation accepts a batch of Outputs in one call
The placement-creation path underlying `place_outputs` SHALL accept an array of
`{outputId, title?, w?, h?}` entries and create one panel placement per entry.

#### Scenario: Batch placement creates multiple panels from one call
- **WHEN** `place_outputs` is called with three `{outputId}` entries for the same dashboard
- **THEN** three panels are created, each placing the corresponding Output

### Requirement: An output panel persists an ordered list of controls
The system SHALL persist, for panels with `kind = output`, an ordered `controls` list (a new
`output_controls` JSONB column, separate from the existing `output_id` column) alongside the
placement's `outputId`. Each entry SHALL carry `id` (client-generated at add time, stable across
reorders and edits — the server accepts and persists it as given, never minting or rewriting it),
`kind` (one of `date-range`, `dropdown`, `numeric-range`, `text`), `column` (the bound Output
schema column name), `label`, and an optional `defaultValue` whose JSON shape is fixed per `kind`:
a single string for `text`/`dropdown`; `{"min", "max"}` (each nullable) for `numeric-range`;
`{"from", "to"}` (each nullable, ISO-8601 date strings) for `date-range`. Absent or empty,
`controls` decodes to an empty list — an output panel with no controls is unaffected by this
change.

#### Scenario: A control is persisted on the panel
- **WHEN** an author adds a `date-range` control bound to column `created_at` with label
  "Date"
- **THEN** the panel's `controls` list gains one entry with that `kind`, `column`, `label`, and the
  client-generated `id` submitted with it, persisted verbatim

#### Scenario: A panel with no controls is unaffected
- **WHEN** an existing `output` panel with no `controls` field is read after this change ships
- **THEN** its `controls` decodes to an empty list, and every other field is unchanged

### Requirement: A control that is added, rebound, or has its kind changed must be eligible per the Output's filter capability contract
The system SHALL reject, with a defined `400 Bad Request` naming the offending control's `column`
and `kind`, any create, or any update whose `controls` entry is new (no matching persisted `id`) or
whose `column`/`kind` differs from the matching persisted entry, when that entry binds to a
column/kind combination that HEL-1188's `GET /api/outputs/:id/filter-capabilities` contract does
not allow for this Output at the time of the write. Eligibility per kind SHALL be derived from the
contract's reported operators for that column, paired with the Output's own declared schema type
to distinguish a `date-range`-eligible column (`timestamp`, contract reports `gte`+`lte`) from a
`numeric-range`-eligible one (`integer`/`float`, contract reports `gte`+`lte`): `date-range`
requires a `timestamp` column with `gte`+`lte`; `numeric-range` requires an `integer`/`float`
column with `gte`+`lte`; `dropdown` requires the column report `eq`+`in` (any type); `text`
requires the column report `contains`. An update entry whose `id`, `column`, and `kind` are
unchanged from the matching persisted entry (only `label`/`defaultValue` edited, or the entry is
untouched) SHALL NOT be re-validated by this check, regardless of its current eligibility — see the
drift requirement below for how such an entry is instead surfaced.

#### Scenario: A control bound to a non-eligible column is rejected
- **WHEN** a `dropdown` control is submitted bound to a column the capability contract does not
  report as `eq`/`in`-eligible for this Output
- **THEN** the write is rejected with `400 Bad Request` naming the column and `dropdown`

#### Scenario: Rebinding a control to a non-eligible column is rejected
- **WHEN** an author rebinds an existing control's `column` to one the capability contract does not
  report as eligible for that control's `kind`
- **THEN** the write is rejected with `400 Bad Request` naming the column and `kind`

#### Scenario: An untouched, already-orphaned control does not block an unrelated save
- **WHEN** a control was valid when added, the Output's underlying data cardinality has since
  crossed the eq/in cardinality bound making it ineligible, and the panel is saved again with that
  control's `id`/`column`/`kind` unchanged (e.g. the author edits a different control, the title,
  or appearance)
- **THEN** the save succeeds — the drifted control is not re-validated by this write and is
  reported as orphaned per the drift requirement below, not rejected

#### Scenario: Two Outputs with identical column types produce different offered controls
- **WHEN** two Outputs both declare a `string` column with the same name, but one has low
  cardinality (eq/in-eligible) and the other does not
- **THEN** a `dropdown` control is accepted for the first Output's column and rejected for the
  second's

### Requirement: A bound column that no longer exists or no longer fits its control's kind is a defined, visible drift state
The system SHALL, when a control's bound `column` is absent from the Output's current declared
schema, or present but no longer eligible for that control's `kind` per the current capability
contract, mark that control as orphaned rather than silently dropping it, erroring the whole
panel read, or applying it to the read as if still valid. An orphaned control SHALL remain present
in the persisted `controls` list (so its configuration is not lost) and SHALL be reported as
orphaned wherever the panel's controls are read.

#### Scenario: A bound column is removed from the Output's schema
- **WHEN** the Output's schema changes such that a control's bound `column` no longer appears
- **THEN** the control is retained in `controls`, reported as orphaned, and not treated as eligible
  for use

#### Scenario: A bound column changes type such that it no longer fits its control's kind
- **WHEN** a `date-range` control's bound column is redeclared as `string` (no longer `timestamp`)
- **THEN** the control is retained and reported as orphaned rather than silently coerced to a
  different kind or applied as a text filter

### Requirement: Malformed, duplicate, or misplaced controls are rejected with a 400
Every write path that stores an output panel's `config.controls` SHALL reject a malformed controls payload (a non-array `controls`, a non-object element, or an element missing or mistyping a required attribute), a controls list containing two entries with the same `id`, and any `config.controls` key supplied for a non-output panel (including an empty array), with an HTTP 4xx (400) and a message naming the problem. It SHALL NOT return 500 and SHALL NOT silently ignore or drop the supplied controls.

#### Scenario: Malformed controls on PATCH
- **WHEN** `PATCH /api/panels/:id` is sent with `config.controls` that is not an array, contains a non-object element, or an element missing `id`
- **THEN** the response is 400 with the decoder's message and nothing is persisted

#### Scenario: Duplicate control ids
- **WHEN** a write supplies two controls with the same `id`
- **THEN** the response is 400 naming the duplicate id and nothing is persisted

#### Scenario: Controls on a non-output panel
- **WHEN** `PATCH /api/panels/:id` targets a non-output panel and carries a `config.controls` key (including an empty array)
- **THEN** the response is 400 stating controls are only supported on an output panel

#### Scenario: Non-array or malformed controls on create, batch create, import, contents replace and proposal apply
- **WHEN** `POST /api/panels`, `POST /api/panels/batch`, `POST /api/dashboards/import`, `PUT /api/dashboards/:id/contents` or `POST /api/dashboards/apply-proposal` carries an output panel whose `config.controls` is not an array
- **THEN** the response is 400 stating `controls must be an array` and no panel is created or replaced

#### Scenario: Batch PATCH rejects the same inputs
- **WHEN** `POST /api/panels/updateBatch` carries an item whose `config.controls` is malformed, contains a duplicate id, or targets a non-output panel
- **THEN** the response is 400 naming the offending panel id and nothing is persisted for any item

#### Scenario: Duplicate ids and misplaced controls on every create-side path
- **WHEN** create, batch create, import, contents replace or proposal apply supplies a duplicate control id, or a `config.controls` key on a non-output panel
- **THEN** the response is 400 naming the duplicate id, or stating controls are only supported on an output panel
