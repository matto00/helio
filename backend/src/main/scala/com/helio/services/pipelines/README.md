# Services — Pipelines

Pipeline CRUD, run execution/scheduling, shape application, and the DataType family (a pipeline's output artifact).

Holds: `DataTypeService`, `PipelineProposalService`, `PipelineRunService`, `PipelineSchedulerService`, `PipelineScheduleService`, `PipelineService`, `PipelineShapeService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/pipelines/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
