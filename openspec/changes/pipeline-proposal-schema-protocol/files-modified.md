- `schemas/pipeline-proposal.schema.json` — new JSON Schema 2020-12 defining `PipelineProposal`
  (`pipelineName`, `source`, `outputDataTypeName`, `steps`), with `$defs` for
  `PipelineProposalSource` (existing `sourceId` OR inline `type`/`name`/`config`, `type` enum'd to
  `csv|rest_api|sql|static`) and `PipelineProposalStep` (`type`/`config`, `type` left unconstrained
  per design.md D3).
- `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala` — new file. Adds
  `PipelineProposalSource` (flat `Option`-per-kind fields: `csvConfig`/`restConfig`/`sqlConfig`/
  `staticConfig`, reusing `DataSourceProtocol`'s payload types) and `PipelineProposal` (reuses
  `CreatePipelineStepRequest` verbatim for `steps`, per design.md D2) case classes, plus a
  hand-written `RootJsonFormat` for each mirroring `DashboardProposalProtocol.proposalPanelFormat`'s
  write-omits-absent-keys / read-tolerates-absent-keys style. The source formatter serializes all
  four per-kind config fields through one shared `"config"` wire key selected by `type` (design.md
  D1/D5), never through four separately-named keys.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed `PipelineProposalProtocol` into
  the `JsonProtocols` aggregator trait stack (alongside `DashboardProposalProtocol`) and documented
  the new trait's cross-domain dependency (`DataSourceProtocol with PipelineStepProtocol`) in the
  existing inter-trait-dependency doc comment.
- `backend/src/test/scala/com/helio/api/protocols/PipelineProposalProtocolSpec.scala` — new
  ScalaTest spec (mirrors `DashboardProposalProtocolSpec`'s structure): round-trip for an
  existing-`sourceId` proposal, round-trip for an inline-`sql`-source proposal, absent-optional-field
  read tolerance, absent-optional-field write omission (no `null` on the wire), a required-field-
  missing `deserializationError`, `steps` round-tripping via the unchanged `CreatePipelineStepRequest`
  wire shape (single + multiple, order-preserving), and an explicit assertion that the inline
  source's wire shape has a single `config` key (not `csvConfig`/`sqlConfig`/etc.).
