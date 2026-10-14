# Services — Pipelines

Pipeline CRUD, run execution/scheduling, shape application, and the Output family (a pipeline's panel-bindable, per-node projections, HEL-904).

This list is a snapshot of the directory at HEL-1451, not a completeness claim; re-derive it with:

```
ls backend/src/main/scala/com/helio/services/pipelines/*.scala | xargs -n1 basename | sed 's/\.scala$//'
```

Visibility notes use each file's top-level declaration: `private[pipelines]` means package-private to this directory; a file with no qualifier is public. A file marked `private[services]` is reachable from every `com.helio.services` subpackage.

Holds, grouped by concern:

- Pipeline CRUD, authoring and catalogs: `PipelineService` (the entry point; its collaborators `PipelineServiceSupport`, `PipelineCreateWrites`, `PipelineCreateTransaction`, `PipelineRootWrites`, `PipelineAnalyzeReads`, `PipelineNodeReads`, `PipelineProposalAnalyze`, `PipelineStepCreate` and `PipelineStepWrites` are `private[pipelines]`), plus `PipelineCreatePreflight` (`private[services]`), `StepPlacement`, `UpsertTargetAnalysis` and `InlineSourceCompensation` (all `private[pipelines]`), `StepReferenceChecks` (a `private[pipelines]` class plus a public companion object whose `private[services]` `secondarySourceOwnershipF` is shared with `patchsets`), and `PipelineProposalService`, `PipelineShapeService`, `PipelineStepCatalogService`.
- Run execution: `PipelineRunService` (the entry point; its collaborators `PipelineRunSupport`, `PipelineRunTerminalWrites`, `PipelineRunSucceededWrites`, `PipelineRunExecutor`, `PipelineRunBackfill`, `PipelineRunPreview` and `PipelineRunQueries` are `private[pipelines]`), plus `PipelineRunDeletedRecovery` (`private[pipelines]`), `PipelineRunGuardConfig`, `RunConfigGate` and `LiveRunTracker`.
- Scheduling, auto-run, heartbeat and reaping: `PipelineSchedulerService`, `PipelineScheduleService`, `AutoRunTriggerService`, `PipelineCostInputGathering` (shared with `PipelineService.analyze`), `PipelineAutoRunDebounceFirer` (`private[pipelines]`), `RunHeartbeatService`, `OrphanedRunReaper` (`private[pipelines]`).
- Output family: `OutputService`, `OutputHistoryService`, `OutputHistoryRetentionService`, `OutputHistoryRetentionConfig`, `OutputConfigValidation`, `OutputControlEligibility`, `OutputFilterCapability`, `OutputFilteredMetric`, `OutputFormatVocabulary`, `OutputRowsQuery`, `LegacyOutputConfigKeys`, `LegacyOutputFormat`, `ProvenanceService`, and the `private[pipelines]` splits of `OutputService`: `OutputRowReads` (materialized-row reads) and `OutputRootResolution` (create-time root anchoring).

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/pipelines/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
