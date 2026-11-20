package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1696: the `run` embedded in `POST /api/pipelines/apply-proposal` is a 10-row preview with the true total and an
 *  explicit cut flag, not every terminal row. */
class PipelineApplyProposalRunCapSpec extends PipelineApplyProposalSpecBase {

  private def proposal(rowCount: Int): String = {
    val rows = (1 to rowCount).map(i => s"""["r$i"]""").mkString(",")
    s"""{"pipelineName":"Cap Pipeline $rowCount",
       |"roots":[{"type":"static","name":"Cap Static $rowCount","config":{"columns":[{"name":"name","type":"string"}],"rows":[$rows]}}],
       |"steps":[],"outputs":[{"kind":"table","name":"Cap Output"}]}""".stripMargin
  }

  "POST /api/pipelines/apply-proposal" should {

    "embed a 10-row run preview with the full total and rowsTruncated when the run has 25 rows" in {
      apply(proposal(25)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val run = responseAs[String].parseJson.asJsObject.fields("run").asJsObject
        run.fields("rows").convertTo[Vector[JsValue]] should have size 10
        run.fields("rowCount").convertTo[Int] shouldBe 25
        run.fields("rowsTruncated") shouldBe JsBoolean(true)
      }
    }

    "report rowsTruncated false for a run of exactly 10 rows" in {
      apply(proposal(10)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val run = responseAs[String].parseJson.asJsObject.fields("run").asJsObject
        run.fields("rows").convertTo[Vector[JsValue]] should have size 10
        run.fields("rowCount").convertTo[Int] shouldBe 10
        run.fields("rowsTruncated") shouldBe JsBoolean(false)
      }
    }
  }
}
