package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes

/** Standalone-path regression coverage (HEL-387 spec.md "Standalone proposal
 *  paths are unaffected") — split out of `CombinedApplyProposalSpec` to keep
 *  both files under the ~250-line soft budget. Proves `POST
 *  /api/dashboards/apply-proposal` and `POST /api/pipelines/apply-proposal`
 *  behave exactly as before this ticket, including that the sentinel string
 *  carries NO special meaning on either standalone path — it is treated as
 *  an ordinary (non-existent) outputId. */
class CombinedApplyProposalRegressionSpec extends CombinedApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal (standalone, unaffected by HEL-387)" should {

    "reject a panel outputId literally equal to the sentinel as an ordinary not-found binding" in {
      val before = dashboardCount()
      val body =
        """{"dashboardName":"D","panels":[
          |  {"title":"X","type":"output","outputId":"$pipelineOutput","fieldMapping":{"value":"y"}}
          |]}""".stripMargin
      Post("/api/dashboards/apply-proposal", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~>
        routes ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include("not found")
        }
      dashboardCount() shouldBe before
    }
  }

  "POST /api/pipelines/apply-proposal (standalone, unaffected by HEL-387)" should {

    "continue to atomically create a pipeline from a valid standalone proposal" in {
      val before = allCounts()
      val body =
        """{"pipelineName":"Standalone Pipeline","roots":[{"type":"static","name":"Standalone Static",
          |"config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}}],
          |"outputDataTypeName":"Standalone Output","steps":[]}""".stripMargin
      Post("/api/pipelines/apply-proposal", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~>
        routes ~> check {
          status shouldBe StatusCodes.Created
        }
      allCounts() should be > before
    }
  }
}
