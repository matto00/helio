## ADDED Requirements

### Requirement: Aggregate step shows per-function inline hints in the config form
The AggregateConfig component SHALL display a concise inline hint below the function Select
in each aggregation row. The hint text SHALL be specific to the selected function:
- sum: "Sums numeric values; ignores nulls"
- avg: "Averages numeric values; ignores nulls"
- min: "Minimum numeric value; ignores nulls and non-numeric"
- max: "Maximum numeric value; ignores nulls and non-numeric"
- count: "Counts non-null values in the field"

#### Scenario: Hint shown for sum function
- **WHEN** an aggregation row has fn="sum"
- **THEN** the hint text "Sums numeric values; ignores nulls" is visible below the fn dropdown

#### Scenario: Hint shown for count function
- **WHEN** an aggregation row has fn="count"
- **THEN** the hint text "Counts non-null values in the field" is visible below the fn dropdown

#### Scenario: Hint updates when function changes
- **WHEN** the user changes the function dropdown from "sum" to "avg"
- **THEN** the hint updates to "Averages numeric values; ignores nulls"

### Requirement: Aggregate config form shows alias-empty validation warning per row after blur
The AggregateConfig component SHALL display an inline validation warning ("Output name required")
on each aggregation row whose alias field is empty (blank string), BUT ONLY after the user has
blurred the alias input at least once. A newly added row (alias="") SHALL NOT immediately show
the error before the user has interacted with it. The component tracks blur state per row index
via a local Set<number> in component state.

#### Scenario: No warning on a newly added row before interaction
- **WHEN** the user clicks "+ Add aggregation" and the new row has alias=""
- **THEN** no alias validation warning is shown for that row

#### Scenario: Warning shown after alias input is blurred while empty
- **WHEN** the user focuses and then blurs the alias input without typing anything
- **THEN** an InlineError with text "Output name required" is displayed for that row

#### Scenario: No warning for non-empty alias
- **WHEN** an aggregation row has a non-empty alias (regardless of blur state)
- **THEN** no alias validation warning is shown for that row

### Requirement: Aggregate config form shows a relationship description between sections
The AggregateConfig component SHALL display a short description below the "Group by" section
header explaining: "Group-by fields define the partition keys. Each unique combination becomes
one output row."

#### Scenario: Relationship description visible
- **WHEN** AggregateConfig is rendered
- **THEN** the text "Group-by fields define the partition keys" is visible

### Requirement: Aggregate engine correctness — regression tests cover all functions × edge cases
The backend SHALL have a dedicated AggregateStepSpec that directly calls AggregateStep.apply
and covers:
- sum/avg/min/max/count × empty rows input
- sum/avg/min/max/count × single-row input
- sum/avg/min/max/count × multi-group input
- all-null field values
- min/max on a non-numeric (string) field (expected: null result)
- empty groupBy collapsing all rows to one output row
- apply/infer parity: count returns Long

Key behavioral facts confirmed by audit:
- Empty rows input: apply returns empty Seq (zero output rows), not a row with 0.0
- sum of all-null field values: returns 0.0 (Scala empty-seq .sum)
- avg/min/max of all-null field values: returns null
- min/max on non-numeric field: toDouble yields empty nums, result is null
- count returns Long (consistent with inferred "integer" type)

#### Scenario: Empty rows input returns empty output
- **WHEN** AggregateStep.apply is called with empty rows
- **THEN** the output is an empty Seq (zero rows)

#### Scenario: Empty groupBy collapses all rows to a single output row
- **WHEN** groupBy is empty and aggregations is non-empty and rows is non-empty
- **THEN** exactly one row is returned

#### Scenario: count of all-null field values returns 0
- **WHEN** all rows have null for the count source field
- **THEN** the output count alias value is 0L

#### Scenario: multi-group sum is correct per group
- **WHEN** rows span two groups and fn="sum"
- **THEN** each group row contains the correct sum for that group

#### Scenario: apply/infer parity — count output is Long (integer)
- **WHEN** fn="count" is applied
- **THEN** the output value is a Long (consistent with inferred "integer" type)

#### Scenario: min/max on non-numeric field returns null
- **WHEN** fn="min" or fn="max" is applied to a string-typed field
- **THEN** the output alias value is null (toDouble produces no numeric values for strings)
