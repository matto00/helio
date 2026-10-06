## ADDED Requirements

### Requirement: Rows responses carry the full-filtered-set metric value for metric Outputs
`GET /api/outputs/:id/rows` and the public `GET /api/dashboards/:dashboardId/panels/:panelId/rows` SHALL include a
`metric` key when the Output's kind is `metric`, a row
filter is applied, and `offset` is `0`, and SHALL omit the `metric` key otherwise. When the Output's config resolves to a metric field, `metric` SHALL be
`{"field": string, "agg": string|null, "value": number|null}` and `value` SHALL be the metric computed
with the history summary's field-selection rule and aggregation semantics over EVERY row matching the filter, in
ascending row order regardless of any requested `sort`, independent of `limit`, or `null` when there is no finite value.
When the config resolves to no metric field, `metric` SHALL be present as `null`, matching the stored history
summary. The public route's behaviour here is the public-dashboards panel rows route, specified in this capability. The public response SHALL keep its existing `items`, `total`, `offset` and
`limit` keys unchanged; both responses SHALL be described by JSON Schemas that allow the optional `metric`.

#### Scenario: Filtered aggregate covers rows beyond the page
- **WHEN** a metric Output with `aggregation: {value: "amount", agg: "sum"}` has 500 rows matching the filter and the request is `offset=0&limit=200`
- **THEN** `metric.value` is the sum of `amount` over all 500 matching rows, and `items` still holds 200 rows

#### Scenario: Unfiltered or non-first page omits the metric
- **WHEN** the request has no filter, or `offset` is greater than `0`, or the Output kind is not `metric`
- **THEN** the response has no `metric` key

#### Scenario: Metric with no valid field
- **WHEN** a filtered request targets a metric Output whose config maps only `label`
- **THEN** the response has `"metric": null`

#### Scenario: Public route parity
- **WHEN** the same filtered request is made through the public panel rows route for a panel bound to that Output
- **THEN** the public response's `metric` object is identical to the authenticated route's, and its `items`/`total`/`offset`/`limit` keys are as before
