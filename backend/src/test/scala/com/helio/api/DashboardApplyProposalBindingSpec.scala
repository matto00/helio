package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.UUID

/** DataType-binding coverage for `POST /api/dashboards/apply-proposal`:
 *  companion-binding (V41) / unknown / cross-user rejections on the flat
 *  proposal path, plus the HEL-316 text/markdown `config.dataTypeId` binding
 *  (which has no flat `dataTypeId` field). Every rejection is atomic — nothing
 *  is created. Shares the fixture via ApplyProposalSpecBase. */
class DashboardApplyProposalBindingSpec extends ApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal" should {

    "reject binding a source-companion DataType and create nothing (V41, atomic)" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"metric","dataTypeId":"$companionTypeId","fieldMapping":{"value":"region"}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("pipeline-output")
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
           |  {"title":"X","type":"metric","dataTypeId":"$otherUserTypeId","fieldMapping":{}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("not found")
      }
      dashboardCount() shouldBe before
    }

    // ── HEL-316 round-2 (skeptic-refuted V41 gap) ──────────────────────────
    // text/markdown panels have no flat `dataTypeId` field (unlike
    // metric/chart/table/collection) — their binding, if any, lives ONLY in
    // `config.dataTypeId` (HEL-244). `mergeConfig` therefore never re-applies
    // anything for them, so this must be validated by a DIFFERENT mechanism:
    // `preValidateBindings`' `bindingCandidate`/`nonFlatConfigDataTypeId`
    // (up front, atomic) and `PanelService.create`'s `rejectCompanionBinding`
    // (via the now-fixed `PanelServiceHelpers.dataTypeIdFromCreateConfig`).
    // These mirror the metric companion-binding test above (line ~252) and
    // the "keep the flat dataTypeId authoritative" test above, but for
    // text/markdown's config-only binding.

    "reject a TEXT panel binding a source-companion DataType via config.dataTypeId and create nothing (HEL-316, V41)" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"Rogue Text","type":"text","config":{"dataTypeId":"$companionTypeId"}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("pipeline-output")
      }
      dashboardCount() shouldBe before
    }

    "reject a MARKDOWN panel binding a source-companion DataType via config.dataTypeId and create nothing (HEL-316, V41)" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"Rogue Markdown","type":"markdown","config":{"dataTypeId":"$companionTypeId"}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("pipeline-output")
      }
      dashboardCount() shouldBe before
    }

    "apply a TEXT panel bound to a valid pipeline-output DataType via config.dataTypeId (HEL-316)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Text Binding",
           |  "panels": [
           |    {"title":"Bound Text","type":"text",
           |     "config":{"dataTypeId":"$pipelineOutputTypeId","fieldMapping":{"content":"region"}}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Bound Text").get
        val config = panel.fields("config").asJsObject
        config.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
        config.fields("fieldMapping").asJsObject.fields("content").convertTo[String] shouldBe "region"
      }
      dashboardCount() shouldBe (before + 1)
    }

    "apply a MARKDOWN panel bound to a valid pipeline-output DataType via config.dataTypeId (HEL-316)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Markdown Binding",
           |  "panels": [
           |    {"title":"Bound Markdown","type":"markdown",
           |     "config":{"dataTypeId":"$pipelineOutputTypeId","fieldMapping":{"content":"region"}}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Bound Markdown").get
        val config = panel.fields("config").asJsObject
        config.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
        config.fields("fieldMapping").asJsObject.fields("content").convertTo[String] shouldBe "region"
      }
      dashboardCount() shouldBe (before + 1)
    }

    "reject a TEXT panel binding an unknown DataType via config.dataTypeId and create nothing (HEL-316)" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Bad","panels":[
           |  {"title":"X","type":"text","config":{"dataTypeId":"${UUID.randomUUID()}"}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      dashboardCount() shouldBe before
    }
  }
}
