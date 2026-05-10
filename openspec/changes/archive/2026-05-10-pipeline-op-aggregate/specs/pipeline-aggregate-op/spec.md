## ADDED Requirements

### Requirement: Aggregate step configures group-by fields and aggregation functions
The system SHALL provide an AggregateConfig component that allows the user to select zero or more
group-by fields from the step's inputSchema (via the analyze endpoint) and add one or more
aggregation rows each specifying an output alias, a function (sum/avg/min/max/count), and a source
field. The component SHALL call onChange with the serialized config JSON on every change.

Config shape: `{"groupBy":[{"name":"<field>","type":"<type>"},...], "aggregations":[{"alias":"<out>","fn":"<fn>","field":"<src>"},...]}`.

#### Scenario: Renders group-by section with available fields
- **WHEN** AggregateConfig is rendered with a non-empty analyzeSchema
- **THEN** the group-by section shows each schema field name as a selectable option

#### Scenario: Renders aggregation rows with alias, fn, and field inputs
- **WHEN** AggregateConfig is rendered with an aggregations list containing one row
- **THEN** the alias input, fn dropdown, and field dropdown for that row are visible

#### Scenario: Adding a group-by field emits updated config
- **WHEN** the user selects a group-by field checkbox or button
- **THEN** onChange is called with config JSON where groupBy contains that field

#### Scenario: Adding an aggregation row emits updated config
- **WHEN** the user clicks "Add aggregation" and fills in alias, fn, and field
- **THEN** onChange is called with config JSON containing the new aggregation row

#### Scenario: Removing a group-by field emits updated config
- **WHEN** the user deselects a group-by field
- **THEN** onChange is called with config JSON where groupBy no longer contains that field

#### Scenario: Removing an aggregation row emits updated config
- **WHEN** the user removes an aggregation row
- **THEN** onChange is called with config JSON where that row is absent

#### Scenario: Inline warning shown for missing aggregation field
- **WHEN** an aggregation row references a field not present in analyzeSchema
- **THEN** an inline warning is shown next to that row

### Requirement: Aggregate step is selectable in the pipeline editor
The system SHALL include "aggregate" in the list of op types in PipelineDetailPage with initial
config `{"groupBy":[],"aggregations":[]}` and render AggregateConfig in the StepCard body when
the step's opType is "aggregate".

#### Scenario: Aggregate step is created with empty initial config
- **WHEN** the user selects "Group & aggregate" from the op dropdown
- **THEN** a new step is created and persisted with config `{"groupBy":[],"aggregations":[]}`

#### Scenario: AggregateConfig is rendered for an aggregate step
- **WHEN** an aggregate step's StepCard is expanded
- **THEN** the AggregateConfig component is rendered (not the generic placeholder)

### Requirement: Backend executes aggregate op using group-by and aggregation config
The InProcessPipelineEngine SHALL handle op `"aggregate"` using the config shape
`{groupBy: [{name, type}], aggregations: [{alias, fn, field}]}` matching PipelineAnalyzeService.
It SHALL group rows by the groupBy field names, compute each aggregation (sum/avg/min/max/count)
over the named field per group, and return one output row per group containing the group-key
values plus each alias-named aggregation result.

#### Scenario: Groups rows by a single field and sums another
- **WHEN** aggregate op config has groupBy=[{name:"dept",type:"string"}] and aggregations=[{alias:"total_age",fn:"sum",field:"age"}]
- **THEN** output has one row per distinct dept value with total_age equal to the sum of age in that group

#### Scenario: Count fn produces non-null row count per group
- **WHEN** aggregate op config uses fn="count"
- **THEN** output contains the alias field with the count of non-null values of field per group

#### Scenario: Avg fn produces mean value per group
- **WHEN** aggregate op config uses fn="avg"
- **THEN** output alias field equals the arithmetic mean of the source field per group

#### Scenario: Min and max fns produce per-group extremes
- **WHEN** aggregate op config uses fn="min" or fn="max"
- **THEN** output alias equals the minimum or maximum value of the source field in that group

#### Scenario: Empty groupBy collapses all rows to one
- **WHEN** aggregate op config has groupBy=[] and one aggregation
- **THEN** output is a single row with the aggregation result over all input rows

#### Scenario: Null values in aggregation field are skipped
- **WHEN** a row has null for the aggregation source field
- **THEN** that row is excluded from numeric aggregations (sum/avg/min/max) but count counts non-nulls
