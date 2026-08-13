# HEL-383: Atomic pipeline-proposal apply path (source → pipeline → steps → run) with guardrails

## Description

This is the core of Agent-Authored Pipelines: turn a reviewed `PipelineProposal` (HEL-342 schema ticket) into real resources — optionally a new data source, then a pipeline, its ordered steps, and a run producing the panel-bindable output DataType — **atomically**, so a proposal that fails partway leaves nothing behind. It is the data-layer analogue of `DashboardProposalService`, which composes the existing dashboard/panel services and rolls back a partially-created dashboard on failure.

The apply path composes the EXISTING services: `SourceService.createSql`/`createRest`/CSV/static (or resolve an existing source), `PipelineService.create` + `addStep`, and `PipelineRunService` for the run. It holds no persistence logic of its own and runs entirely under the caller's RLS context.

Touches: new `backend/src/main/scala/com/helio/services/PipelineProposalService.scala`, a route (e.g. `POST /api/pipelines/apply-proposal`) wired in `api/ApiRoutes.scala` (alongside `DashboardProposalRoutes` ~line 215), and the `PipelineProposal` protocol.

## Scope

* Backend Scala: `PipelineProposalService.apply(proposal, user)` that (1) pre-validates structure + the inline-source read-only/SQL guardrails up front (nothing created on a bad proposal, mirroring `DashboardProposalService.validateStructure`/`preValidateBindings`), then (2) creates source (if inline) → pipeline → steps in order → runs the pipeline, composing existing services only. Never inline fully-qualified names.
* Atomicity/rollback: on any failure after creation begins, delete the partially-created resources (source/pipeline cascade) before returning the error — mirror `DashboardProposalService.createAll`'s cascade-delete rollback. Document the ordering that makes cleanup safe.
* Guardrails surfaced verbatim: SQL read-only rejection (no source created), and source-fetch failure returned as a structured error (mirror `create_rest_data_source`/`create_sql_data_source` `dataType: null` + `fetchError` behavior) rather than an opaque 500.
* Backend Scala: `POST /api/pipelines/apply-proposal` returning the created source (if any) + pipeline summary + output DataType id + run status/rowCount.
* Tests: ScalaTest for happy path (all resources created, run succeeds, output type is pipeline-bindable), mid-apply failure rolls everything back (no orphan source/pipeline), SQL non-SELECT rejected creating nothing, and RLS enforced.

## Acceptance criteria

- [ ] `POST /api/pipelines/apply-proposal` atomically creates source(if inline)+pipeline+steps and runs it, returning the output DataType id + run summary.
- [ ] A failure at any step leaves NO partially-created resources (verified by test asserting counts unchanged after a forced mid-apply failure).
- [ ] Composes existing `SourceService` / `PipelineService` / `PipelineRunService` — no direct DB writes, RLS enforced.
- [ ] SQL non-SELECT is rejected up front, creating nothing; a source-fetch failure is returned as a structured `fetchError`, not a 500.
- [ ] Output DataType is a pipeline output (sourceId null), panel-bindable per V41.
- [ ] `sbt test` green.
- [ ] Backward-compat: additive endpoint/service; existing pipeline/source endpoints unchanged.

## Out of scope

* Analyze/dry-run projection (separate ticket; a caller may analyze first).
* MCP `propose_pipeline` tool (separate ticket).
* Combining with a dashboard proposal in one call (combined-proposal ticket).

## Dependencies

* Depends on the HEL-342 pipeline-proposal schema/protocol ticket. Consumed by the MCP and combined-proposal tickets.
