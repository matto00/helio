## ADDED Requirements

### Requirement: get_output_history MCP tool

helio-mcp SHALL register a `get_output_history` tool taking `outputId` (required), `limit` (optional integer 1..100),
`since` (optional ISO-8601 instant) and `includeSummaries` (optional boolean, default false). It SHALL issue exactly
one `GET /api/outputs/:id/history` request, forwarding `limit`/`since` as query parameters only when supplied. It SHALL
return that route's response unchanged, except that when `includeSummaries` is not true each `points[]` entry omits
its `summary` field. The tool SHALL NOT compute baselines, deltas, percentages or values itself.

The tool description SHALL state that a value is non-null only for metric-kind Outputs. It SHALL state that a
`previous_run` baseline is the second-newest retained history point, which may be older than the immediately
preceding run because older history is thinned. The description SHALL NOT claim the baseline is the previous run.

#### Scenario: Last 30 values in one call

- **WHEN** an agent calls `get_output_history` with `outputId` of a metric Output that has at least 30 retained
  history points and `limit: 30`
- **THEN** exactly one HTTP request `GET /api/outputs/<id>/history?limit=30` is made
- **AND** the result carries 30 `sparkline` entries, each with `capturedAt` and a numeric `value`, and 30 `points`

#### Scenario: Optional parameters omitted

- **WHEN** `get_output_history` is called with only `outputId`
- **THEN** the request carries neither a `limit` nor a `since` query parameter (the backend default applies)

#### Scenario: Summaries trimmed by default

- **WHEN** `get_output_history` is called without `includeSummaries`
- **THEN** no returned `points[]` entry has a `summary` field, and every other response field is unchanged
- **WHEN** it is called with `includeSummaries: true`
- **THEN** each `points[]` entry carries the backend's `summary` unchanged

#### Scenario: Backend errors surface as tool errors

- **WHEN** the backend answers 400 (bad `limit`/`since`) or 404 (unknown or inaccessible Output)
- **THEN** the tool returns an `isError` result carrying the status and the backend message

#### Scenario: Description does not promise "previous run"

- **WHEN** the registered tool list is read
- **THEN** `get_output_history`'s description mentions that non-metric values are null and that history is thinned
- **AND** it does not contain the phrase "previous run"

### Requirement: compare is documented on every Output config write tool

The descriptions of `add_output`, `update_output`, `create_pipeline` and `propose_pipeline` SHALL document the optional
`config.compare` key. They SHALL list its accepted values (`previous_run`, `1d`, `7d`, `30d`, `custom:<ISO-8601
duration>`, or null for none) and state that the backend rejects anything else with a 400. `place_outputs` SHALL NOT
document or accept `compare`. The MCP layer SHALL NOT validate `compare` itself; `config` remains a pass-through record.

#### Scenario: Write tools document compare

- **WHEN** the registered tool list is read
- **THEN** the descriptions of `add_output`, `update_output`, `create_pipeline` and `propose_pipeline` each mention
  `compare` and `previous_run`
- **AND** `place_outputs`' description does not mention `compare`

#### Scenario: compare passes through unvalidated

- **WHEN** `add_output` is called with `config: {compare: "7d"}`
- **THEN** the create request body carries `config.compare` equal to `"7d"`, unchanged
