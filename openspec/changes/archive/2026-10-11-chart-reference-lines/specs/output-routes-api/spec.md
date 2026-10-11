## ADDED Requirements

### Requirement: Chart Output config accepts and validates reference lines and bands
In addition to the chart keys of the per-kind known-key set, a chart Output's `config` SHALL accept the top-level keys
`referenceLines` and `referenceBands` on every Output config write path (Output create, Output update, single-call
pipeline creation, pipeline-proposal grounding, patch-set preview and apply of an Output update); no other kind SHALL
accept them. `referenceLines` SHALL be `null` or an array of at most 5 objects `{value, label?, tone?}`;
`referenceBands` SHALL be `null` or an array of at most 3 objects `{from, to, label?, tone?}` with `from` less than
`to`. `value`, `from` and `to` SHALL be finite JSON numbers; `label`, when present, a string of 1 to 60 characters
containing at least one non-whitespace character (stored as sent); `tone`, when present, one of `neutral`, `success`, `warning`, `error`; no other item keys SHALL be
accepted. When a write changes either key from its stored value, a violation SHALL be a 400 whose message names the
key (and the offending item index) and the problem, and nothing SHALL be persisted. Values are accepted regardless of
the Output's `chartType`.

#### Scenario: Valid reference lines and bands round-trip
- **WHEN** a chart Output is created with `referenceLines: [{"value": 95, "label": "SLO", "tone": "warning"}]` and
  `referenceBands: [{"from": 0, "to": 50, "tone": "success"}]`
- **THEN** the response is 201 and `GET /api/outputs/:id` returns both keys unchanged

#### Scenario: Caps are enforced
- **WHEN** a chart Output is written with 6 reference lines, or with 4 reference bands
- **THEN** the response is 400 naming `referenceLines` (respectively `referenceBands`)

#### Scenario: Malformed items are rejected
- **WHEN** a chart Output is written with a line whose `value` is `"95"`, a label of 61 characters, a whitespace-only label, a
  tone of `"red"`, an extra item key, or a band whose `from` is not less than `to`
- **THEN** the response is 400 naming the key and the specific problem, and no change is persisted

#### Scenario: Clearing and other kinds
- **WHEN** a chart Output's `referenceLines` is updated to `null` or `[]`
- **THEN** the update succeeds
- **WHEN** a metric Output is created with `referenceLines`
- **THEN** the response is 400 naming `referenceLines` as not a metric config key

#### Scenario: Single-call pipeline create validates reference marks
- **WHEN** a single-call pipeline create names a chart Output with 6 reference lines
- **THEN** the create is 400 naming `referenceLines` and nothing is created

## MODIFIED Requirements

### Requirement: Output config writes reject unknown keys per kind
Every write that persists an Output's `config` (Output create, Output update, single-call pipeline creation, the
grounding of a pipeline proposal's Outputs, and the patch-set preview and apply of an Output update) SHALL accept only
top-level keys in the Output kind's known-key set. Every kind SHALL accept `fieldMapping`, `compare` and
`historyPayloads`; additionally chart SHALL accept `chartType`, `aggregation`, `chartOptions`, `annotation`, `referenceLines`, `referenceBands`; metric
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
