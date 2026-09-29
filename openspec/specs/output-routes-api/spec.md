# output-routes-api Specification

## Purpose
Expose the Output persistence model (HEL-904/outputs-model) over HTTP so a pipeline node's
visualization can be created, read, updated, deleted, and previewed independently of any panel
placement.

## Requirements

### Requirement: Output CRUD is scoped to a pipeline and ACL-checked
The backend SHALL expose `GET/POST /api/pipelines/:id/outputs` and `GET/PATCH/DELETE
/api/outputs/:id`. Every route SHALL apply the same owner/grantee/other ACL evaluation as the
parent pipeline: owner or a grantee with pipeline-sharing access gets 200; an UNAUTHENTICATED
caller (or one with no ACL relationship at all, on the sharing-aware GET routes) gets 404
(existence not leaked); an AUTHENTICATED caller with no pipeline grant on `POST
/api/pipelines/:id/outputs` gets **403** (`AccessChecker.requireAccess`'s standard rule,
identical to `PanelService.create`'s own dashboard-ACL check — this is a pre-existing,
codebase-wide convention, not a new rule invented for Outputs). `PATCH`/`DELETE
/api/outputs/:id` are owner-only (RLS `outputs_update`/`outputs_delete`) — a non-owner grantee
gets **404** there (RLS makes the row invisible to the update/delete statement, not a 403). `POST`
SHALL accept `{ nodeStepId?, kind, name, config }`; `nodeStepId` absent or null SHALL bind the
Output to the pipeline root. **`OutputResponse.nodeStepId` is `Option[String]`, serialized via
`jsonFormat10` on a protocol with no `NullOptions` mixed in anywhere in this backend — a
root-bound Output's response has the `nodeStepId` key OMITTED entirely, never present as a
literal `null`** (same class of wire-shape imprecision as the `pipeline-shape-registry` delta's
`expand` `outputs` key).

#### Scenario: Owner creates an Output at the pipeline root
- **WHEN** the pipeline's owner calls `POST /api/pipelines/:id/outputs` with no `nodeStepId`
- **THEN** the response is `201 Created` with the `nodeStepId` key OMITTED from the raw response
  JSON entirely (not present as `null`) — asserted against the raw parsed JSON object, not just
  the unmarshalled case class, since `resp.nodeStepId shouldBe None` cannot distinguish "key
  omitted" from "key present as null"

#### Scenario: Authenticated caller with no pipeline grant gets 403 on create
- **WHEN** an authenticated user with no ACL relationship to the pipeline calls
  `POST /api/pipelines/:id/outputs`
- **THEN** the response is `403 Forbidden` (the pipeline's existence is not hidden from an
  authenticated caller — matches `PanelService.create`'s dashboard-ACL convention)

#### Scenario: Non-owner grantee gets 404 on PATCH/DELETE
- **WHEN** an editor grantee (not the owner) calls `PATCH` or `DELETE /api/outputs/:id`
- **THEN** the response is `404 Not Found` (owner-only RLS makes the row invisible to the write,
  not a 403)

### Requirement: DELETE /api/outputs/:id cascades to panels and reports removed placements
The backend SHALL delete every panel placement referencing the Output before deleting the Output
row, in the same transaction, and SHALL return the count and ids of the panels removed.

#### Scenario: Deleting an Output removes its placements
- **WHEN** `DELETE /api/outputs/:id` is called for an Output placed on two dashboards
- **THEN** the response is `200 OK` with `{ removedPanelIds: [<id>, <id>] }` and both panels no
  longer exist

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
  `boolean`) — a malformed `ops` value degrades to "no match" for that clause, never a `500`.
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

### Requirement: GET /api/outputs/:id/panels lists placements
The backend SHALL expose `GET /api/outputs/:id/panels` returning every panel placement (id,
dashboardId, dashboardName) referencing the Output, for the delete-warning UI and the Output sheet.

#### Scenario: Output with no placements
- **WHEN** `GET /api/outputs/:id/panels` is called for an Output placed nowhere
- **THEN** the response is `200 OK` with `{ items: [] }`

### Requirement: GET /api/outputs/:id/assertion-status reports the node's last assertion outcome
The backend SHALL expose `GET /api/outputs/:id/assertion-status`, replacing
`GET /api/types/:id/assertion-status`, returning the last pipeline run's assertion outcome
(pass/fail/severity) for the Output's bound node.

#### Scenario: Node with a passing last run
- **WHEN** the Output's node's last run had no failing assertions
- **THEN** the response is `200 OK` with a passing assertion status

### Requirement: Lean paginated list endpoint for Outputs
The backend SHALL expose a paginated `GET /api/outputs?offset=&limit=` list endpoint scoped to
the OUTPUTS THE CALLER OWNS (`OutputRepository.findAllByOwner` — NOT sharing-aware, unlike
`GET /pipelines/:id/outputs`; a shared-but-not-owned Output does not appear here), returning
summary fields only (no full `schema`).

#### Scenario: Paginated Outputs list
- **WHEN** `GET /api/outputs?offset=0&limit=20` is called
- **THEN** the response is `200 OK` with at most 20 items owned by the caller and a total count

#### Scenario: A grantee-owned Output on a shared pipeline does not appear in another caller's list
- **WHEN** the caller owns pipeline P and has granted an editor a share on P, and the editor has
  created their OWN Output on P
- **THEN** `GET /api/outputs` for the pipeline owner does not include the editor's Output (it is
  visible via `GET /pipelines/:id/outputs`, but not via this owner-scoped list)

