## MODIFIED Requirements

### Requirement: create_data_source exposes the full declared-schema shape

The `create_data_source` tool SHALL accept optional per-column `required` (boolean) and `default`
(any JSON value) fields in its `columns` input, in addition to the existing `name`/`type`, and
SHALL forward them to the backend unchanged, EXCEPT that an explicit `default: null` on a column
is currently indistinguishable from omitting `default` entirely (both collapse to "no default")
due to `StaticColumnPayload`'s wire format — this limitation SHALL be stated in the tool's
description, along with the workaround of using `update_dataset_schema` after creation (which does
preserve the no-default-vs-explicit-null distinction) when that distinction matters. `rows` MAY be
an empty array, creating a dataset with zero rows and only its declared schema. This is the one
dataset-creation path — there is no separate `create_dataset` tool — since the backend already
declares `dataset_schema` from `columns` at creation time (`DataSourceService.createStatic`)
rather than merely inferring it.

#### Scenario: Agent creates an empty dataset with a fully declared schema

- **WHEN** an agent calls `create_data_source` with `columns` including `required`/`default` on
  one or more fields, and an empty `rows` array
- **THEN** the tool creates a `dataset` source with that declared schema and zero rows, returning
  the source id

#### Scenario: Explicit null default at creation is documented as indistinguishable from no default

- **WHEN** an agent reads `create_data_source`'s tool description
- **THEN** it states that an explicit `default: null` on a column is currently indistinguishable
  from omitting `default`, and that `update_dataset_schema` should be used instead if the
  distinction matters

### Requirement: append_dataset_rows and replace_dataset_rows MCP tools

The MCP server SHALL expose `append_dataset_rows` (`POST /api/data-sources/:id/rows`) and
`replace_dataset_rows` (`PUT /api/data-sources/:id/rows`), each accepting a `dataSourceId` and a
`rows` array where each row is a **positional array of values** matching the dataset's declared
column order — the same shape `create_data_source`'s own `rows` input already uses, never an
object keyed by column name. A row is validated positionally against the dataset's declared
schema: a row LONGER than the declared schema is rejected outright (row-length error). For a row
no longer than the schema, each position is checked independently — a position that is either
ABSENT (the row is shorter than the schema) OR EXPLICITLY `null` is treated identically as
"missing": it is filled from that field's declared `default` if one exists, or left `null` if the
field is optional with no default, and rejected ONLY if the field is `required` with no `default`.
A present, non-null value that doesn't satisfy the field's declared type is rejected as a type
mismatch. Any rejection (row-length, a declared type mismatch, or a missing/null required field
with no default) SHALL be returned to the agent verbatim (naming the offending row and field), not
swallowed into a generic error. The tool descriptions SHALL state this padding behavior — for both
short rows and explicit `null` positions — accurately, rather than imply every arity/type mismatch
is rejected.

#### Scenario: Agent appends validated rows

- **WHEN** an agent calls `append_dataset_rows` with rows matching the dataset's declared schema
- **THEN** the rows are appended and the tool returns the created rows' ids/seq values

#### Scenario: Short row is padded, not rejected

- **WHEN** an agent calls `append_dataset_rows` with a row shorter than the dataset's declared
  schema, and every field past the row's length is optional or has a declared `default`
- **THEN** the row is accepted; missing trailing fields are filled from their `default` (or `null`
  if optional with no default), not rejected for arity

#### Scenario: Explicit null in a row position is treated as missing, not rejected

- **WHEN** an agent calls `append_dataset_rows` with a row containing an explicit `null` at a
  position for a field that is optional or has a declared `default`
- **THEN** the value is filled from that field's `default` (or left `null` if optional with no
  default), not rejected as a type mismatch

#### Scenario: Schema-violating row is rejected verbatim

- **WHEN** an agent calls `append_dataset_rows` or `replace_dataset_rows` with a row that is longer
  than the declared schema, has a declared-type mismatch on a present non-null value, or has a
  `required` field missing/`null` with no `default`
- **THEN** the tool returns the backend's validation error naming the offending row and field,
  not a generic failure

## ADDED Requirements

### Requirement: Dataset tool descriptions enumerate valid column types

Every MCP tool description that accepts or documents a dataset column's `type` string
(`create_data_source`, `get_dataset_schema`, and `update_dataset_schema`) SHALL enumerate the
valid canonical values inline, sourced from a single `helio-mcp`-local constant that is kept in
sync with the backend's canonical `DataFieldType` wire values by an automated drift-guard check —
never a hand-copied literal with no guard against the backend adding, removing, or renaming a
type.

#### Scenario: Agent reads the valid column types from a tool description

- **WHEN** an agent reads `create_data_source`'s, `get_dataset_schema`'s, or
  `update_dataset_schema`'s tool description
- **THEN** the description names every currently-valid column `type` string, matching the
  backend's canonical set exactly
