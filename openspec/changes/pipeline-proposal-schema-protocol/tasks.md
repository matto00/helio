## 1. Schema

- [x] 1.1 Add `schemas/pipeline-proposal.schema.json` (JSON Schema 2020-12): `PipelineProposal`
      requiring `pipelineName`, `source`, `outputDataTypeName`, `steps`; `$defs` for
      `PipelineProposalSource` (`sourceId` OR `type`/`name`/`config`, `type` enum
      `csv|rest_api|sql|static`) and `PipelineProposalStep` (`type`, `config`, `type` left
      unconstrained per design.md D3).

### Backend

- [x] 2.1 Add `PipelineProposalSource` and `PipelineProposal` case classes to a new
      `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala`, per
      design.md D1 (flat `Option`-per-kind Scala fields: `csvConfig`/`restConfig`/`sqlConfig`/
      `staticConfig`, reusing `CsvSourceConfigPayload`/`RestApiConfigPayload`/
      `SqlSourceConfigPayload`/`StaticDataPayload` from `DataSourceProtocol.scala`). These four
      fields are Scala-side only — on the wire they serialize through **one** shared `"config"`
      key (selected by `type`), never through four separately-named keys (design.md D1/D5).
- [x] 2.2 Add `PipelineProposal.steps: Vector[CreatePipelineStepRequest]`, reusing the existing type
      from `PipelineStepProtocol.scala` — no new step DTO (design.md D2).
- [x] 2.3 Write `PipelineProposalProtocol extends SprayJsonSupport with DefaultJsonProtocol with
      DataSourceProtocol with PipelineStepProtocol`: hand-written
      `RootJsonFormat[PipelineProposalSource]` and `RootJsonFormat[PipelineProposal]` mirroring
      `DashboardProposalProtocol.proposalPanelFormat`'s write-omits-absent-keys /
      read-tolerates-absent-keys style (design.md D5); `deserializationError` only for
      `pipelineName`/`outputDataTypeName`/`source`/`steps`. The source formatter's writer picks
      whichever of the four per-kind `Option` fields is populated and serializes it to the single
      `"config"` key; its reader dispatches on `type` to decode `"config"` into the matching field,
      leaving the other three `None` (design.md D1).
- [x] 2.4 Mix `PipelineProposalProtocol` into the trait stack in
      `backend/src/main/scala/com/helio/api/JsonProtocols.scala` alongside
      `DashboardProposalProtocol`.

### Tests

- [x] 3.1 Add `backend/src/test/scala/com/helio/api/protocols/PipelineProposalProtocolSpec.scala`
      mirroring `DashboardProposalProtocolSpec`'s structure.
- [x] 3.2 Test: round-trip a proposal whose `source` references an existing `sourceId`.
- [x] 3.3 Test: round-trip a proposal with an inline source (one kind, e.g. `sql` via `sqlConfig`).
- [x] 3.4 Test: reading tolerates every optional field absent (only required fields present) —
      resulting `Option` fields are `None`.
- [x] 3.5 Test: writing omits keys for absent `Option` fields (no `null` emitted on the wire).
- [x] 3.6 Test: a `steps` entry round-trips using the existing `CreatePipelineStepRequest` format
      unchanged (no divergence between `PipelineProposal`'s step wire shape and
      `add_pipeline_step`'s existing `{type, config}` shape).
- [x] 3.7 Test: for the inline-source case, assert the serialized JSON's `source` object has a
      single `config` key (not `csvConfig`/`sqlConfig`/etc.) — the protocol-vs-schema wire-shape
      check design.md D1/D5 depends on, so a future field-name regression fails a test instead of
      shipping silently.
- [x] 3.8 Run `sbt test` and confirm the full suite is green.
