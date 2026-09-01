# Persistence — Pipelines

Pipeline, pipeline-step, pipeline-run, schedule, Output and node-snapshot persistence — the source->pipeline->Output chain's storage layer (HEL-904), plus `BinaryRefRepository` (the binary-ref index, keyed by pipeline_id/node_step_id).

Holds: `BinaryRefRepository`, `OutputRepository`, `NodeSnapshotRepository`, `PipelineRepository`, `PipelineRunRepository`, `PipelineScheduleRepository`, `PipelineStepRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/pipelines/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
