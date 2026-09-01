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

// HEL-907 task 1.1: `outputDataTypeName` dropped outright (no alias) -- it was a pure echo of
// PipelineProposal's now-removed same-named field; PipelineProposal's `outputs[]` carries no
// single canonical name to echo back, and this dry-analyze response was never anything more
// than a courtesy echo (no caller derived behavior from it -- verified against every consumer
// of this response before removal).
final case class PipelineAnalyzeProposalResponse(
    sourceName:  String,
    sourceSchema: Vector[SchemaFieldResponse],
    steps:        Vector[AnalyzeStepResponse]
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
    jsonFormat3(PipelineAnalyzeProposalResponse.apply)
}
