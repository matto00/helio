package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// `POST /api/pipelines/analyze-proposal` projects the output schema of a
// not-yet-created `PipelineProposal` (HEL-379) — no id/outputDataTypeId
// exist yet, since nothing is persisted (design.md D4). `sourceSchema` and
// `steps` reuse `SchemaFieldResponse`/`AnalyzeStepResponse` (and its
// `analyzeStepResponseFormat`) verbatim from `PipelineAnalyzeProtocol` — the
// same discriminated-union wire shape `GET /:id/analyze` already emits.

final case class PipelineAnalyzeProposalResponse(
    sourceName:         String,
    outputDataTypeName: String,
    sourceSchema:        Vector[SchemaFieldResponse],
    steps:               Vector[AnalyzeStepResponse]
)

/** `PipelineAnalyzeProposalProtocol extends PipelineAnalyzeProtocol` to reuse
 *  `SchemaFieldResponse` (via `PipelineAnalyzeProtocol`'s own `DataTypeProtocol`
 *  dependency) and `analyzeStepResponseFormat`/`AnalyzeStepResponse` verbatim —
 *  no second, divergent step-response format. */
trait PipelineAnalyzeProposalProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with PipelineAnalyzeProtocol {

  implicit val pipelineAnalyzeProposalResponseFormat: RootJsonFormat[PipelineAnalyzeProposalResponse] =
    jsonFormat4(PipelineAnalyzeProposalResponse.apply)
}
