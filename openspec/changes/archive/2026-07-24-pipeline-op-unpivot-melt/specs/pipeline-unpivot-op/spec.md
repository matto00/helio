## ADDED Requirements

### Requirement: Unpivot op reshapes wide rows into long rows, one output row per (input row, valueVar)
The execution engine SHALL support the `unpivot` op. The step config SHALL contain `idVars`
(`Vector[String]`: source column names carried unchanged onto every emitted row), `valueVars`
(`Vector[String]`: source column names to collapse), `varName` (`string`, default `"variable"`: the
output column holding each collapsed column's name), and `valueName` (`string`, default `"value"`:
the output column holding each collapsed column's cell value).

For each input row, the engine SHALL emit exactly one output row per entry in `valueVars`, in
`valueVars` config order, for a total output row count of `(input row count) * (valueVars length)`.
Each emitted row SHALL carry the `idVars` field values unchanged (a missing `idVars` field on the
source row SHALL yield `null` for that field, not drop the row — mirroring the `pivot` op's tolerant
`index` field lookup), plus `varName` = the source `valueVars` entry's column name (a string) and
`valueName` = that column's raw, un-coerced cell value from the source row (`null` if the row lacks
that field — the row SHALL still be emitted, not skipped).

If `varName` or `valueName` collides with an `idVars` field name, or `valueName` collides with
`varName`, the later-assigned value SHALL win (`idVars` values first, then `varName`, then
`valueName`), mirroring the `pivot` op's and `aggregate` op's "derived data wins" collision
convention.

#### Scenario: Basic unpivot with two value columns
- **WHEN** an unpivot step with `{"idVars": ["region"], "valueVars": ["jan", "feb"], "varName":
  "month", "valueName": "amount"}` is applied to the row `{"region": "west", "jan": 10, "feb": 20}`
- **THEN** the output rows are `{"region": "west", "month": "jan", "amount": 10}` and `{"region":
  "west", "month": "feb", "amount": 20}`, in that order

#### Scenario: Row count multiplies by the number of valueVars
- **WHEN** an unpivot step with `{"idVars": ["id"], "valueVars": ["a", "b", "c"], "varName":
  "variable", "valueName": "value"}` is applied to 2 input rows
- **THEN** exactly 6 output rows are produced (2 input rows × 3 valueVars)

#### Scenario: Default varName/valueName apply when omitted from config
- **WHEN** an unpivot step with `{"idVars": ["id"], "valueVars": ["a"]}` (no `varName`/`valueName`
  keys) is applied to the row `{"id": 1, "a": 5}`
- **THEN** the output row is `{"id": 1, "variable": "a", "value": 5}`

#### Scenario: Missing idVars or valueVars field yields null, not a dropped row
- **WHEN** an unpivot step with `{"idVars": ["id", "missingId"], "valueVars": ["missingValue"],
  "varName": "variable", "valueName": "value"}` is applied to the row `{"id": 1}`
- **THEN** exactly one output row is produced: `{"id": 1, "missingId": null, "variable":
  "missingValue", "value": null}`

#### Scenario: valueName collides with an idVars field name — valueName wins
- **WHEN** an unpivot step with `{"idVars": ["value"], "valueVars": ["a"], "varName": "variable",
  "valueName": "value"}` is applied to the row `{"value": "keep-me", "a": 5}`
- **THEN** the output row's `value` field is `5` (the unpivoted cell), not `"keep-me"`

### Requirement: Analyze reports a fully deterministic output schema for unpivot without sampling data
`analyze_pipeline`'s schema inference for `unpivot` SHALL NOT sample data. The output schema SHALL be
computed purely from `idVars`/`valueVars`/`varName`/`valueName` and the input schema, and SHALL equal
exactly: each `idVars` field (in `idVars` order, typed per its `inputSchema` entry), followed by
`varName` typed `string`, followed by `valueName` typed per the "common type" rule below. If
`varName` or `valueName` names the same field as an earlier entry in this sequence, the later entry
SHALL replace the earlier one in place (matching the `datebucket` op's replace-in-place collision
convention) rather than producing a duplicate schema field.

`valueName`'s type SHALL be the shared declared type of all `valueVars` fields (looked up in
`inputSchema`) if every `valueVars` field has the identical declared type; otherwise `valueName`'s
type SHALL be `"string"`.

If any `idVars` or `valueVars` field name does not exist in `inputSchema`, `validationError` SHALL be
set to a descriptive message identifying the missing field(s), and the output schema SHALL fall back
to `inputSchema` unchanged (identity fallback, matching every other op's failure contract, including
`pivot`'s `index`/`column`/`values` existence check).

#### Scenario: Output schema is idVars + varName(string) + valueName(common type)
- **WHEN** an unpivot step with `{"idVars": ["region"], "valueVars": ["jan", "feb"], "varName":
  "month", "valueName": "amount"}` is analyzed against an input schema containing `region` (string),
  `jan` (number), and `feb` (number)
- **THEN** the output schema is exactly `[{"name": "region", "type": "string"}, {"name": "month",
  "type": "string"}, {"name": "amount", "type": "number"}]` and `validationError` is absent (`None`)

#### Scenario: Mixed valueVars types fall back to string for valueName
- **WHEN** an unpivot step with `{"idVars": [], "valueVars": ["a", "b"], "varName": "variable",
  "valueName": "value"}` is analyzed against an input schema where `a` is `number` and `b` is
  `string`
- **THEN** the output schema's `value` field has type `"string"`

#### Scenario: Unknown idVars field yields a real validation error
- **WHEN** an unpivot step with `{"idVars": ["nonexistent"], "valueVars": ["a"], "varName":
  "variable", "valueName": "value"}` is analyzed against an input schema that does not contain
  `nonexistent`
- **THEN** `validationError` identifies `"nonexistent"` as missing, and the output schema equals the
  input schema unchanged

#### Scenario: Unknown valueVars field yields a real validation error
- **WHEN** an unpivot step with `{"idVars": [], "valueVars": ["missingCol"], "varName": "variable",
  "valueName": "value"}` is analyzed against an input schema that does not contain `missingCol`
- **THEN** `validationError` identifies `"missingCol"` as missing, and the output schema equals the
  input schema unchanged
