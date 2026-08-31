## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Every withSystemContext callsite carries a bypass justification comment
Each call to `withSystemContext` in repository or service code SHALL have an inline
Scaladoc or block comment explaining why ACL bypass is correct for that specific
caller.

#### Scenario: ResourceTypeRegistry resolver is justified
- **WHEN** the `ResourceTypeRegistry` resolver calls `findByIdInternal`
- **THEN** the callsite has a comment stating it resolves ownership FOR the ACL
  check (chicken-and-egg) and therefore BYPASSRLS is required

#### Scenario: Background and pipeline callers are justified
- **WHEN** `SparkJobSubmitter`, `PipelineRunRepository` internal methods,
  `NodeSnapshotRepository`, `SourceSchemaHealthCheck`, or `DemoData` call
  `withSystemContext`
- **THEN** each callsite has a comment stating the pipeline/boot ACL gate that
  makes bypass safe for that caller
