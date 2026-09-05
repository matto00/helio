package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes

/** Rollback + short-circuit coverage for `POST /api/proposals/apply`
 *  (HEL-387, design.md D4) — split out of `CombinedApplyProposalSpec` to keep
 *  both files under the ~250-line soft budget.
 *
 *  Both cases assert `allCounts()` (data_sources/pipelines/pipeline_steps/
 *  data_types/dashboards/panels combined) is unchanged from immediately
 *  before the call — the DB-count-based proof design.md calls for, rather
 *  than trusting the error response alone. */
class CombinedApplyProposalRollbackSpec extends CombinedApplyProposalSpecBase {

  "POST /api/proposals/apply rollback" should {

    // HEL-904: this test's original failure trigger (a chart panel combining
    // an invalid `chartType` -- ChartPanel-specific validation, task 3.10a)
    // no longer exists; retargeted to an output panel missing its required
    // `dataTypeId` (`DataPanelKinds`, still a live rejection), preserving the
    // same rollback-on-dashboard-phase-failure assertion.
    "roll back the already-created pipeline and source when the dashboard phase fails" in {
      val before = allCounts()
      val body =
        """{
          |  "pipeline": {
          |    "pipelineName": "Rollback Pipeline",
          |    "roots":[{"type":"static","name":"Rollback Static",
          |      "config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}}],
          |    "outputDataTypeName": "Rollback Output",
          |    "steps": []
          |  },
          |  "dashboard": {
          |    "dashboardName": "Rollback Dashboard",
          |    "panels": [
          |      {"title":"Bad Output","type":"output"}
          |    ]
          |  }
          |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("outputid")
      }
      allCounts() shouldBe before
    }
  }

  "POST /api/proposals/apply pipeline-phase short-circuit" should {

    "reject non-SELECT SQL verbatim before ever attempting the dashboard phase" in {
      val before = allCounts()
      val body =
        """{
          |  "pipeline": {
          |    "pipelineName": "Bad Sql Pipeline",
          |    "roots":[{"type":"sql","name":"Bad Sql",
          |      "config":{"dialect":"postgresql","host":"h","port":5432,"database":"d","user":"u",
          |                "password":"p","query":"DROP TABLE users"}}],
          |    "outputDataTypeName": "O",
          |    "steps": []
          |  },
          |  "dashboard": {
          |    "dashboardName": "Should Not Be Created",
          |    "panels": []
          |  }
          |}""".stripMargin
      val beforeDashboards = dashboardCount()
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("DDL/DML")
      }
      allCounts() shouldBe before
      dashboardCount() shouldBe beforeDashboards
    }
  }
}
