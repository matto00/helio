## MODIFIED Requirements

### Requirement: Output config writes reject unknown keys per kind
Every write that persists an Output's `config` (Output create, Output update, single-call pipeline creation, the
grounding of a pipeline proposal's Outputs, and the patch-set preview and apply of an Output update) SHALL accept only
top-level keys in the Output kind's known-key set. Every kind SHALL accept `fieldMapping`, `compare` and
`historyPayloads`; additionally chart SHALL accept `chartType`, `aggregation`, `chartOptions`, `annotation`; metric
SHALL accept `aggregation`, `label`, `unit`, `format`, `conditionalFormats`; table SHALL accept `columnOrder`, `columnFormats`, `columnSort`,
`columnFilters`, `pinnedColumns`, `conditionalFormats`; collection SHALL accept `layout`, `format`,
`conditionalFormats`; timeline SHALL accept `sort`; markdown
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

#### Scenario: conditionalFormats is accepted on metric, table and collection
- **WHEN** a metric, table or collection Output is created with a valid `conditionalFormats` list
- **THEN** the write succeeds

#### Scenario: conditionalFormats is rejected on chart, timeline and markdown
- **WHEN** a chart, timeline or markdown Output is created with `conditionalFormats`
- **THEN** the response is 400 naming `conditionalFormats` as not a config key of that kind
