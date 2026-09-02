package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-316 v1.5 `config` passthrough parity for
 *  `POST /api/dashboards/apply-proposal`: the generic `config` object is merged
 *  over the flat-field-derived config and decoded by the same PanelConfigCodec
 *  path as any other panel create (design.md D1-D3) — collection baseType/layout,
 *  chart chartOptions, table density/columnOrder, the flat-field-authoritative
 *  rule, and the no-config regression. Shares the fixture via
 *  ApplyProposalSpecBase. */
class DashboardApplyProposalConfigSpec extends ApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal" should {

    // ── HEL-316: generic `config` passthrough merged over the flat-field ──────
    // derived config, decoded by the same PanelConfigCodec path as any other
    // panel create (design.md D1-D3).

    // HEL-904: collection/chart/table config-passthrough tests removed -- those panel kinds no longer exist.

    // D2: config must NOT be able to clobber the flat-field outputId — the
    // pipeline-only binding rule (V41) is enforced against the FLAT field
    // (preValidateBindings), so config's outputId is silently ignored and the
    // flat value remains authoritative on the created panel.
    // HEL-904 task 3.8/3.9: an "output"-kind panel's flat binding field is
    // still named `outputId` on the wire (schema stability), but its
    // authoritative-after-merge key on the CREATED panel's config is
    // `outputId` — `fieldMapping` no longer exists on an Output panel (the
    // Output itself owns field mapping).
    "keep the flat outputId authoritative when config attempts to override it (HEL-316, V41)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Bypass Attempt",
           |  "panels": [
           |    {"title":"Total","type":"output","outputId":"$pipelineOutputId",
           |     "config":{"outputId":"$companionTypeId"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields("outputId").convertTo[String] shouldBe pipelineOutputId
      }
      dashboardCount() shouldBe (before + 1)
    }

    // Regression: a proposal with no `config` field produces byte-for-byte the
    // same created-panel config as before this change — merge is a no-op when
    // `config` is absent.
    "apply a flat-field-only proposal (no config) unchanged (HEL-316 regression)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Flat Only",
           |  "panels": [
           |    {"title":"Total","type":"output","outputId":"$pipelineOutputId"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject shouldBe JsObject("outputId" -> JsString(pipelineOutputId))
      }
      dashboardCount() shouldBe (before + 1)
    }
  }
}
