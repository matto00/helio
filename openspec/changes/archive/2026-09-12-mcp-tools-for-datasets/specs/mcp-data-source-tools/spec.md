## ADDED Requirements

### Requirement: create_data_source exposes the full declared-schema shape

The `create_data_source` tool SHALL accept optional per-column `required` (boolean) and `default`
(any JSON value) fields in its `columns` input, in addition to the existing `name`/`type`, and
SHALL forward them to the backend unchanged. `rows` MAY be an empty array, creating a dataset with
zero rows and only its declared schema. This is the one dataset-creation path — there is no
separate `create_dataset` tool — since the backend already declares `dataset_schema` from
`columns` at creation time (`DataSourceService.createStatic`) rather than merely inferring it.

#### Scenario: Agent creates an empty dataset with a fully declared schema

- **WHEN** an agent calls `create_data_source` with `columns` including `required`/`default` on
  one or more fields, and an empty `rows` array
- **THEN** the tool creates a `dataset` source with that declared schema and zero rows, returning
  the source id

### Requirement: append_dataset_rows and replace_dataset_rows MCP tools

The MCP server SHALL expose `append_dataset_rows` (`POST /api/data-sources/:id/rows`) and
`replace_dataset_rows` (`PUT /api/data-sources/:id/rows`), each accepting a `dataSourceId` and a
`rows` array where each row is a **positional array of values** matching the dataset's declared
column order — the same shape `create_data_source`'s own `rows` input already uses, never an
object keyed by column name. A row that fails validation against the dataset's declared schema
SHALL cause the backend's rejection (including which row and which field) to be returned to the
agent verbatim, not swallowed into a generic error.

#### Scenario: Agent appends validated rows

- **WHEN** an agent calls `append_dataset_rows` with rows matching the dataset's declared schema
- **THEN** the rows are appended and the tool returns the created rows' ids/seq values

#### Scenario: Schema-violating row is rejected verbatim

- **WHEN** an agent calls `append_dataset_rows` or `replace_dataset_rows` with a row that violates
  the dataset's declared schema (wrong type, missing required field)
- **THEN** the tool returns the backend's validation error naming the offending row and field,
  not a generic failure

### Requirement: get_dataset_rows MCP tool

The MCP server SHALL expose a `get_dataset_rows` tool wrapping the paged
`GET /api/data-sources/:id/rows` endpoint, accepting `dataSourceId`, optional `cursor` (opaque,
from a prior response's `nextCursor`) and `limit`, and returning each row's `id`, `seq`, `data`,
and `updatedAt`, plus the response's `nextCursor` (absent once the last page is reached) and
`total` row count, so an agent can page through a large dataset and address a specific row for a
later edit or delete.

#### Scenario: Agent reads back appended rows

- **WHEN** an agent calls `get_dataset_rows` after appending rows
- **THEN** the tool returns the rows with their `id`/`seq`/`updatedAt`, sufficient to target a
  specific row with `update_dataset_row` or `delete_dataset_row`

#### Scenario: Agent pages through a large dataset

- **WHEN** an agent calls `get_dataset_rows` and the response includes a `nextCursor`
- **THEN** passing that value back as `cursor` on the next call returns the next page, and a
  response with no `nextCursor` means every row has been returned

### Requirement: get_dataset_schema and update_dataset_schema MCP tools

The MCP server SHALL expose `get_dataset_schema` (`GET /api/data-sources/:id/schema`) and
`update_dataset_schema` (`PATCH /api/data-sources/:id/schema`, full-replacement), each accepting
`dataSourceId`. `update_dataset_schema` SHALL accept a `fields` array (name, `previousName`
optional — required to express a rename, since its absence is a drop of the old name plus an add
of the new one, not a rename), `type`, optional `required`, and an explicit-vs-absent `default`
(a field with no `default` key means "leave/no default"; a `default` key present with a JSON
`null` value means an explicit null default), plus a top-level `confirmDrop` boolean required to
drop a field that has existing data. The tool descriptions SHALL state that this is a full
replacement, not a merge: any currently-declared field omitted from `fields` is dropped. A `409`
conflict (structured as `{rejectedFields, message}`, one entry per rejected field) SHALL be
returned to the agent verbatim, and a successful update's `{fields, rowsMigrated}` response SHALL
also be returned as-is.

#### Scenario: Agent inspects a dataset's declared schema

- **WHEN** an agent calls `get_dataset_schema` with a dataset's id
- **THEN** the tool returns its current declared column schema

#### Scenario: Agent renames a field without dropping it

- **WHEN** an agent calls `update_dataset_schema` with a field whose `previousName` names an
  existing column and whose `name` is the new column name
- **THEN** the backend treats it as a rename, not a drop-and-add, and the tool returns the updated
  schema with `rowsMigrated` reflecting the backend's own accounting

#### Scenario: Destructive edit is rejected without confirmDrop

- **WHEN** an agent calls `update_dataset_schema` omitting a field that has existing data, without
  `confirmDrop: true`
- **THEN** the tool returns the backend's `409 {rejectedFields, message}` body verbatim, and does
  not retry with `confirmDrop` on the agent's behalf

### Requirement: update_dataset_row and delete_dataset_row MCP tools

The MCP server SHALL expose `update_dataset_row` (`PATCH /api/data-sources/:id/rows/:rowId`) and
`delete_dataset_row` (`DELETE /api/data-sources/:id/rows/:rowId`), each requiring `dataSourceId`,
`rowId`, and the row's current `updatedAt` value as an optimistic-concurrency precondition.
`update_dataset_row` sends `updatedAt` in its JSON body (matching `RowPatchRequest`) and
additionally requires `data` — the row's complete new value as a positional array matching the
declared column order (a full replacement, never a partial/sparse update). `delete_dataset_row`
sends `updatedAt` as a **query parameter**, not a body field (the backend's `DELETE` route reads
it from the query string, and a missing value is a `400`, not a `404`) — the MCP client's DELETE
transport SHALL support attaching a query string for this tool. A precondition mismatch (the row
changed since the caller last read it) SHALL be returned to the agent verbatim as a conflict, not
retried or silently overwritten.

#### Scenario: Agent edits a row it just read

- **WHEN** an agent calls `update_dataset_row` with the `updatedAt` value from a prior
  `get_dataset_rows` call
- **THEN** the row is updated and the tool returns its new `updatedAt`

#### Scenario: Stale precondition is rejected, not retried

- **WHEN** an agent calls `update_dataset_row` or `delete_dataset_row` with an `updatedAt` value
  that no longer matches the row (it was edited concurrently)
- **THEN** the tool returns the backend's precondition-conflict error verbatim, and does not retry
  or overwrite the newer value
