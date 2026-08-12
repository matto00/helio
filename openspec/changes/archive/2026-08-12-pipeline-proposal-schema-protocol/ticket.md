# HEL-379: Pipeline-proposal schema + protocol (source + steps + output DataType contract)

## Description

The dashboard propose/apply model (`schemas/dashboard-proposal.schema.json`, `DashboardProposal`/`ProposalPanel` in `api/protocols/DashboardProposalProtocol.scala`, applied by `DashboardProposalService`) carries no ids and mints resources on apply. There is no equivalent for the **data layer**: an agent can only build a pipeline by chaining live write calls (`create_*_data_source` → `create_pipeline` → `add_pipeline_step` → `run_pipeline`), each an immediate side effect with no reviewable, atomic artifact.

This ticket defines the reviewable artifact: a **pipeline proposal** describing an (optionally new) data source + an ordered list of transform steps + the output DataType contract — no ids, nothing created until applied. It is the schema/protocol foundation the analyze-before-apply and atomic-apply tickets build on.

Touches: new `schemas/pipeline-proposal.schema.json`, a new protocol in `backend/src/main/scala/com/helio/api/protocols/` (mirroring `DashboardProposalProtocol`'s tolerant-reader style — spray-json omits `None`), formatters in `JsonProtocols.scala`, and `openspec/` if a path list is maintained.

## Scope

* schemas: `schemas/pipeline-proposal.schema.json` (JSON Schema 2020-12). Shape: `{ pipelineName, source: <existing sourceId> OR <inline source spec by kind: static/csv/rest/sql>, outputDataTypeName, steps: [{ type, config }] }`. Step `type` ∈ the existing op set (rename/filter/join/compute/groupBy/cast/select/limit/sort/aggregate — mirror `add_pipeline_step`); `config` is a per-type object.
* Backend Scala: `PipelineProposal` case classes + a tolerant `RootJsonFormat` (absent optionals tolerated, matching `DashboardProposalProtocol`). Never inline fully-qualified names.
* Reuse existing source-create request shapes (`SqlCreateSourceRequest`, `CreateSourceRequest`, CSV/static inputs) for the inline-source branch rather than inventing parallel types.
* Tests: ScalaTest round-trip (read/write) for a proposal referencing an existing source and one with an inline source; absent-optional tolerance.

## Acceptance criteria

- [ ] `schemas/pipeline-proposal.schema.json` defines the source-or-sourceId + ordered steps + output-type contract, no ids on created resources, with per-step `type`/`config`.
- [ ] Backend `PipelineProposal` protocol round-trips the schema and tolerates omitted optional fields (parity with `DashboardProposalProtocol`).
- [ ] Inline-source branch reuses existing source-create request types (no duplicate DTOs).
- [ ] `sbt test` green with new round-trip tests.
- [ ] Backward-compat: additive — new schema + protocol only; no existing wire shape changes.

## Out of scope

* The apply path (atomic create) and analyze-before-apply — separate HEL-342 tickets that consume this contract.
* MCP tool surface (separate ticket).
* Validating step configs against source schema (that is the analyze/apply concern).

## Dependencies

* None hard. Foundation for the HEL-342 analyze-before-apply, atomic-apply, MCP, and combined-proposal tickets.
