package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** HEL-1148: an agent-proposed `form` panel carries a first-class `dataSourceId` through
 *  `POST /api/dashboards/apply-proposal` and `PUT /api/dashboards/:id/contents`, arrives bound and
 *  able to submit (AC1), and an unbound/invalid/misplaced source binding is rejected loudly with
 *  nothing created (AC2). */
class DashboardApplyProposalFormSpec extends ApplyProposalSpecBase {

  private val fieldsJson =
    """[{"sourceField":"quantity","control":"number","step":1,"required":true},
      | {"sourceField":"note","control":"text"}]""".stripMargin.replaceAll("\n", "")

  private def formPanel(binding: String, extra: String = ""): String =
    s"""{"title":"Order Form","type":"form"$binding,
       |"config":{"fields":$fieldsJson,"submit":{"writeMode":"append"}$extra}}""".stripMargin

  private def proposal(panelJson: String, name: String = "Form Proposal"): String =
    s"""{"dashboardName":"$name","panels":[$panelJson]}"""

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def putContents(dashboardId: String, body: String) =
    Put(s"/api/dashboards/$dashboardId/contents", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  private def submit(panelId: String, body: String) =
    Post(s"/api/panels/$panelId/submit", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  /** Applies `body` and asserts a 400 that names `mention`, creating no dashboard and no panel. */
  private def assertRejected(body: String, mention: String): Unit = {
    val dashboards = dashboardCount()
    val panels     = totalPanelCount()
    apply(body) ~> routes ~> check {
      status shouldBe StatusCodes.BadRequest
      responseAs[String] should include(mention)
    }
    dashboardCount() shouldBe dashboards
    totalPanelCount() shouldBe panels
  }

  "POST /api/dashboards/apply-proposal with a form panel" should {

    "round-trip dataSourceId and submit a row end to end (AC1)" in {
      val body = proposal(formPanel(s""","dataSourceId":"$datasetSourceId","layout":{"x":0,"y":0,"w":6,"h":4}"""))
      val rowsBefore = datasetRowCount(datasetSourceId)
      val panelId = apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj   = responseAs[String].parseJson.asJsObject
        val panel = obj.fields("panels").convertTo[Vector[JsValue]].head.asJsObject
        panel.fields("config").asJsObject.fields("dataSourceId") shouldBe JsString(datasetSourceId)
        // HEL-1071 layout validation still holds with a form panel in the proposal.
        val layout = obj.fields("dashboard").asJsObject.fields("layout").asJsObject
        layout.fields("lg").convertTo[Vector[JsValue]] should have size 1
        panel.fields("id").convertTo[String]
      }
      submit(panelId, """{"values":{"quantity":3,"note":"hello"}}""") ~> routes ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      datasetRowCount(datasetSourceId) shouldBe (rowsBefore + 1)
    }

    "make the flat dataSourceId authoritative over a conflicting config.dataSourceId" in {
      val body = proposal(formPanel(s""","dataSourceId":"$datasetSourceId"""", s""","dataSourceId":"$otherDatasetSourceId""""))
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panel = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].head.asJsObject
        panel.fields("config").asJsObject.fields("dataSourceId") shouldBe JsString(datasetSourceId)
      }
    }

    "reject a form with no dataSourceId, naming the flat dataSourceId and the panel" in
      assertRejected(proposal(formPanel("")), "panel 1 ('Order Form'): a form panel requires a dataSourceId")

    "reject a config-only form binding (the flat dataSourceId is the one source of truth)" in
      assertRejected(proposal(formPanel("", s""","dataSourceId":"$datasetSourceId"""")), "a form panel requires a dataSourceId")

    "reject another tenant's dataset source" in
      assertRejected(proposal(formPanel(s""","dataSourceId":"$otherDatasetSourceId"""")), "Data source not found")

    "reject a nonexistent source with the same error as a foreign one (no existence oracle)" in
      assertRejected(proposal(formPanel(s""","dataSourceId":"${UUID.randomUUID()}"""")), "Data source not found")

    "reject a non-dataset (csv) source" in
      assertRejected(proposal(formPanel(s""","dataSourceId":"$csvSourceId"""")), "dataset")

    "reject a form field the bound dataset does not declare (schema consistency, never weaker than create)" in {
      val bad = s"""{"title":"Bad","type":"form","dataSourceId":"$datasetSourceId",
                   |"config":{"fields":[{"sourceField":"nope","control":"text"}],"submit":{"writeMode":"append"}}}""".stripMargin
      assertRejected(proposal(bad), "nope")
    }

    "reject a form carrying both dataSourceId and outputId" in
      assertRejected(proposal(formPanel(s""","dataSourceId":"$datasetSourceId","outputId":"$pipelineOutputId"""")), "a form panel binds a dataSourceId, not an outputId")

    "reject dataSourceId on a non-source-bound panel kind" in
      assertRejected(
        proposal(s"""{"title":"Total","type":"output","outputId":"$pipelineOutputId","dataSourceId":"$datasetSourceId"}"""),
        "dataSourceId is only supported on a form panel"
      )
  }

  "PUT /api/dashboards/:id/contents with a form panel" should {

    "apply a bound form and leave a rejected one's dashboard untouched" in {
      val dashboardId = createDashboard("Contents Form Target")
      putContents(dashboardId, s"""{"panels":[${formPanel(s""","dataSourceId":"$datasetSourceId"""")}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val panel = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].head.asJsObject
        panel.fields("config").asJsObject.fields("dataSourceId") shouldBe JsString(datasetSourceId)
      }
      val titlesBefore = panelTitlesForDashboard(dashboardId)
      putContents(dashboardId, s"""{"panels":[${formPanel("")}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("dataSourceId")
      }
      putContents(dashboardId, s"""{"panels":[${formPanel(s""","dataSourceId":"$otherDatasetSourceId"""")}]}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      panelTitlesForDashboard(dashboardId) shouldBe titlesBefore
    }
  }
}
