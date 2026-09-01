package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** DataType-binding coverage for `POST /api/dashboards/apply-proposal`:
 *  companion-binding (V41) / unknown / cross-user rejections on the flat
 *  proposal path. Every rejection is atomic — nothing is created. Shares the
 *  fixture via ApplyProposalSpecBase.
 *
 *  HEL-904 task 4.1: the HEL-316 text/markdown `config.dataTypeId` binding
 *  scenarios are removed — Text/Markdown's data-bound "Source mode" no
 *  longer exists. */
class DashboardApplyProposalBindingSpec extends ApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal" should {

    // HEL-904 task 3.8/3.9: an "output"-kind panel's binding now validates
    // against a real Output (OutputRepository), not a DataType — there is no
    // "companion" concept for Outputs (that distinction was DataType-only,
    // keyed on `sourceId.isDefined`). A DataType id (of ANY kind) simply
    // doesn't resolve as an Output, so the rejection here is an ordinary
    // not-found, not the old companion-specific message.
    "reject an \"output\" panel bound to a DataType id (not an Output id) and create nothing" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"output","dataTypeId":"$companionTypeId"}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      dashboardCount() shouldBe before
    }

    "reject an unknown DataType and create nothing" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"chart","dataTypeId":"${UUID.randomUUID()}","fieldMapping":{}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      dashboardCount() shouldBe before
    }

    "reject a cross-user DataType under RLS (not found) and create nothing" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"output","dataTypeId":"$otherUserTypeId","fieldMapping":{}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      dashboardCount() shouldBe before
    }

    // HEL-904 task 4.1: the HEL-316 `config.dataTypeId` text/markdown binding
    // scenarios (reject-companion x2, apply-valid x2, reject-unknown) are
    // removed outright — Text/Markdown's data-bound "Source mode" no longer
    // exists, so `config.dataTypeId` on a text/markdown proposal panel is
    // now inert (silently ignored, never validated or echoed back).

    "create a literal TEXT panel, silently ignoring an inert config.dataTypeId (no longer a binding)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Text Binding",
           |  "panels": [
           |    {"title":"Literal Text","type":"text",
           |     "config":{"dataTypeId":"$pipelineOutputTypeId","content":"Hello"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Literal Text").get
        val config = panel.fields("config").asJsObject
        config.fields.contains("dataTypeId") shouldBe false
        config.fields("content").convertTo[String] shouldBe "Hello"
      }
      dashboardCount() shouldBe (before + 1)
    }
  }
}
