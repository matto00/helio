# Pipeline Engine

Execution and analysis logic that operates over pipeline steps and rows:
`InProcessPipelineEngine` (runs a pipeline's steps against loaded source rows),
`SchemaInferenceEngine` (infers a schema from JSON/CSV samples),
`ExpressionEvaluator` (evaluates computed-field expressions),
`PipelineAnalyzeService` (dry-run schema analysis), `PipelineRowJson`
(row <-> JSON conversion), and `AlertEventStateMachine` (alert lifecycle
transitions, which consumes pipeline-run output).

Does NOT hold: domain data types (`domain/model/`), connector implementations
(`domain/connectors/`), the per-step transform logic itself
(`domain/steps/`, unchanged by this split), or HTTP/service orchestration
(`services/pipelines/`, `api/routes/pipelines/`).
