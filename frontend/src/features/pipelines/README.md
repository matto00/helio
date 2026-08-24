# Pipelines

Pipeline authoring and run management: `state/` (`pipelinesSlice.ts`,
`schemaDiff.ts`, `stepNarrowing.ts`), services for CRUD/proposals
(`pipelineService.ts`, `pipelineProposalService.ts`), `types/` (step,
pipeline shape, schedule, proposal wire shapes), `hooks/` (create-pipeline
action, run events, step-card state), and `ui/` — the pipeline list/detail
pages, step cards and their per-op configs (`stepConfigs/`), computed-field
UI (`computedFields/`), shape pickers (`shapes/`), schedule UI (`schedule/`),
and proposal review (`proposalReview/`).

**Belongs here:** pipeline step/shape authoring, run history, and scheduling.
**Does not belong here:** the data sources a pipeline reads from, which live
in `sources`; the data types a pipeline produces, which live in `dataTypes`.
