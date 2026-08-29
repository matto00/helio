## MODIFIED Requirements

### Requirement: fetch returns normalized JsObject rows
`fetch(config, maxRows, resolveContext)` SHALL return a `FetchOutcome` carrying a `Vector[JsValue]`
where each element is the JsObject shape already consumed by `SchemaInferenceEngine` and
`SourceService` (one JsObject per row), bounded by `maxRows`, together with whether the read was
truncated by `maxRows` and, when the implementation actually observed it, the number of rows
available before truncation.

`FetchOutcome.truncated` and `FetchOutcome.availableRowCount` SHALL be independent: an
implementation that can prove truncation without observing a total SHALL report
`truncated = true` with `availableRowCount = None`. An implementation SHALL NOT derive
`availableRowCount` from a saturation heuristic.

An implementation SHALL report `truncated = false` when the number of available rows equals
`maxRows` exactly — reaching the bound is not evidence that rows were discarded.

#### Scenario: SQL fetch row shape matches SourceService's existing row shape
- **WHEN** `SqlConnectorDriver.fetch(config, maxRows, resolveContext)` succeeds
- **THEN** the returned `FetchOutcome.rows` elements are `JsObject`s equivalent to
  `SqlConnectorDriver.toRows(SqlConnectorDriver.execute(config, maxRows))`

#### Scenario: REST fetch row shape matches SourceService's existing row shape
- **WHEN** `RestApiConnectorDriver.fetch(config, maxRows, resolveContext)` succeeds
- **THEN** the returned `FetchOutcome.rows` elements are equivalent to
  `RestApiConnectorDriver.toRows(RestApiConnectorDriver.fetch(config))`, truncated to `maxRows`

#### Scenario: REST fetch reports an exact available-row count
- **WHEN** `RestApiConnectorDriver.fetch` parses a body into more rows than `maxRows`
- **THEN** `FetchOutcome.availableRowCount` is the parsed row count and `FetchOutcome.truncated` is `true`

#### Scenario: SQL fetch reports truncation without a total
- **WHEN** `SqlConnectorDriver.fetch` finds more than `maxRows` rows available
- **THEN** `FetchOutcome.truncated` is `true`, `FetchOutcome.availableRowCount` is `None`, and
  `FetchOutcome.rows` has exactly `maxRows` elements
