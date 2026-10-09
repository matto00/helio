## MODIFIED Requirements

### Requirement: Aggregate analyze types match apply for every supported function
Analyze type inference for an aggregate step SHALL type `median` and `percentile` results as
`float` and `count_distinct` results as `integer`, case-insensitively on the function name, and
SHALL be consistent with the runtime type `apply` produces for every function in
`AggregateStep.SupportedFunctions`. Because apply computes `min` and `max` over the numeric values of the
source field and returns a floating-point number (or null), analyze SHALL type `min` and `max` results as
`float` regardless of the source field's declared type. This applies to the `aggregate` op only; the `groupby`
op's inference is unchanged.

#### Scenario: Inferred types for the new functions
- **WHEN** analyze runs on an aggregate step with `median`, `percentile` (p = 95) and `count_distinct` aggregations
- **THEN** the projected schema types those aliases `float`, `float` and `integer`

#### Scenario: min and max on an integer field are typed float
- **WHEN** analyze runs on an aggregate step with `min` and `max` aggregations over a field declared `integer`
- **THEN** the projected schema types both aliases `float`, and apply returns a floating-point value for both

#### Scenario: Parity test covers every supported function
- **WHEN** a function is added to `AggregateStep.SupportedFunctions`
- **THEN** the apply/infer parity test exercises it, over source fields of more than one declared type (including
  `integer`), without further edits, and fails if its inferred type disagrees with apply's runtime value type

### Requirement: Aggregate step editor offers the new functions
The `AggregateConfig` editor SHALL offer `median`, `percentile` and `count_distinct` in each
aggregation row's function picker, each with a hint. Selecting `percentile` SHALL show a numeric `p`
input (0–100) for that row; selecting any other function SHALL remove `p` from that row's config. Switching a row to `percentile`
SHALL seed `p: 50`. The editor SHALL match a stored function name case-insensitively (as analyze and apply do):
a stored `"SUM"` or `"PERCENTILE"` SHALL show the corresponding picker selection and hint, and `"PERCENTILE"` SHALL
show the `p` input. The `p` input SHALL keep a visible label whether or not it has a value, and while its inline
error is shown it SHALL carry `aria-invalid="true"` and an `aria-describedby` that references the error element.

#### Scenario: Choosing percentile reveals p
- **WHEN** the user selects `percentile` in an aggregation row's function picker and enters 90
- **THEN** onChange is called with that row carrying `fn: "percentile"` and `p: 90`

#### Scenario: Clearing or mistyping p does not emit an invalid p
- **WHEN** the user clears the `p` input or enters a value outside 0–100
- **THEN** an inline error is shown for that row and onChange is not called with the invalid value (the row keeps its last valid `p`)

#### Scenario: Switching away from percentile drops p
- **WHEN** a row with `fn: "percentile", p: 90` is switched to `median`
- **THEN** onChange is called with that row carrying `fn: "median"` and no `p` key

#### Scenario: Upper-case stored function names are recognised
- **WHEN** the editor renders rows whose stored `fn` is `"SUM"` and `"PERCENTILE"` (with `p: 90`)
- **THEN** each row shows its function's hint, the picker shows `sum` / `percentile`, and the `PERCENTILE` row shows the `p` input with value 90

#### Scenario: p input error is programmatically linked
- **WHEN** the user enters an out-of-range value in the `p` input
- **THEN** the input has `aria-invalid="true"` and its accessible description is the inline error text, and the input still has a visible label
