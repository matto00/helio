# HEL-381: Analyze-before-apply: projected output schema for a proposed pipeline (dry, no writes)

## Description

`GET /api/pipelines/:id/analyze` (`PipelineService.analyze` → `PipelineAnalyzeService.analyze`, schema `schemas/pipeline-analyze-response.schema.json`) returns the source schema plus per-step input/output schema for an *already-created* pipeline. An agent authoring a pipeline proposal (HEL-342 schema ticket) needs the same projected column schema for a pipeline that does **not exist yet**, so it (and the reviewer) can verify the output columns before anything is written.

This ticket adds a dry analyze over a `PipelineProposal`: resolve/derive the source schema, fold the proposed ordered steps through the existing analyze engine, and return the projected per-step + final output schema and any per-step validation errors — writing nothing.

Touches: `backend/src/main/scala/com/helio/services/PipelineService.scala` (reuse `PipelineAnalyzeService`), a new endpoint (e.g. `POST /api/pipelines/analyze-proposal`) in a route wired via `api/ApiRoutes.scala`, and the `PipelineProposal` protocol.

## Scope

* Backend Scala: a service method that takes a `PipelineProposal` + `AuthenticatedUser`, resolves the source schema (existing source by id under RLS, OR the inline source spec's declared/previewed columns), and runs the proposed steps through the SAME `PipelineAnalyzeService` the live analyze uses — no persistence, no run.
* Backend Scala: `POST /api/pipelines/analyze-proposal` returning a response reusing/extending `PipelineAnalyzeResponse` (source schema + per-step in/out schema + validationError per step + final output columns). No fully-qualified names inline.
* Guardrail: for an inline SQL source, reject non-SELECT before analyzing (mirror `SourceService` read-only enforcement) so a dry analyze can't smuggle DDL/DML.
* Tests: ScalaTest that a valid proposal returns the projected output columns and creates nothing; a step with a bad config surfaces a per-step `validationError` (not a 500); an existing-source and an inline-source case both analyze.

## Acceptance criteria

- [ ] `POST /api/pipelines/analyze-proposal` returns the projected source + per-step + final output schema for a proposed (uncreated) pipeline; verified nothing is persisted.
- [ ] Reuses `PipelineAnalyzeService` — no second, divergent analyze implementation.
- [ ] Per-step validation errors are surfaced in the response body (not thrown); a structurally invalid proposal returns a clear 400.
- [ ] Inline SQL source with a non-SELECT query is rejected before analysis.
- [ ] RLS-scoped: an existing-source reference the caller can't see returns 403/404, not another user's schema.
- [ ] `sbt test` green; response validates against its schema.
- [ ] Backward-compat: additive endpoint; existing `/analyze` unchanged.

## Out of scope

* Actually creating the source/pipeline/steps or running it (atomic-apply ticket).
* MCP tool exposure (separate ticket, which will call this).

## Dependencies

* Depends on HEL-379 (pipeline-proposal schema/protocol ticket — merged). Consumed by the MCP `propose_pipeline` ticket and the combined-proposal ticket.
