package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1696: the pipeline `run` embedded in `POST /api/proposals/apply` is a 10-row preview with the full total and an
 *  explicit cut flag. */
class CombinedApplyProposalRunCapSpec extends CombinedApplyProposalSpecBase {

  "POST /api/proposals/apply" should {

    "embed a 10-row run preview with the full total and rowsTruncated when the run has 25 rows" in {
      val rows = (1 to 25).map(i => s"""["r$i"]""").mkString(",")
      val body =
        s"""{
           |  "pipeline": {
           |    "pipelineName": "Cap Combined Pipeline",
           |    "roots":[{"type":"static","name":"Cap Combined Static",
           |      "config":{"columns":[{"name":"name","type":"string"}],"rows":[$rows]}}],
           |    "steps": [],
           |    "outputs": [{"kind":"table","name":"Cap Combined Output"}]
           |  },
           |  "dashboard": {
           |    "dashboardName": "Cap Combined Dashboard",
           |    "panels": [{"title":"Total","type":"output","outputId":"$$pipelineOutput"}]
           |  }
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val run = responseAs[String].parseJson.asJsObject.fields("pipeline").asJsObject.fields("run").asJsObject
        run.fields("rows").convertTo[Vector[JsValue]] should have size 10
        run.fields("rowCount").convertTo[Int] shouldBe 25
        run.fields("rowsTruncated") shouldBe JsBoolean(true)
      }
    }
  }
}
