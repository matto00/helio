# Persistence — Pipelines

Pipeline, pipeline-step, pipeline-run, schedule, data-type and data-type-row persistence — the source->pipeline->type chain's storage layer, plus `BinaryRefRepository` (the binary-ref index derived from data-type-row JSONB).

Holds: `BinaryRefRepository`, `DataTypeRepository`, `DataTypeRowRepository`, `PipelineRepository`, `PipelineRunRepository`, `PipelineScheduleRepository`, `PipelineStepRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/pipelines/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
