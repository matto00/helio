## REMOVED Requirements

### Requirement: create_pipeline_from_shape instantiates a shape into a pipeline
**Reason**: Superseded by `add_outputs_from_shape(pipelineId, stepId?, shape, params)`
(mcp-output-tools) — a shape now instantiates Outputs onto an existing pipeline node rather than
creating a whole new pipeline.
**Migration**: Callers first create (or reuse) a pipeline via `create_pipeline`, then call
`add_outputs_from_shape` with that pipeline's id.
