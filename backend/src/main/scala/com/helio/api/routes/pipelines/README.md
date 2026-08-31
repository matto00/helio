# Routes — Pipelines

Pipeline, pipeline-step, pipeline-run (incl. the SSE run-status registry,
`PipelineRunRegistry`), pipeline-schedule and pipeline-shape HTTP routes.
`DataTypeRoutes` (`GET /api/types` and friends) was deleted in HEL-904 --
pipeline output data is now read via `Output`-bound panels, not the
`/api/types` surface.

Holds: `PipelineProposalRoutes`, `PipelineRoutes`, `PipelineRunHistoryRoutes`,
`PipelineRunRegistry`, `PipelineRunStatusRoutes`, `PipelineRunStreamRoutes`,
`PipelineRunSubmitRoutes`, `PipelineScheduleRoutes`, `PipelineShapeRoutes`,
`PipelineStepRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/pipelines/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
