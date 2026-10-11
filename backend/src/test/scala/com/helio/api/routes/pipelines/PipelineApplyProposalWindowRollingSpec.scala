package com.helio.api.routes.pipelines

import com.helio.testkit.WindowRollingRejectionCases.{invalid, valid}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1489: `POST /api/pipelines/apply-proposal` rejects an invalid rolling-frame `window` step config with 422,
 *  the exact frame message under the proposal's own `step 1: ` prefix, and creates no pipeline or step; a valid
 *  rolling config is accepted (201) so every 422 is attributable to the frame rule. */
class PipelineApplyProposalWindowRollingSpec extends PipelineApplyProposalSpecBase {

  private def body(name: String, config: JsObject): String =
    JsObject(
      "pipelineName" -> JsString(name),
      "roots"        -> JsArray(JsObject("sourceId" -> JsString(existingSourceId))),
      "steps"        -> JsArray(JsObject("clientId" -> JsString("w1"), "type" -> JsString("window"), "config" -> config))
    ).compactPrint

  "POST /api/pipelines/apply-proposal with a window step" should {
    invalid.foreach { c =>
      s"reject ${c.label} with 422 `step 1: <frame message>` and create nothing" in {
        val pipelines = pipelineCount()
        val steps     = pipelineStepCount()
        apply(body(s"Window ${c.label}", c.config)) ~> routes ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val msg = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]
          msg should startWith("step 1: ")
          msg should include(c.message)
        }
        pipelineCount() shouldBe pipelines
        pipelineStepCount() shouldBe steps
      }
    }

    "accept a valid rolling config and create the pipeline and step" in {
      val pipelines = pipelineCount()
      val steps     = pipelineStepCount()
      apply(body("Window valid rolling", valid)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      pipelineCount() shouldBe (pipelines + 1)
      pipelineStepCount() shouldBe (steps + 1)
    }
  }
}
