## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: OutputContract declares the shape-level output guarantee
The backend SHALL define `OutputContract(rowCount: RowCountContract, description: String)` in
`com.helio.domain.shapes`, where `RowCountContract` is one of `ExactlyOne`, `AtMostParam(paramName:
String)`, or `Unbounded`. `OutputContract` carries no statically-declared field list — a prior
`OutputFieldContract`/`fields: Vector[OutputFieldContract]` member was removed as YAGNI (zero producers,
zero consumers across the entire shipped shape epic; `outputContract` is a static `val` with no access to
`params`, so it structurally could never express param-derived field sets). Any surface needing a shape's
actual output columns SHALL bind via the runtime `Output` schema produced after instantiate → run
(HEL-399), not a static field declaration.

#### Scenario: OutputContract carries no fields member
- **WHEN** `PassthroughShape.outputContract` is read
- **THEN** it exposes exactly `rowCount` and `description` — there is no `fields` member to read
