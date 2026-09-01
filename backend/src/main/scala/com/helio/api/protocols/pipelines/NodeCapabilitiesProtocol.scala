package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.api.protocols.panels.{PanelCapabilityColumnResponse, PanelCapabilityProtocol, PanelCapabilityResponse}
import spray.json._

/** HEL-906 (P1.3, task 3.4) — response for `GET /api/pipelines/:id/capabilities?stepId=`,
 *  the node-scoped successor to the retired `GET /api/types/:id/panel-capabilities`
 *  (`PanelCapabilitiesResponse`, keyed by Output id). Reuses
 *  `PanelCapabilityColumnResponse`/`PanelCapabilityResponse` verbatim — both are already
 *  Output-kind-shaped and cross-domain-dependency-free (see `JsonProtocols.scala`'s
 *  `PanelCapabilityProtocol` note); this response differs only in being keyed by `stepId`
 *  (a specific pipeline node's projected schema, from
 *  `PipelineAnalyzeService.analyzeNodes` — task 3.3) rather than by a persisted Output. */
final case class NodeCapabilitiesResponse(
    stepId: Option[String],
    columns: Vector[PanelCapabilityColumnResponse],
    capabilities: NodeCapabilitiesResponse.Capabilities
)

object NodeCapabilitiesResponse {
  type Capabilities = Map[String, PanelCapabilityResponse]
}

/** `POST /api/pipelines/:id/validate-expression?stepId=` request body (HEL-906 cycle 7). */
final case class ValidateExpressionRequest(expression: String)

/** `POST /api/pipelines/:id/validate-expression?stepId=` response (HEL-906 cycle 7). `valid`
 *  mirrors `ExpressionEvaluator.validate`'s `Either` collapsed to a boolean; `error` carries
 *  the same message `Left` would, present only when `valid = false`. */
final case class ExpressionValidationResponse(valid: Boolean, error: Option[String])

trait NodeCapabilitiesProtocol extends SprayJsonSupport with DefaultJsonProtocol with PanelCapabilityProtocol {
  implicit val nodeCapabilitiesResponseFormat: RootJsonFormat[NodeCapabilitiesResponse] = jsonFormat3(NodeCapabilitiesResponse.apply)
  implicit val validateExpressionRequestFormat: RootJsonFormat[ValidateExpressionRequest] = jsonFormat1(ValidateExpressionRequest.apply)
  implicit val expressionValidationResponseFormat: RootJsonFormat[ExpressionValidationResponse] = jsonFormat2(ExpressionValidationResponse.apply)
}
