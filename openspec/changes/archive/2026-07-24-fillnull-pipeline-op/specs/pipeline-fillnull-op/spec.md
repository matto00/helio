## ADDED Requirements

### Requirement: FillNull op fills null cells in named columns per a single strategy
The system SHALL support a `"fillnull"` pipeline step. Config shape: `{"columns": <string[]>,
"strategy": <"constant"|"forwardFill"|"mean"|"median"|"mode">, "value": <string|null>}`. Only cells
in `columns` whose value is null (either the field is absent from the row or its value is
explicitly null) SHALL be replaced; non-null cells and cells in columns not listed SHALL pass
through unchanged. The output schema SHALL equal the input schema (pass-through, no column added
or removed). An unsupported `strategy` SHALL fail at execute time with a descriptive error naming
the invalid value and the supported set.

#### Scenario: Constant fill replaces only null cells
- **WHEN** a fillnull step with `{"columns": ["region"], "strategy": "constant", "value":
  "unknown"}` is applied to rows `[{"region": null, "v": 1}, {"region": "east", "v": 2}]`
- **THEN** the output is `[{"region": "unknown", "v": 1}, {"region": "east", "v": 2}]`

#### Scenario: Missing key is treated as null
- **WHEN** a fillnull step with `{"columns": ["region"], "strategy": "constant", "value":
  "unknown"}` is applied to rows `[{"v": 1}]` (no `region` key present)
- **THEN** the output is `[{"region": "unknown", "v": 1}]`

#### Scenario: Constant strategy without a value fails
- **WHEN** a fillnull step with `{"columns": ["region"], "strategy": "constant", "value": null}` is
  executed
- **THEN** execution fails with a descriptive error naming the missing `value`

#### Scenario: Columns not listed are untouched
- **WHEN** a fillnull step with `{"columns": ["region"], "strategy": "constant", "value": "x"}` is
  applied to rows `[{"region": null, "other": null}]`
- **THEN** the output is `[{"region": "x", "other": null}]` — `other` stays null

#### Scenario: Unsupported strategy fails with a descriptive error
- **WHEN** a fillnull step with `{"columns": ["a"], "strategy": "bogus", "value": null}` is executed
- **THEN** execution fails with a descriptive error naming `"bogus"` and the five supported
  strategies

#### Scenario: Schema pass-through on analyze
- **WHEN** the analyze endpoint processes a fillnull step
- **THEN** `outputSchema` equals `inputSchema` and `validationError` is `None`

### Requirement: Forward-fill strategy carries the last non-null value in original row order
When `strategy` is `"forwardFill"`, each listed column SHALL be filled independently by carrying
the most recent non-null value seen so far in original input row order. A leading run of null
values in a column, before any non-null value has been seen, SHALL remain null (there is nothing to
carry forward).

#### Scenario: Forward-fill carries the previous value
- **WHEN** a fillnull step with `{"columns": ["price"], "strategy": "forwardFill", "value": null}`
  is applied to rows `[{"price": 10}, {"price": null}, {"price": null}, {"price": 20}]`
- **THEN** the output is `[{"price": 10}, {"price": 10}, {"price": 10}, {"price": 20}]`

#### Scenario: Leading null region stays null
- **WHEN** a fillnull step with `{"columns": ["price"], "strategy": "forwardFill", "value": null}`
  is applied to rows `[{"price": null}, {"price": null}, {"price": 5}]`
- **THEN** the output is `[{"price": null}, {"price": null}, {"price": 5}]`

### Requirement: Column-statistic strategies impute a single computed value per column
When `strategy` is `"mean"`, `"median"`, or `"mode"`, the system SHALL compute one value per listed
column over all non-null values in the input batch (a single pass) and use that one value to fill
every null cell in that column. `mean` and `median` SHALL coerce values to numeric (non-numeric
values are excluded from the computation, matching the aggregate op's numeric-coercion behavior);
`mode` SHALL operate on raw values and, on a tie, SHALL select the value that was first encountered
in row order. If a column has zero non-null values, its cells SHALL remain null (the statistic is
undefined; this is not an execution failure).

#### Scenario: Mean imputation
- **WHEN** a fillnull step with `{"columns": ["price"], "strategy": "mean", "value": null}` is
  applied to rows `[{"price": 10}, {"price": null}, {"price": 20}]`
- **THEN** the output is `[{"price": 10}, {"price": 15}, {"price": 20}]`

#### Scenario: Median imputation
- **WHEN** a fillnull step with `{"columns": ["price"], "strategy": "median", "value": null}` is
  applied to rows `[{"price": 1}, {"price": 3}, {"price": null}, {"price": 100}]`
- **THEN** the null cell is filled with `3` (the median of `[1, 3, 100]`)

#### Scenario: Mode imputation with a tie breaks by first-encountered
- **WHEN** a fillnull step with `{"columns": ["region"], "strategy": "mode", "value": null}` is
  applied to rows `[{"region": "east"}, {"region": "west"}, {"region": null}]`
- **THEN** the null cell is filled with `"east"` (both `"east"` and `"west"` occur once;
  `"east"` was encountered first)

#### Scenario: All-null column stays null under a statistic strategy
- **WHEN** a fillnull step with `{"columns": ["price"], "strategy": "mean", "value": null}` is
  applied to rows `[{"price": null}, {"price": null}]`
- **THEN** the output is `[{"price": null}, {"price": null}]` — no error is raised

### Requirement: FillNull op UI config component
The system SHALL provide a `FillNullConfig` component with a multi-select for `columns` (drawn from
the step's known input columns), a strategy dropdown offering `constant`/`forwardFill`/`mean`/
`median`/`mode`, and a constant-value text input that is shown only when `strategy` is `constant`.
The component SHALL call `onChange` with the serialized config JSON on every change.

#### Scenario: Constant value input only shown for constant strategy
- **WHEN** the strategy dropdown is set to `forwardFill`
- **THEN** the constant-value text input is not rendered

#### Scenario: User selects columns and a strategy
- **WHEN** user selects columns `price` and `qty`, then selects strategy `mean`
- **THEN** onChange is called with a config JSON `{"columns": ["price", "qty"], "strategy":
  "mean", "value": null}`

#### Scenario: User enters a constant value
- **WHEN** strategy is `constant` and the user types `"n/a"` into the value input
- **THEN** onChange is called with a config JSON whose `value` is `"n/a"`

### Requirement: FillNull op is available in the pipeline editor
The system SHALL include a "Fill null / impute" (or equivalent) entry in the op-type dropdown of
the pipeline editor. Selecting it SHALL create a step with op `"fillnull"` and an initial config of
`{"columns": [], "strategy": "constant", "value": null}`. The step card body SHALL render
`FillNullConfig` when the step op is `"fillnull"`.

#### Scenario: Adding a fillnull step
- **WHEN** user selects the fillnull entry from the op dropdown
- **THEN** a new step is created with op `"fillnull"` and config `{"columns":[],"strategy":
  "constant","value":null}`

#### Scenario: Editing a fillnull step
- **WHEN** the step card for a fillnull step is expanded
- **THEN** `FillNullConfig` is rendered with the current `columns`/`strategy`/`value`
