## MODIFIED Requirements

### Requirement: GET /api/outputs/:id/rows returns paginated data rows
The backend SHALL expose `GET /api/outputs/:id/rows?offset=&limit=&sort=&filter=`, replacing
`GET /api/types/:id/rows`, returning the Output's node's materialized row snapshot
(`node_snapshots`), offset/limit paginated (mirroring `Page`/`PagedResult`'s existing convention
used by `GET /api/dashboards`/`GET /api/panels` — NOT a `page`/`pageSize` scheme). ACL is the same
sharing-aware `outputRepo.findById` select `GET /api/outputs/:id` uses.

`sort` is `<column>:<asc|desc>`. A column SHALL be treated as server-sortable only when it is
present in the Output's own declared `schema` (`OutputResponse.schema`) with a Structured
`DataFieldType` (`string`, `integer`, `float`, `boolean`, `timestamp`) — never inferred from
sampled row data. Ordering SHALL always include `row_index ASC` as a trailing tiebreaker,
regardless of the requested `sort`, so repeated paginated requests against an unchanged
sort/filter never duplicate or drop rows across pages. A numeric/timestamp cast failure on an
individual row's value (a malformed value in an otherwise correctly-typed column) SHALL sort that
row's key as `NULL` (last) rather than fail the request.

`filter` is a URL-encoded JSON object `{"quick"?: string, "columns"?: {[column]: string}, "ops"?:
[{"column": string, "op": "eq"|"in"|"gte"|"lte", "value"?: string, "values"?: string[]}]}`.
`quick`/`columns` retain HEL-1027's unchanged case-insensitive substring ("contains") semantics: a
`quick` term matches when ANY Structured-category column's value contains it; each `columns` entry
matches only its own column. `ops` entries add range/equality/list-membership matching:

- `eq` requires `value` (a single string); `in` requires `values` (1-100 strings; more than 100
  is a defined 400 naming the column); `gte`/`lte` require `value` and apply only to `integer`,
  `float`, or `timestamp` columns.
- Every `ops` value is compared using the same value-typed cast the column itself uses
  (`safe_numeric`/`safe_timestamptz` for numeric/timestamp columns, plain text for `string`/
  `boolean`) — a malformed `ops` value degrades to "no match" for that clause, never a `500`. Exception: an `eq`
  whose `value` is the empty string SHALL match every row whose cell is null or the empty string, whatever the
  column's cast (the "blank" rule shared with the filter step).
- `eq`/`in` on a given column SHALL be accepted only when that column is currently reported
  eq/in-eligible by `GET /api/outputs/:id/filter-capabilities` (see below) — a column whose actual
  distinct-value count in this Output's data exceeds the capability contract's cardinality bound
  is rejected as a defined 400 naming the column and operator, even though the column's TYPE would
  otherwise make `eq`/`in` structurally valid. This is the mechanism that keeps the rows endpoint
  and the capability contract from drifting apart: both resolve eligibility through the same
  underlying check.
- Multiple `ops` entries MAY target the same column (e.g. `gte` and `lte` together express a
  range) and are ANDed together, and with every active `quick`/`columns` term. Two entries naming
  the same column AND the same operator are rejected as a defined 400 (ambiguous).
- A `columns` entry or an `ops` entry naming a column that is not server-sortable-eligible (not in
  `schema`, or in the Content category) SHALL be rejected — see the error requirement below; the
  `quick` term is exempt from this rejection and silently excludes Content-category columns from
  its own match instead.

When `filter` is present and non-empty, the response's `total` SHALL be the count of rows matching
the filter (not the Output's raw row count) — the same value used to derive `hasMore` client-side.
When `filter` is absent, `total` is the Output's raw row count, unchanged from prior behavior.

#### Scenario: First page of rows
- **WHEN** `GET /api/outputs/:id/rows` is called with no query params on an Output with rows
- **THEN** the response is `200 OK` with the first page of rows using the endpoint's default
  offset (`0`) and limit (`200`)

#### Scenario: Negative offset is rejected
- **WHEN** `GET /api/outputs/:id/rows?offset=-1` is called
- **THEN** the response is `400 Bad Request`

#### Scenario: Sort ranks the whole Output, not one page
- **WHEN** `GET /api/outputs/:id/rows?sort=revenue:desc&limit=50` is called on an Output with more
  than 50 rows, where `revenue` is declared `integer` in the Output's `schema`
- **THEN** the response's 50 rows are the 50 HIGHEST `revenue` values across the ENTIRE Output, not
  merely the highest among the first 50 rows by `row_index`

#### Scenario: Sort is stable across pages
- **WHEN** two consecutive requests are made with the same `sort` and increasing `offset`, against
  an Output whose sort column has duplicate values
- **THEN** no row appears in both pages and no row is skipped

#### Scenario: Sorting on a non-declared or Content-category column is rejected
- **WHEN** `sort=<column>:asc` names a column absent from the Output's `schema`, or present with a
  Content-category type (`string-body`, `binary-ref`)
- **THEN** the response is `400 Bad Request` naming the offending column, and no rows are returned

#### Scenario: A malformed value in a numeric column does not fail the whole request
- **WHEN** `sort=quantity:asc` is requested and `quantity` is declared `integer`, but one row's
  `quantity` value is a non-numeric string
- **THEN** the response is `200 OK`; that row sorts after every row with a valid numeric value

#### Scenario: A calendar-invalid value in a timestamp column does not fail the whole request
- **WHEN** `sort=signup_date:asc` is requested and `signup_date` is declared `timestamp`, but one
  row's value is digit-shaped like a recognized format while being calendar-invalid (e.g.
  `2024-02-30`, a non-existent February 30th)