### Requirement: PATCH /api/outputs/:id partial-merges config, never replaces it
The backend SHALL expose `PATCH /api/outputs/:id` accepting any subset of `{ name, config }`,
owner-only-ACL-scoped like the other Output write routes. When `config` is provided, its fields SHALL
be merged into the existing `config` object rather than replacing it wholesale — a partial
`chart.legend` object merges into the stored `legend` rather than being rejected for missing
fields, and the same partial-merge behavior holds for `tooltip`, `seriesColors`, and `axisLabels`
(HEL-877 — checked here because Output config now carries what these used to live under on panel
`appearance`). Absent-vs-null `RequestValidation` normalization (HEL-362/HEL-623 idiom) applies:
an absent key leaves the existing value untouched, while an explicit `null` clears it.

#### Scenario: Partial chart.legend merges instead of being rejected
- **WHEN** `PATCH /api/outputs/:id` is called with `{ "config": { "chart": { "legend": { "position":
  "bottom" } } } }` on an Output whose existing `chart.legend` also has a `visible` field
- **THEN** the response is `200 OK`, the stored `legend.position` is `"bottom"`, and `legend.visible`
  is unchanged

#### Scenario: Same partial-merge holds for tooltip, seriesColors, and axisLabels
- **WHEN** `PATCH /api/outputs/:id` is called with a partial `tooltip`, `seriesColors`, or
  `axisLabels` object missing some of its existing sibling fields
- **THEN** the response is `200 OK` and only the provided fields are overwritten; siblings already
  present on the stored config are preserved

#### Scenario: Absent config leaves the Output unchanged
- **WHEN** `PATCH /api/outputs/:id` is called with `{ "name": "Renamed" }` and no `config` key
- **THEN** the Output's `config` is unchanged and only `name` is updated

### Requirement: Teardown-by-tag cascades to an Output's placements
Removing a tagged pipeline's Outputs via the teardown/tag-cascade path SHALL also remove any
dashboard placements referencing those Outputs.

#### Scenario: Tag-cascade delete removes placements along with outputs
- **WHEN** `teardown_resources` removes all resources under a tag that includes a pipeline with
  placed Outputs
- **THEN** both the pipeline's Outputs and the dashboard placements referencing them are removed

### Requirement: GET /api/outputs/:id/filter-capabilities reports per-column filter operators
The backend SHALL expose `GET /api/outputs/:id/filter-capabilities`, ACL-scoped identically to
`GET /api/outputs/:id/rows` (`outputRepo.findById`). For every column present in the Output's
declared `schema` with a Structured `DataFieldType`, the response SHALL list exactly the operators
`GET /api/outputs/:id/rows`'s `filter` will currently accept for that column: `contains` always;
`gte`/`lte` for `integer`/`float`/`timestamp` columns; `eq`/`in` only when the column's actual
distinct-value count in this Output's `node_snapshots` data is at or below the capability
contract's cardinality bound. A column absent from `schema`, or present with a Content-category
type, SHALL NOT appear in the response at all. Two Outputs sharing identical column types MAY
report different operators for the same column name when their underlying data's cardinality
differs — the contract SHALL be derived from the Output's own data, never from column type alone.

#### Scenario: A low-cardinality column reports eq and in
- **WHEN** an Output's `region` column (declared `string`) has 12 distinct values across all of
  its rows
- **THEN** the response lists `region` with operators including `contains`, `eq`, and `in`

#### Scenario: A high-cardinality column of the same declared type does not report eq or in
- **WHEN** a different Output's `notes` column (also declared `string`) has thousands of distinct
  values across its rows
- **THEN** the response lists `notes` with `contains` only — `eq`/`in` are absent

#### Scenario: A Content-category or undeclared column is omitted entirely
- **WHEN** the Output's `schema` includes a `string-body` column, or the underlying data has a
  field never declared in `schema`
- **THEN** that column does not appear anywhere in the response

#### Scenario: The contract and the rows endpoint never disagree
- **WHEN** the capability contract for an Output reports a given column as eq/in-eligible (or not)
- **THEN** `GET /api/outputs/:id/rows`'s `filter.ops` accepts (or rejects) `eq`/`in` on that exact
  column consistently with the contract, for the same Output at the same point in time

### Requirement: GET /api/outputs/:id/distinct-values returns capped, frequency-ordered values
The backend SHALL expose `GET /api/outputs/:id/distinct-values?column=`, ACL-scoped identically to
`GET /api/outputs/:id/rows`. The named `column` SHALL be rejected with a defined 400 naming the
column unless it is currently reported eq/in-eligible by `GET /api/outputs/:id/filter-capabilities`
for this same Output. On success, the response SHALL contain that column's distinct non-null
values across the Output's `node_snapshots` data, each paired with its occurrence count, ordered by
occurrence count descending, capped at the same bound `filter-capabilities` uses to decide eq/in
eligibility.

#### Scenario: Distinct values are capped and frequency-ordered
- **WHEN** `GET /api/outputs/:id/distinct-values?column=region` is called on an eq/in-eligible
  `region` column
- **THEN** the response's `values` list is ordered by descending occurrence count and contains at
  most as many entries as the capability contract's cardinality bound

#### Scenario: A column without eq/in eligibility is refused
- **WHEN** `GET /api/outputs/:id/distinct-values?column=notes` is called on a column the
  capability contract does not report as eq/in-eligible (high cardinality, Content-category, or
  absent from `schema`)
- **THEN** the response is `400 Bad Request` naming the column

#### Scenario: A hostile column name is rejected, not executed
- **WHEN** `GET /api/outputs/:id/distinct-values?column=` is called with a value containing SQL
  metacharacters (e.g. `'; DROP TABLE node_snapshots; --`)
- **THEN** the response is `400 Bad Request`, with no SQL error and no data leakage
