## MODIFIED Requirements

### Requirement: Aggregate-requiring kinds offer tail insertion
If the sheet's kind requires an aggregate the current node does not provide, it SHALL offer
"add as tail with an aggregate step", which inserts a real `aggregate` pipeline step and attaches
the Output to it with no Output-level aggregation of its own (`aggregation: null`). The attached
Output's `fieldMapping` SHALL use only that kind's own slot names (`OutputBindingSpec`): a chart
maps the aggregate's group-by column to `xAxis` and its alias column to `yAxis`; a metric maps the
alias column to `value`.

#### Scenario: Metric kind on a non-aggregated node
- **WHEN** a user selects `metric` kind on a node with no aggregation upstream
- **THEN** the sheet offers "add as tail with an aggregate step"; confirming creates the step then the Output

#### Scenario: Chart tail writes the chart's real slots
- **WHEN** a user creating a `chart` Output with group-by `region`, aggregation `sum` and y-field `amount` confirms
  "add as tail with an aggregate step"
- **THEN** the created Output's `fieldMapping` is `{ "xAxis": "region", "yAxis": "sum_amount" }`, the server accepts
  it (no 400), and the aggregate step is kept
