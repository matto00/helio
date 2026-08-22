package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-624 task 5.6 — `POST /api/dashboards/apply-proposal` rejects a chart
 *  panel combining `chartType: "scatter"` with a present `aggregation`,
 *  whether supplied via the flat `aggregation` field OR via the generic
 *  `config` passthrough (HEL-316) — the exact bypass design.md's round-2
 *  design-gate finding identified and closed by checking the
 *  `buildCreateRequest`-resolved config, not the flat field alone. Mirrors
 *  `DashboardApplyProposalConfigSpec`'s existing `chartOptions`-passthrough
 *  test pattern. Shares the fixture via `ApplyProposalSpecBase`. */
class DashboardApplyProposalAggregationSpec extends ApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal" should {

    "reject a scatter+aggregation chart panel via the flat aggregation field — 400, zero writes" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Scatter Flat Aggregation",
           |  "panels": [
           |    {"title":"Scatter","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{}, "chartType":"scatter",
           |     "aggregation":{"groupBy":"region","agg":"sum","yField":"region"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("aggregation is not supported for scatter charts")
      }
      dashboardCount() shouldBe before
    }

    "reject a scatter+aggregation chart panel via the config passthrough — 400, zero writes" in {
      val before = dashboardCount()
      // `aggregation` supplied ONLY via the generic `config` passthrough (not
      // the flat field) — the bypass a flat-field-only check would miss.
      val body =
        s"""{
           |  "dashboardName": "Scatter Config Passthrough",
           |  "panels": [
           |    {"title":"Scatter","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{}, "chartType":"scatter",
           |     "config":{"aggregation":{"groupBy":"region","agg":"sum","yField":"region"}}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("aggregation is not supported for scatter charts")
      }
      dashboardCount() shouldBe before
    }

    "accept a scatter chart panel with no aggregation (regression)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Scatter No Aggregation",
           |  "panels": [
           |    {"title":"Scatter","type":"chart","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{}, "chartType":"scatter"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      dashboardCount() shouldBe (before + 1)
    }
  }
}
