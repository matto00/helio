package com.helio.services.ask

import com.helio.api.protocols.ask.AskPin
import com.helio.domain.model.{AuthenticatedUser, Output, OutputKind, ResourceAccess}
import com.helio.domain.outputs.InsightConfig
import com.helio.services.auth.AccessChecker
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1745 D10: the hand-off body for creating an insight Output from an answer. Never renders and never stores answer
 *  text. Non-null only when every cited Output is on ONE pipeline the caller can edit and 1..8 non-insight Outputs remain. */
class AskPinBuilder(accessChecker: AccessChecker)(implicit ec: ExecutionContext) {

  val MaxNameChars: Int = 80

  /** `cited` is in order of first citation. */
  def build(question: String, cited: Vector[Output], user: AuthenticatedUser): Future[Option[AskPin]] = {
    val pipelines = cited.map(_.node.pipelineId.value).distinct
    val reads     = cited.filter(_.kind != OutputKind.Insight).map(_.id.value).distinct
    if (cited.isEmpty || pipelines.size != 1 || reads.isEmpty || reads.size > InsightConfig.MaxReadOutputs) Future.successful(None)
    else {
      val pipelineId = pipelines.head
      accessChecker.requireAccess("pipeline", pipelineId, Some(user), "Pipeline not found").map {
        case Right(ResourceAccess.Owner) | Right(ResourceAccess.Editor) => Some(AskPin(pipelineId, request(question, cited.head, reads)))
        case _                                                         => None
      }
    }
  }

  private def request(question: String, first: Output, reads: Vector[String]): JsObject = {
    // A stored Output always has a step or a root id (V98's CHECK). With neither (an in-memory Output only) the node is omitted, never
    // guessed: a pipeline id names no root created since V98, so the create route binds the pipeline's single root or names the problem.
    val node: Option[(String, JsValue)] = first.node.stepId.map(s => "nodeStepId" -> JsString(s.value))
      .orElse(first.node.rootId.map(r => "rootId" -> JsString(r.value)))
    JsObject(
      node.toMap ++ Map[String, JsValue](
        "kind" -> JsString("insight"),
        "name" -> JsString(question.take(MaxNameChars).trim),
        "config" -> JsObject(
          "prompt"  -> JsString(question),
          "reads"   -> JsObject("outputs" -> JsArray(reads.map(id => JsString(id): JsValue))),
          "refresh" -> JsString("manual")
        )
      )
    )
  }
}
