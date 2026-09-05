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
// HEL-914 task 2.5: `sourceName`/`sourceSchema` (singular) are REPLACED by
// `sourceSchemas: Vector[RootSourceSchemaResponse]` -- one entry per proposed root, in
// request order, matching the persisted-pipeline twin (`PipelineAnalyzeResponse.sourceSchemas`,
// `PipelineAnalyzeProtocol.scala:197-203`) so the two shapes cannot drift (design.md D4).
// HEL-914 task 6b.4a: reports EVERY proposed Output's fieldMapping validity, grounded at that
// Output's own target node (or, for a root-bound Output, that root's schema) -- never the
// pipeline trunk, and never a lane's terminal node when the Output actually sits on a rejoin.
// `validationError` mirrors `AnalyzeStepResponse.validationError`'s own present-only-when-invalid
// convention: `None` when the mapping is valid or absent.
final case class OutputAnalyzeResponse(
    name:            String,
    kind:            String,
    validationError: Option[String]
)

final case class PipelineAnalyzeProposalResponse(
    sourceSchemas: Vector[RootSourceSchemaResponse],
    steps:         Vector[AnalyzeStepResponse],
    outputs:       Vector[OutputAnalyzeResponse]
)

/** `PipelineAnalyzeProposalProtocol extends PipelineAnalyzeProtocol` to reuse
 *  `SchemaFieldResponse` (via `PipelineAnalyzeProtocol`'s own `DataTypeProtocol`
 *  dependency) and `analyzeStepResponseFormat`/`AnalyzeStepResponse` verbatim —
 *  no second, divergent step-response format. */
trait PipelineAnalyzeProposalProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with PipelineAnalyzeProtocol {

  implicit val outputAnalyzeResponseFormat: RootJsonFormat[OutputAnalyzeResponse] =
    jsonFormat3(OutputAnalyzeResponse.apply)

  implicit val pipelineAnalyzeProposalResponseFormat: RootJsonFormat[PipelineAnalyzeProposalResponse] =
    jsonFormat3(PipelineAnalyzeProposalResponse.apply)
}
