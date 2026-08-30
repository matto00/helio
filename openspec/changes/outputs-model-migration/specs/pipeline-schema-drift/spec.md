## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Successful runs persist a source-schema baseline

On each successful (non-dry) pipeline run, the system SHALL persist the pipeline's current source schema — the
same `[{name, type}]` derivation the analyze path uses (source Output/node declared fields) — to
`pipelines.last_source_schema` (nullable JSONB), alongside the existing last-run metadata update. Baseline
persistence SHALL be best-effort: a persistence failure SHALL NOT fail or block the run. Dry runs SHALL NOT
update the baseline. Failed runs SHALL NOT update the baseline.

#### Scenario: Baseline written on successful run
- **WHEN** a pipeline run completes successfully for a source whose schema is `[{name: "a", type: "string"}]`
- **THEN** `pipelines.last_source_schema` for that pipeline contains `[{"name": "a", "type": "string"}]`

#### Scenario: Dry run leaves baseline untouched
- **WHEN** a dry run completes successfully for a pipeline with an existing baseline
- **THEN** `pipelines.last_source_schema` is unchanged
