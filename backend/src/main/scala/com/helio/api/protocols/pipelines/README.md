# Protocols — Pipelines

Pipeline, pipeline-step, pipeline-schedule, pipeline-shape and
pipeline-analyze request/response protocol types, plus
`PipelineStepConfigCodec` (typed per-step config JSON codec). The DataType
family's protocol (`DataTypeProtocol`) was deleted in HEL-904 -- pipelines
are now consumed via `Output`s (see `PanelProtocol`'s `OutputConfig`), not
DataTypes.

Holds: `PipelineAnalyzeProposalProtocol`, `PipelineAnalyzeProtocol`,
`PipelineProposalProtocol`, `PipelineProtocol`, `PipelineScheduleProtocol`,
`PipelineShapeProtocol`, `PipelineStepConfigCodec`, `PipelineStepProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/pipelines/`.
