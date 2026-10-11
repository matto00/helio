## Purpose

Lets metric, collection and table Outputs display numeric durations (seconds or milliseconds) as compact human text,
selectable in the Output editor and documented on every server and agent surface that describes Output config.

## ADDED Requirements

### Requirement: Compact duration text

A value displayed with the duration format SHALL be interpreted as a number of seconds (or milliseconds for the
milliseconds variant) and rendered as compact text using the units `d`, `h`, `m`, `s` and, below one second, `ms`.
The text SHALL show at most the two most significant units starting at the largest non-zero unit, SHALL omit the second unit
when it is zero, SHALL round to the smallest unit shown (half away from zero), and SHALL prefix a negative value with
`-`. Zero SHALL render `0s`. Days are the largest unit.

#### Scenario: Minutes and seconds
- **WHEN** a metric with format `duration` has value 330
- **THEN** it renders `5m 30s`

#### Scenario: Zero
- **WHEN** a value of 0 is displayed with the duration format
- **THEN** it renders `0s`

#### Scenario: Sub-minute and sub-second
- **WHEN** values 45, 45.6 and 0.25 are displayed with the duration format
- **THEN** they render `45s`, `46s` and `250ms`

#### Scenario: Hours and days
- **WHEN** values 3600, 3725, 3755 and 90061 are displayed with the duration format
- **THEN** they render `1h`, `1h 2m`, `1h 3m` and `1d 1h`

#### Scenario: Rounding carries into the next unit
- **WHEN** values 59.6 and 3599.7 are displayed with the duration format
- **THEN** they render `1m` and `1h`

#### Scenario: Fractional input rounds once, to the smallest unit shown
- **WHEN** values 3629.5 and 88199.5 are displayed with the duration format, and 3629500 with the milliseconds variant
- **THEN** they render `1h`, `1d` and `1h`

#### Scenario: Negative value
- **WHEN** a value of -330 is displayed with the duration format
- **THEN** it renders `-5m 30s`

#### Scenario: Milliseconds input
- **WHEN** a value of 330000 is displayed with the milliseconds variant
- **THEN** it renders `5m 30s`

### Requirement: Duration format on metric, collection and table

Metric and collection Outputs SHALL accept `config.format` values `duration` (seconds) and `durationMs`
(milliseconds). Table Outputs SHALL accept a `config.columnFormats` entry `{ "type": "duration" }` with an optional
`unit` of `s` (default) or `ms`. A metric's history comparison delta SHALL use the same duration text. A duration table
column SHALL be right-aligned like other numeric formats, SHALL sort by the raw value, and SHALL filter on the displayed
text. Conditional-format rules SHALL keep comparing the raw value.

#### Scenario: Table column in milliseconds
- **WHEN** a table column has `columnFormats` `{ "type": "duration", "unit": "ms" }` and a cell value 1500
- **THEN** the cell renders `2s` (rounded to whole seconds above one second)

#### Scenario: Collection item
- **WHEN** a collection with `format` `duration` shows an item with value 90
- **THEN** the item renders `1m 30s`

#### Scenario: Rule on a duration metric
- **WHEN** a metric with format `duration` and value 700 has a rule `gt 600` with tone `warning`
- **THEN** the value renders `11m 40s` with the warning tone

#### Scenario: History delta
- **WHEN** a duration metric's comparison has an absolute delta of 65 and no percentage
- **THEN** the delta renders `1m 5s`

### Requirement: Fallback for unusable values

A null, absent, empty, non-numeric or non-finite value displayed with the duration format SHALL render exactly as the
existing formats render that value (metric/collection: the value text unchanged; table: the existing unformatted cell
text, `—` for null).

#### Scenario: Non-numeric value
- **WHEN** a duration-formatted table cell holds `"n/a"` and another holds null
- **THEN** they render `n/a` and `—`

### Requirement: Editor selection

The Output editor SHALL offer `Duration` and `Duration (ms)` in the metric and collection Format select, and
`Duration (s)` and `Duration (ms)` in each table column's Format select. Saving SHALL write `format: "duration"` or
`"durationMs"`, or the column spec `{ "type": "duration" }` / `{ "type": "duration", "unit": "ms" }`; reopening the
editor SHALL show the stored selection. Switching a table column between formats SHALL never leave a stale `unit`:
`Duration (s)` stores no `unit`, and any non-duration format stores no `unit`.

#### Scenario: Select and save a metric duration format
- **WHEN** an author selects `Duration` in a metric Output's Format select and saves
- **THEN** the PATCH body carries `config.format: "duration"` and the reopened editor shows `Duration`

#### Scenario: Select a milliseconds duration on a collection
- **WHEN** an author selects `Duration (ms)` in a collection Output's Format select and saves
- **THEN** the PATCH body carries `config.format: "durationMs"` and the reopened editor shows `Duration (ms)`

#### Scenario: Switching a column away from milliseconds drops the unit
- **WHEN** a table column stored as `{ "type": "duration", "unit": "ms" }` is switched to `Duration (s)`, or to
  `Number` and then `Duration (s)`, and saved
- **THEN** the saved spec is `{ "type": "duration" }` with no `unit` and the reopened select shows `Duration (s)`

### Requirement: Server and agent surfaces accept and document the format

The backend SHALL accept and store unchanged an Output config using the duration values on create and update. The
backend `KeysDoc`, the Output request JSON schema descriptions and helio-mcp `OUTPUT_CONFIG_KEYS_DOC` SHALL list the
metric/collection `format` values and the table column format types, including the duration values, identical to the
values the frontend reads.

#### Scenario: Round trip
- **WHEN** a metric Output is created with `format: "duration"` and a table Output is patched with a
  `columnFormats` entry `{ "type": "duration", "unit": "ms" }`
- **THEN** both requests succeed and a read returns those values unchanged

#### Scenario: Vocabulary agrees across client and server
- **WHEN** the shared seam fixture lists the format values, the vocabulary sentence and the schema descriptions
- **THEN** the frontend, backend and helio-mcp vocabulary lists equal the fixture lists exactly, the backend and
  helio-mcp vocabulary sentences equal the fixture sentence exactly, and the three request schemas' `format` and
  `columnFormats` descriptions equal the fixture descriptions exactly
