package com.helio.api

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

    "create a collection panel with baseType/layout from proposal config (HEL-316)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Collection Config",
           |  "panels": [
           |    {"title":"Top movers","type":"collection","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"},
           |     "config":{"baseType":"metric","layout":"list"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Top movers").get
        val config = panel.fields("config").asJsObject
        config.fields("baseType").convertTo[String] shouldBe "metric"
        config.fields("layout").convertTo[String] shouldBe "list"
        config.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
      }
      dashboardCount() shouldBe (before + 1)
    }

    "persist chart chartOptions from proposal config (HEL-316)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Chart Options",
           |  "panels": [
           |    {"title":"Smooth line","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{},
           |     "config":{"chartOptions":{"line":{"smooth":true}}}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Smooth line").get
        val config = panel.fields("config").asJsObject
        config.fields("chartOptions").asJsObject.fields("line").asJsObject.fields("smooth") shouldBe JsBoolean(true)
      }
      dashboardCount() shouldBe (before + 1)
    }

    "persist table density/columnOrder from proposal config (HEL-316)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Table Config",
           |  "panels": [
           |    {"title":"Sales table","type":"table","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{},
           |     "config":{"density":"condensed","columnOrder":["region"]}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Sales table").get
        val config = panel.fields("config").asJsObject
        config.fields("density").convertTo[String] shouldBe "condensed"
        config.fields("columnOrder").convertTo[Vector[String]] shouldBe Vector("region")
      }
      dashboardCount() shouldBe (before + 1)
    }

    // D2: config must NOT be able to clobber the flat-field dataTypeId — the
    // pipeline-only binding rule (V41) is enforced against the FLAT field
    // (preValidateBindings), so config's dataTypeId is silently ignored and the
    // flat value remains authoritative on the created panel.
    "keep the flat dataTypeId authoritative when config attempts to override it (HEL-316, V41)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Bypass Attempt",
           |  "panels": [
           |    {"title":"Total","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"},
           |     "config":{"dataTypeId":"$companionTypeId"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
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
           |    {"title":"Total","type":"metric","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"value":"region"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject shouldBe JsObject(
          "dataTypeId"   -> JsString(pipelineOutputTypeId),
          "fieldMapping" -> JsObject("value" -> JsString("region"))
        )
      }
      dashboardCount() shouldBe (before + 1)
    }
  }
}
