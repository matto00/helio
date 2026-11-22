package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** One pipeline's entry in `GET /api/pipelines/context-analyze` (HEL-1625): the `steps` and `warnings` of
 *  `GET /api/pipelines/:id/analyze` for that pipeline and the same caller, typed and serialized by the SAME
 *  response types and formats, so per-field equality with the per-pipeline route holds by construction. */
final case class PipelineContextAnalyzeItem(
    pipelineId: String,
    steps: Vector[AnalyzeStepResponse],
    warnings: Vector[AnalyzeWarningResponse]
)

/** `GET /api/pipelines/context-analyze` body: at most one item per pipeline `GET /api/pipelines` returns for the
 *  same caller, in the same order. A pipeline whose analysis could not be produced is omitted. */
final case class PipelineContextAnalyzeResponse(items: Vector[PipelineContextAnalyzeItem])

/** Extends [[PipelineAnalyzeProtocol]] for the step and warning formats it owns. */
trait PipelineContextAnalyzeProtocol extends SprayJsonSupport with DefaultJsonProtocol with PipelineAnalyzeProtocol {
  implicit val pipelineContextAnalyzeItemFormat: RootJsonFormat[PipelineContextAnalyzeItem] =
    jsonFormat3(PipelineContextAnalyzeItem.apply)
  implicit val pipelineContextAnalyzeResponseFormat: RootJsonFormat[PipelineContextAnalyzeResponse] =
    jsonFormat1(PipelineContextAnalyzeResponse.apply)
}
