## ADDED Requirements

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
