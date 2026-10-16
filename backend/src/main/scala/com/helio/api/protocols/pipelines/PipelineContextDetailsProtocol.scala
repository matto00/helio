package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** One pipeline's entry in `GET /api/pipelines/context-details` (HEL-1619). `steps` are the same
 *  elements `GET /api/pipelines/:id/steps` returns; `latestRunAssertions` is the same value as the
 *  first entry of `GET /api/pipelines/:id/run-history`'s `assertions`, and is absent (spray-json
 *  omits `None`) for a pipeline that has never run. */
final case class PipelineContextDetailsItem(
    pipelineId: String,
    steps: Vector[PipelineStepResponse],
    latestRunAssertions: Option[AssertionSummary]
)

/** `GET /api/pipelines/context-details` body: one item per pipeline `GET /api/pipelines` returns
 *  for the same caller, in the same order. */
final case class PipelineContextDetailsResponse(items: Vector[PipelineContextDetailsItem])

/** Extends [[PipelineProtocol]] for the step and assertion-summary formats it owns. */
trait PipelineContextDetailsProtocol extends SprayJsonSupport with DefaultJsonProtocol with PipelineProtocol {
  implicit val pipelineContextDetailsItemFormat: RootJsonFormat[PipelineContextDetailsItem] =
    jsonFormat3(PipelineContextDetailsItem.apply)
  implicit val pipelineContextDetailsResponseFormat: RootJsonFormat[PipelineContextDetailsResponse] =
    jsonFormat1(PipelineContextDetailsResponse.apply)
}
