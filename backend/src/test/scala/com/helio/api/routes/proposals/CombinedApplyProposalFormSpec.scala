package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** HEL-1148: a `form` panel in a combined proposal must be source-bound, and a bad source binding
 *  must be rejected BEFORE the pipeline phase writes anything (design.md D4 "Combined proposal
 *  atomicity") — the test proves no pipeline/source/dashboard/panel remains. */
class CombinedApplyProposalFormSpec extends CombinedApplyProposalSpecBase {

  private def combined(formPanel: String): String =
    s"""{
       |  "pipeline": {
       |    "pipelineName": "Form Combined Pipeline",
       |    "roots":[{"type":"static","name":"Form Combined Static",
       |      "config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}}],
       |    "steps": [],
       |    "outputs": [{"kind":"table","name":"Form Combined Output"}]
       |  },
       |  "dashboard": {
       |    "dashboardName": "Form Combined Dashboard",
       |    "panels": [
       |      {"title":"Total","type":"output","outputId":"$$pipelineOutput"},
       |      $formPanel
       |    ]
       |  }
       |}""".stripMargin

  private def form(binding: String): String =
    s"""{"title":"Order Form","type":"form"$binding,
       |"config":{"fields":[{"sourceField":"quantity","control":"number","step":1,"required":true}],"submit":{"writeMode":"append"}}}"""
      .stripMargin

  private def assertRejectedWithNothingCreated(body: String, mention: String): Unit = {
    val sources    = dataSourceCount()
    val pipelines  = pipelineCount()
    val steps      = pipelineStepCount()
    val dashboards = dashboardCount()
    val panels     = panelCount()
    apply(body) ~> routes ~> check {
      status shouldBe StatusCodes.BadRequest
      responseAs[String] should include(mention)
    }
    dataSourceCount() shouldBe sources
    pipelineCount() shouldBe pipelines
    pipelineStepCount() shouldBe steps
    dashboardCount() shouldBe dashboards
    panelCount() shouldBe panels
  }

  "POST /api/proposals/apply with a form panel" should {

    "create a bound form alongside a sentinel-bound output panel" in {
      val panels = panelCount()
      apply(combined(form(s""","dataSourceId":"$ownDatasetSourceId""""))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val created = responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject
          .fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val formPanel = created.find(_.fields("title").convertTo[String] == "Order Form").get
        formPanel.fields("config").asJsObject.fields("dataSourceId") shouldBe JsString(ownDatasetSourceId)
      }
      panelCount() shouldBe (panels + 2)
    }

    "reject a form with no dataSourceId before any pipeline is written" in
      assertRejectedWithNothingCreated(combined(form("")), "panel 2 ('Order Form'): a form panel requires a dataSourceId")

    "reject another tenant's source before any pipeline is written" in
      assertRejectedWithNothingCreated(combined(form(s""","dataSourceId":"$otherUserSourceId"""")), "Data source not found")

    "reject a nonexistent source before any pipeline is written" in
      assertRejectedWithNothingCreated(combined(form(s""","dataSourceId":"${UUID.randomUUID()}"""")), "Data source not found")
  }
}
