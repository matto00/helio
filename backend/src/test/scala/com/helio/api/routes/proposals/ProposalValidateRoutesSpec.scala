package com.helio.api.routes.proposals

import com.helio.services.pipelines.PipelineRunGuardConfig
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Route-level coverage for the three propose-side dry-run routes (HEL-1638 D4):
 *  `POST /api/pipelines/validate-proposal`, `POST /api/dashboards/validate-proposal`,
 *  `POST /api/proposals/validate`. Each answers `200 {"valid": true}` or the matching apply route's own
 *  error status and message; none creates anything. The source-fetch budget is pinned to 1 so the second
 *  inline-rest request in a run proves the `429` (the budget is charged inside `validate`, once). */
class ProposalValidateRoutesSpec extends CombinedApplyProposalSpecBase {

  override protected def guardConfig: PipelineRunGuardConfig =
    PipelineRunGuardConfig.fromEnv().copy(sourceFetchRateLimitPerWindow = 1)

  private def post(path: String, body: String) =
    Post(path, json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  private val staticPipeline =
    """{"pipelineName":"V","roots":[{"type":"static","name":"S",
      |"config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}}],
      |"steps":[],"outputs":[{"kind":"table","name":"O"}]}""".stripMargin
  private val badColumnPipeline =
    """{"pipelineName":"V","roots":[{"type":"static","name":"S",
      |"config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}}],
      |"steps":[],"outputs":[{"kind":"chart","name":"O","config":{"chartType":"bar","fieldMapping":{"xAxis":"name","yAxis":"nope"}}}]}""".stripMargin
  private val restPipeline =
    """{"pipelineName":"V","roots":[{"type":"rest_api","name":"R","config":{"url":"http://example.invalid/data"}}],
      |"steps":[],"outputs":[{"kind":"table","name":"O"}]}""".stripMargin
  private val okDashboard  = """{"dashboardName":"D","panels":[]}"""
  private val badDashboard = """{"dashboardName":"D","panels":[{"title":"Gone","type":"output","outputId":"00000000-0000-0000-0000-000000000000"}]}"""

  "the validate routes" should {

    "require authentication" in {
      for (path <- Seq("/api/pipelines/validate-proposal", "/api/dashboards/validate-proposal", "/api/proposals/validate"))
        Post(path, json("{}")) ~> routes ~> check { status shouldBe StatusCodes.Unauthorized }
    }

    "answer 200 {valid:true} for a passing proposal and create nothing" in {
      val before = allCounts()
      post("/api/pipelines/validate-proposal", staticPipeline) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson shouldBe JsObject("valid" -> JsTrue)
      }
      post("/api/dashboards/validate-proposal", okDashboard) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson shouldBe JsObject("valid" -> JsTrue)
      }
      post("/api/proposals/validate", s"""{"pipeline":$staticPipeline,"dashboard":$okDashboard}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson shouldBe JsObject("valid" -> JsTrue)
      }
      allCounts() shouldBe before
    }

    "answer apply's status and message for a rejected proposal, identical to the apply route" in {
      val before = allCounts()
      var validateMsg = ""
      post("/api/pipelines/validate-proposal", badColumnPipeline) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        validateMsg = responseAs[String]
      }
      Post("/api/pipelines/apply-proposal", json(badColumnPipeline)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] shouldBe validateMsg
      }
      post("/api/dashboards/validate-proposal", badDashboard) ~> routes ~> check {
        status.isFailure shouldBe true
        responseAs[String] should include("Gone")
      }
      post("/api/proposals/validate", s"""{"pipeline":$badColumnPipeline,"dashboard":$okDashboard}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] shouldBe validateMsg
      }
      allCounts() shouldBe before
    }

    "answer 429 with Retry-After once the source-fetch budget is used up by an inline rest root" in {
      // Budget is 1 per window: the first request is charged (its fetch to the .invalid host then fails), the second is refused.
      // The first request must NOT be 429: were a route also wrapped in sourceFetchRateLimitDirective, one request would be charged
      // twice against the budget of 1 and this would already be refused. The fetch's own outcome is irrelevant.
      post("/api/pipelines/validate-proposal", restPipeline) ~> routes ~> check { status should not be StatusCodes.TooManyRequests }
      post("/api/pipelines/validate-proposal", restPipeline) ~> routes ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
      }
    }
  }
}
