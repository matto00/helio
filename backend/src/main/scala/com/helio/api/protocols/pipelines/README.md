# Protocols — Pipelines

Pipeline, pipeline-step, pipeline-schedule, pipeline-shape, pipeline-analyze and the DataType family's request/response protocol types, plus `PipelineStepConfigCodec` (typed per-step config JSON codec).

Holds: `DataTypeProtocol`, `PipelineAnalyzeProposalProtocol`, `PipelineAnalyzeProtocol`, `PipelineProposalProtocol`, `PipelineProtocol`, `PipelineScheduleProtocol`, `PipelineShapeProtocol`, `PipelineStepConfigCodec`, `PipelineStepProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/pipelines/`.
