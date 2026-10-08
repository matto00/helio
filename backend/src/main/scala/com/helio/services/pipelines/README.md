# Services — Pipelines

Pipeline CRUD, run execution/scheduling, shape application, and the Output family (a pipeline's panel-bindable, per-node projections, HEL-904).

Holds: `PipelineProposalService`, `PipelineRunService` (the entry point; its collaborators `PipelineRunSupport`, `PipelineRunTerminalWrites`, `PipelineRunSucceededWrites`, `PipelineRunExecutor`, `PipelineRunBackfill` and `PipelineRunQueries` are `private[pipelines]`), `PipelineSchedulerService`, `PipelineScheduleService`, `PipelineService`, `PipelineShapeService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/pipelines/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
