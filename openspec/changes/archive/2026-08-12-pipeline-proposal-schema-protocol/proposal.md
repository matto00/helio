## Why

An agent can only build a pipeline today by chaining live write calls (`create_*_data_source` →
`create_pipeline` → `add_pipeline_step` → `run_pipeline`), each an immediate side effect with no
reviewable, atomic artifact. The dashboard layer already solved this with `DashboardProposal`
(carries no ids, mints resources only on apply). This ticket brings the same pattern to the data
layer: a `PipelineProposal` schema + tolerant-reader Scala protocol describing an (optionally new)
source + ordered transform steps + output DataType contract. It is the foundation the
analyze-before-apply and atomic-apply tickets (HEL-342) build on — this ticket ships no apply path.

## What Changes

- Add `schemas/pipeline-proposal.schema.json` (JSON Schema 2020-12): `pipelineName`,
  `outputDataTypeName`, a `source` that is either an existing `sourceId` or an inline source spec
  keyed by kind (static/csv/rest/sql), and an ordered `steps` array of `{ type, config }`.
- Add `PipelineProposal`/`PipelineProposalSource` case classes + a tolerant `RootJsonFormat` in a new
  `PipelineProposalProtocol.scala`, mirroring `DashboardProposalProtocol`'s hand-written reader
  (absent optionals tolerated — spray-json omits `None` on the wire).
  Register the new formats in `JsonProtocols.scala`.
- Reuse existing source-create payload shapes (`SqlSourceConfigPayload`, `RestApiConfigPayload`,
  `CsvSourceConfigPayload`, `StaticColumnPayload`/rows) for the inline-source branch, and reuse
  `CreatePipelineStepRequest`'s `{type, config: JsObject}` shape for steps — no parallel DTOs.
- Add ScalaTest round-trip coverage: existing-sourceId proposal, inline-source proposal (one kind),
  and absent-optional-field tolerance.

### New Capabilities

- `pipeline-proposal-contract`: the `PipelineProposal` schema + protocol — an unapplied, id-free,
  reviewable description of a source + steps + output-type contract that a future apply path
  consumes. This ticket defines the contract only; nothing is created from it yet.

### Modified Capabilities

(none — additive only, no existing wire shape changes)

## Impact

- New: `schemas/pipeline-proposal.schema.json`,
  `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala`, a ScalaTest spec.
- Touched: `backend/src/main/scala/com/helio/api/JsonProtocols.scala` (mix in the new protocol trait).
- No routes, no repository, no migration — this ticket ships types and a schema only. No existing
  endpoint's request/response shape changes.

## Non-goals

- The apply path (atomic create) and analyze-before-apply validation — separate HEL-342 tickets.
- MCP tool surface exposing this proposal shape — separate ticket.
- Validating step `config` against the source's inferred schema — an apply/analyze-time concern.