- **THEN** the response is `200 OK`; that row sorts after every row with a valid timestamp value —
  it never produces a `500` (a digit-shaped-but-calendar-invalid value is a distinct failure mode
  from a value that fails to match any recognized format shape at all, and both SHALL degrade to
  the same "sorts last" behavior, never an error)

#### Scenario: Filter narrows the whole Output, not one page
- **WHEN** `GET /api/outputs/:id/rows?filter=%7B%22quick%22%3A%22acme%22%7D&limit=50` (quick
  term `"acme"`) is called on an Output with more than 50 matching rows spread beyond the first 50
  by `row_index`
- **THEN** every returned row's rendered columns contain `"acme"` (case-insensitive), regardless of
  each matching row's position in the Output

#### Scenario: Range filter narrows the whole Output on a date column
- **WHEN** a `filter` with `ops: [{"column": "signup_date", "op": "gte", "value": "2026-01-01"},
  {"column": "signup_date", "op": "lte", "value": "2026-01-31"}]` is applied on an Output larger
  than one page, where `signup_date` is declared `timestamp`
- **THEN** every returned row's `signup_date` falls within the requested range, regardless of each
  matching row's position in the Output, and `total`/`hasMore` describe the filtered set

#### Scenario: In-list filter narrows the whole Output on a text column
- **WHEN** a `filter` with `ops: [{"column": "region", "op": "in", "values": ["US", "EU"]}]` is
  applied on an Output larger than one page, where `region` is declared `string` and is currently
  eq/in-eligible
- **THEN** every returned row's `region` is exactly `"US"` or `"EU"`, regardless of each matching
  row's position in the Output, and `total`/`hasMore` describe the filtered set

#### Scenario: eq/in on a column the capability contract does not currently allow is rejected
- **WHEN** a `filter` with an `eq` or `in` op names a column whose actual distinct-value count in
  this Output's data exceeds the capability contract's cardinality bound
- **THEN** the response is `400 Bad Request` naming the offending column and operator, even though
  the column's declared type would otherwise make the operator structurally valid

#### Scenario: gte/lte on a non-numeric, non-timestamp column is rejected
- **WHEN** a `filter` op `gte` or `lte` names a column declared `string` or `boolean`
- **THEN** the response is `400 Bad Request` naming the offending column and operator

#### Scenario: More than 100 in-list values is rejected
- **WHEN** a `filter` op `in` supplies more than 100 `values`
- **THEN** the response is `400 Bad Request` naming the offending column

#### Scenario: A malformed range/equality value does not fail the whole request
- **WHEN** a `filter` op `gte`/`lte`/`eq` on a numeric or timestamp column supplies a value that
  fails to parse under that column's cast
- **THEN** the response is `200 OK` with zero rows matching that clause (never a `500`)

#### Scenario: A malformed element inside an in-list does not fail the request or the other elements
- **WHEN** a `filter` op `in` on a numeric or timestamp column supplies `values` where one element
  fails to parse under that column's cast and the others are valid
- **THEN** the response is `200 OK`; rows matching a valid element are still returned, the
  malformed element matches no row, and the request never produces a `500`

#### Scenario: Filtered total drives hasMore
- **WHEN** a filter matches fewer rows than fit in one page
- **THEN** the response's `total` equals the matched row count and the client-computed `hasMore`
  (`offset + limit < total`) is `false`

#### Scenario: Filtering on a non-eligible column is rejected
- **WHEN** `filter=%7B%22columns%22%3A%7B%22notes%22%3A%22x%22%7D%7D` names a column
  (`notes`) that is Content-category or absent from `schema`
- **THEN** the response is `400 Bad Request` naming the offending column

#### Scenario: A zero-match filter on a populated Output reports `materialized: true`
- **WHEN** a filter is applied that legitimately matches zero rows of an Output whose underlying
  node has genuinely produced data (a specific-enough filter term, not a malformed one)
- **THEN** the response's `materialized` field is `true` and `items` is empty — this is
  distinguishable from, and SHALL NOT be reported the same as, an Output whose node has never
  produced any data at all (`materialized: false`); the filtered `total` being `0` SHALL NOT, by
  itself, ever be treated as evidence that the Output was never materialized

#### Scenario: A hostile column name is rejected, not executed
- **WHEN** `sort`, a `filter.columns` key, or a `filter.ops[].column` names a value containing SQL
  metacharacters (e.g. `'; DROP TABLE node_snapshots; --`)
- **THEN** the response is `400 Bad Request` (treated as an unrecognized/non-eligible column name)
  with no SQL error and no effect on any table

#### Scenario: eq with an empty value matches null and empty cells
- **WHEN** an Output's rows hold `team` = null, `""`, and `"red"` and are read with `ops: [{"column":"team","op":"eq","value":""}]`
- **THEN** the null and `""` rows are returned and the `"red"` row is not
