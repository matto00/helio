## MODIFIED Requirements

### Requirement: PATCH /api/outputs/:id partial-merges config, never replaces it
The backend SHALL expose `PATCH /api/outputs/:id` accepting any subset of `{ name, config }`,
owner-only-ACL-scoped like the other Output write routes. When `config` is provided, its top-level fields SHALL
be merged into the existing `config` object rather than replacing it wholesale: a top-level key present in the patch
replaces that key's stored value, and every stored top-level key absent from the patch is kept unchanged. No
top-level key is deep-merged (HEL-1313: the former one-level deep merge of `legend`, `tooltip`, `seriesColors` and
`axisLabels` is removed; no renderer reads those keys, and they are now unknown config keys). Absent-vs-null
`RequestValidation` normalization (HEL-362/HEL-623 idiom) applies: an absent key leaves the existing value untouched,
while an explicit `null` clears it.

#### Scenario: A patch replaces only the keys it names
- **WHEN** `PATCH /api/outputs/:id` is called with `{ "config": { "compare": "7d" } }` on a chart Output whose stored
  config also has `chartType` and `fieldMapping`
- **THEN** the response is `200 OK`, the stored `compare` is `"7d"`, and `chartType` and `fieldMapping` are unchanged

#### Scenario: Partial chart.legend merges instead of being rejected
- **WHEN** (superseded by HEL-1313) `PATCH /api/outputs/:id` is called with a `legend` config key that is not already
  stored with that exact value
- **THEN** the response is `400` naming `legend` as an unknown config key (no renderer reads it; chart styling lives on
  the panel's `appearance.chart`), and the stored config is unchanged

#### Scenario: Same partial-merge holds for tooltip, seriesColors, and axisLabels
- **WHEN** (superseded by HEL-1313) a patch sends `tooltip`, `seriesColors` or `axisLabels` with a value different from
  the stored one
- **THEN** the response is `400` naming the key, exactly as for `legend`; re-sending a stored value unchanged is
  accepted and leaves it stored as-is (no deep merge)

#### Scenario: Absent config leaves the Output unchanged
- **WHEN** `PATCH /api/outputs/:id` is called with `{ "name": "Renamed" }` and no `config` key
- **THEN** the Output's `config` is unchanged and only `name` is updated

## ADDED Requirements

### Requirement: Output config writes reject unknown keys per kind
Every write that persists an Output's `config` (Output create, Output update, single-call pipeline creation, the
grounding of a pipeline proposal's Outputs, and the patch-set preview and apply of an Output update) SHALL accept only
top-level keys in the Output kind's known-key set. Every kind SHALL accept `fieldMapping`, `compare` and
`historyPayloads`; additionally chart SHALL accept `chartType`, `aggregation`, `chartOptions`, `annotation`; metric
SHALL accept `aggregation`, `label`, `unit`, `format`; table SHALL accept `columnOrder`, `columnFormats`, `columnSort`,
`columnFilters`, `pinnedColumns`; collection SHALL accept `layout`, `format`; timeline SHALL accept `sort`; markdown
SHALL accept `content`. A write that introduces a key outside that set, or changes the stored value of one, SHALL be
rejected with 400 whose message names every offending key and, where one exists, a did-you-mean suggestion; nothing
SHALL be persisted. On an update, an unknown key whose value equals the value already stored under that key SHALL be
accepted unchanged, and writing `null` to an unknown key that is currently stored SHALL be accepted and store JSON `null` under it, so
stored legacy keys never block an update or a read-modify-write round trip. Restoring an Output's journaled prior config
(patch-set rollback, undo) SHALL NOT be subject to this requirement. Reads SHALL never validate config keys.

#### Scenario: Typo'd key is rejected with a hint, for each kind
- **WHEN** an Output of each kind is created with its known config plus a typo'd key (e.g. chart `chartTyp`, metric
  `lable`, table `columnOrdr`, collection `layot`, timeline `sortt`, markdown `contnet`)
- **THEN** the response is 400, the message names the typo'd key and suggests the intended key, and no Output exists

#### Scenario: Key valid for another kind is rejected
- **WHEN** a table Output is created with `chartType`
- **THEN** the response is 400 naming `chartType` as not a table config key

