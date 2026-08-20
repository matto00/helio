# HEL-758: Pipeline execution doesn't support rest_api or sql base sources at all

## Description

Follow-up from HEL-755's investigation. Confirmed by reading the code directly (not inferred):

* `PipelineRunService.runPipeline` (`backend/src/main/scala/com/helio/services/PipelineRunService.scala:134-139`) unconditionally rejects a pipeline whose base `sourceDataSourceId` resolves to a `RestSource` or `SqlSource` with `"Unsupported source type for Spark job submission: ... Only static and csv are currently supported."` — regardless of whether the source is reachable/healthy.
* `PipelineRunService.previewStep` has the identical rejection (lines 167-172).
* `InProcessPipelineEngine.loadRows` (`backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala:105-111`) also has no case for `RestSource`/`SqlSource` — only `static`/`csv`/`text`/`pdf`/`image` are supported.

Net effect: **a pipeline whose base source is `rest_api` or `sql` can never actually be run** — not via `POST /api/pipelines/:id/run`, not via preview, not via proposal-apply — so it can never produce panel-bindable row data (per the source → pipeline → type → panel contract). This is a real, pre-existing platform gap, independent of source reachability.

HEL-755 (fail-safely for an unreachable/misconfigured `rest_api`/`sql` proposal-apply source) works around the *symptom* — it stops proposal-apply from destructively rolling back the pipeline/source when this categorical limitation is hit, and reports it as a "blocked" run with a clear reason instead. It does **not** implement actual execution support.

## Acceptance Criteria

- A pipeline whose base source is `rest_api` (a healthy, reachable REST source) can be run via `POST /api/pipelines/:id/run` and complete successfully, producing rows that populate its output DataType — the same way `static`/`csv` pipelines already do.
- A pipeline whose base source is `sql` (a healthy, reachable SQL source) can be run via `POST /api/pipelines/:id/run` and complete successfully, producing rows that populate its output DataType.
- `PipelineRunService.previewStep` supports previewing a base `rest_api`/`sql` step (not just full runs).
- Proposal-apply (`PipelineProposalService`) can now successfully apply a proposal whose base source is a healthy/reachable `rest_api` or `sql` source, ending in a real completed run rather than HEL-755's "blocked"/unrunnable outcome (that outcome remains correct for genuinely unreachable/misconfigured sources — this ticket does not change that fail-safe path, only extends what counts as "supported").
- Existing `static`/`csv`/`text`/`pdf`/`image` pipeline execution behavior is unchanged (no regression).
- The chosen implementation approach (in-process execution reusing `RestApiConnector.fetch`/`SqlConnector`, extended Spark job submission, or a documented combination) is stated explicitly in the change's `design.md`, along with the reasoning.

## Context

Filed as a spinoff during HEL-755 (proposal-apply fail-safely fix, merged 2026-08-19 via PR #397). HEL-755 fixed proposal-apply so REST/SQL sources that fail *connectivity* no longer destroy the created pipeline, and added a `recordUnrunnable` path so this categorical limitation now fails as a visible, durable "Failed" run instead of destroying the pipeline — but it did not add actual execution support for these source kinds. That real capability gap is this ticket's scope.

Note: HEL-757 (assistant web-research capability) is being delivered concurrently by another orchestrator instance in its own worktree — this change must not touch that ticket's branch/worktree, and should avoid unrelated changes to files it may be actively editing.
