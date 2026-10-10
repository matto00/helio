# pipeline-pivot-op Specification

## Purpose
The `pivot` pipeline op reshapes long rows into wide rows — one row per `index` tuple, one output
column per distinct value of `column` — and defines how `analyze_pipeline` reports a schema for
this data-dependent-arity op without sampling data, enabling matrix/crosstab panels and the
pivot/matrix smart shape (HEL-337).

## Requirements

### Requirement: Pivot op reshapes long rows into wide rows grouped by index
The execution engine SHALL support the `pivot` op. The step config SHALL contain `index`
(`Vector[String]`: source column names to group by), `column` (`string`: source column whose
distinct values become new output columns), `values` (`string`: source column whose values are
aggregated into each new output column), and `agg` (`string`: one of `sum`, `count`, `avg`, `min`,
`max`, `first`).

Rows SHALL first be grouped by the tuple of `index` field values (a `null` value at an `index`
field is a valid group key, mirroring the `aggregate` op's `groupBy` semantics). Each output row
SHALL carry its group's `index` field values. Within each group, rows SHALL further be grouped by
their (non-`null`) `column` field value; for each distinct such value `v`, the output row SHALL
gain a column named `<values>_<v>` whose value is `agg` applied to the `values` field across that
group+value's rows. Rows whose `column` field value is `null` SHALL be excluded from value-column
computation but SHALL NOT prevent their `index` group from producing an output row.

If a `<values>_<v>` name collides with an `index` field name or with another `<values>_<v>` name
(distinct `column` values whose string forms coincide), the later-computed value column SHALL win
(overwrite), mirroring the `aggregate` op's `keyMap ++ aggMap` collision precedent.

If `agg` is not one of the six supported functions, step execution SHALL fail with a descriptive
error identifying the invalid value and the supported set (parity with the `aggregate` op's
unsupported-function error).

#### Scenario: Basic pivot with sum
- **WHEN** a pivot step with `{"index": ["region"], "column": "product", "values": "revenue",
  "agg": "sum"}` is applied to rows `{"region": "west", "product": "widgets", "revenue": 10}`,
  `{"region": "west", "product": "widgets", "revenue": 5}`, `{"region": "west", "product":
  "gadgets", "revenue": 7}`, `{"region": "east", "product": "widgets", "revenue": 3}`
- **THEN** the output rows are `{"region": "west", "revenue_widgets": 15, "revenue_gadgets": 7}` and
  `{"region": "east", "revenue_widgets": 3}`

#### Scenario: count agg counts non-null values cells
- **WHEN** a pivot step with `{"index": ["region"], "column": "product", "values": "revenue",
  "agg": "count"}` is applied to rows `{"region": "west", "product": "widgets", "revenue": 10}`,
  `{"region": "west", "product": "widgets", "revenue": null}`
- **THEN** the output row's `revenue_widgets` is `1`

#### Scenario: first agg returns the raw (un-coerced) values cell of the first matching row
- **WHEN** a pivot step with `{"index": ["region"], "column": "status", "values": "label", "agg":
  "first"}` is applied to rows `{"region": "west", "status": "open", "label": "Needs Review"}`,
  `{"region": "west", "status": "open", "label": "Second Label"}` in that row order
- **THEN** the output row's `label_open` is `"Needs Review"`

#### Scenario: Rows with a null column value don't block their index group's output row
- **WHEN** a pivot step with `{"index": ["region"], "column": "product", "values": "revenue",
  "agg": "sum"}` is applied to rows `{"region": "west", "product": null, "revenue": 10}`
- **THEN** the output rows contain exactly `{"region": "west"}` — no `revenue_*` columns, but the
  `west` group still emits a row

#### Scenario: Unsupported agg fails at execute time with a descriptive error
- **WHEN** a pivot step with `{"index": ["region"], "column": "product", "values": "revenue",
  "agg": "median"}` is applied to any rows
- **THEN** step execution fails with an error identifying `"median"` as unsupported and listing the
  supported set (`sum`, `count`, `avg`, `min`, `max`, `first`)

### Requirement: Analyze reports index-only output schema for pivot without a false validation error
`analyze_pipeline`'s schema inference for `pivot` SHALL NOT sample data and SHALL NOT enumerate the
dynamic `<values>_<v>` output columns (their names depend on runtime data, which analyze does not
access). The output schema SHALL consist of exactly the `index` fields, each carrying its type as
looked up by name in the input schema. `validationError` SHALL be `None` when `index`, `column`,
and `values` all name fields present in the input schema, even though no value columns appear in
the output schema — the absence of dynamic columns from a data-independent schema pass is expected
behavior, not an error condition.

If any `index` field name, or the `column` or `values` field name, does not exist in the input
schema, `validationError` SHALL be set to a descriptive message identifying the missing field(s),
and the output schema SHALL fall back to the input schema unchanged (identity fallback, matching
every other op's failure contract).

#### Scenario: Output schema is index-only, no false validation error
- **WHEN** a pivot step with `{"index": ["region"], "column": "product", "values": "revenue",
  "agg": "sum"}` is analyzed against an input schema containing `region` (string), `product`
  (string), and `revenue` (number)
- **THEN** the output schema is exactly `[{"name": "region", "type": "string"}]` and
  `validationError` is absent (`None`)

#### Scenario: Unknown index field yields a real validation error
- **WHEN** a pivot step with `{"index": ["nonexistent"], "column": "product", "values": "revenue",
  "agg": "sum"}` is analyzed against an input schema that does not contain `nonexistent`
- **THEN** `validationError` identifies `"nonexistent"` as missing, and the output schema equals
  the input schema unchanged

#### Scenario: Unknown column or values field yields a real validation error
- **WHEN** a pivot step with `{"index": ["region"], "column": "missingCol", "values": "revenue",
  "agg": "sum"}` is analyzed against an input schema that does not contain `missingCol`
- **THEN** `validationError` identifies `"missingCol"` as missing, and the output schema equals the
  input schema unchanged

### Requirement: Pivot config is validated at write time and a rejected save is shown on the offending control
A non-empty `agg` outside the supported set SHALL be rejected at write time. An empty or absent `agg` is an unconfigured draft and SHALL stay saveable. In the editor, a rejected save SHALL be shown as an inline error. The user's chosen aggregation SHALL be kept, and the aggregation control SHALL be marked invalid and described by that error.

#### Scenario: Invalid pivot aggregation is rejected at write time
- **WHEN** a step create, step update, pipeline-proposal validate/apply or patch-set apply carries a pivot config whose `agg` is non-empty and unsupported
- **THEN** the write is rejected with the existing step-config validation error response (e.g. 422 on REST) naming the unsupported aggregation function, and nothing is persisted

#### Scenario: Draft pivot config with no agg stays saveable
- **WHEN** a pivot config with an empty or absent `agg` is written
- **THEN** the write succeeds, and analyze and execution still report the missing aggregation

#### Scenario: Rejected save keeps the choice and marks the aggregation control invalid
- **WHEN** a pivot step's config save is rejected with a 422
- **THEN** the editor shows the server's message as an inline error, keeps the selected aggregation, and the aggregation control has `aria-invalid="true"` and `aria-describedby` referencing the error's id