#### Scenario: Stored legacy key does not block an update
- **WHEN** an Output whose stored config carries `metricLabel` is updated with `{ "config": { "compare": "1d" } }`, and
  separately with its full stored config (including `metricLabel` unchanged) plus `compare`
- **THEN** both updates return 200, `metricLabel` is still stored, and `GET /api/outputs/:id` returns it
- **WHEN** that Output is updated with `{ "config": { "metricLabel": null } }`
- **THEN** the response is 200 and `GET /api/outputs/:id` returns `"metricLabel": null` (stored as JSON null; the
  shallow merge is unchanged)

#### Scenario: Changing a stored legacy key is rejected
- **WHEN** that Output is updated with `{ "config": { "metricLabel": "New" } }`
- **THEN** the response is 400 naming `metricLabel` and suggesting `label`

#### Scenario: Single-call create and proposal grounding
- **WHEN** a single-call pipeline create names an Output with an unknown config key, or a pipeline proposal does
- **THEN** the create is 400 naming the key, and the proposal's Output carries a `validationError` naming the key

### Requirement: Output config writes validate aggregation and chartType
Every Output config write listed above (except restoring journaled prior config) SHALL, when the written
`aggregation` differs from the stored one (always on create), accept `aggregation` only as `null` (chart/metric), as
`{ groupBy, agg, yField }` on a chart Output, or as `{ agg }` or `{ value, agg }` on a metric Output, where every named
field is a non-empty string, `agg` is one of `count`, `sum`, `avg`, `min`, `max`, and no other field is present. When
such a write sets a non-null metric `aggregation`, the resulting config SHALL name its field via `fieldMapping.value` or
`aggregation.value`, and when both are present they SHALL be equal; a metric with a null or absent aggregation needs no
field. A chart Output whose resulting `chartType` is `scatter` SHALL NOT carry a
non-null `aggregation` (a scatter chart never aggregates) when the write changes either key from its stored value. `chartType`, when written,
SHALL be `null` or one of `bar`, `line`, `pie`, `scatter`. Any violation SHALL be a 400 with a message naming
`aggregation` or `chartType` and the problem; nothing SHALL be persisted.

#### Scenario: Well-formed chart aggregation is accepted and rendered
- **WHEN** a bar chart Output is created with `aggregation: { groupBy: "region", agg: "sum", yField: "amount" }`
- **THEN** the write succeeds and a dashboard panel bound to it plots one bar per region with the summed amount

#### Scenario: Malformed chart aggregation is rejected
- **WHEN** a chart Output is written with `aggregation` missing `yField`, with `agg: "median"`, or metric-shaped
  `{ value, agg }`
- **THEN** the response is 400 naming `aggregation`

#### Scenario: Aggregation on a scatter chart or a non-aggregating kind is rejected
- **WHEN** a chart Output with `chartType: "scatter"` is written with a non-null `aggregation`, or a table Output is
  written with any `aggregation`
- **THEN** the response is 400 naming `aggregation`

#### Scenario: Metric aggregation shapes
- **WHEN** a metric Output is written with `fieldMapping.value: "amount"` and `aggregation: { agg: "sum" }`, or with
  `aggregation: { value: "amount", agg: "sum" }` and no `fieldMapping.value`
- **THEN** the write succeeds
- **WHEN** a metric Output is written with `aggregation: { agg: "sum" }` and no field, or with
  `fieldMapping.value: "a"` and `aggregation: { value: "b", agg: "sum" }`
- **THEN** the response is 400 naming `aggregation`
- **WHEN** a metric Output is written with `{ fieldMapping: {}, aggregation: null }` or `{ fieldMapping: { label: "x" } }`
- **THEN** the write succeeds

#### Scenario: Rollback restores a value the new rules reject
- **WHEN** a patch set changes a stored scatter chart carrying an aggregation to `chartType: "bar"` and is rolled back
- **THEN** the rollback succeeds and the original scatter config with its aggregation is restored

#### Scenario: Unknown chartType is rejected
- **WHEN** a chart Output is written with `chartType: "area"`
- **THEN** the response is 400 naming `chartType`
