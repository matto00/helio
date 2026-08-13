package com.helio.api

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

    "roll back the already-created pipeline and source when the dashboard phase fails" in {
      val before = allCounts()
      val body =
        """{
          |  "pipeline": {
          |    "pipelineName": "Rollback Pipeline",
          |    "source": {"type":"static","name":"Rollback Static",
          |      "config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}},
          |    "outputDataTypeName": "Rollback Output",
          |    "steps": []
          |  },
          |  "dashboard": {
          |    "dashboardName": "Rollback Dashboard",
          |    "panels": [
          |      {"title":"Bad Chart","type":"chart","dataTypeId":"$pipelineOutput","fieldMapping":{},
          |       "chartType":"bogus"}
          |    ]
          |  }
          |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("charttype")
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
          |    "source": {"type":"sql","name":"Bad Sql",
          |      "config":{"dialect":"postgresql","host":"h","port":5432,"database":"d","user":"u",
          |                "password":"p","query":"DROP TABLE users"}},
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
