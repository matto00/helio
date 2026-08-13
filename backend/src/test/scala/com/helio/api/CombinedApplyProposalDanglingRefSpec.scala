package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes

/** Dangling output-ref rejection coverage for `POST /api/proposals/apply`
 *  (HEL-387, design.md D2 — the round-1/round-2 skeptic-corrected blessed-slot
 *  precedence) — split out of `CombinedApplyProposalSpec` to keep both files
 *  under the ~250-line soft budget.
 *
 *  Every case here uses a syntactically-complete but never-actually-applied
 *  `pipeline` object (an unresolvable `sourceId`) — `validateOutputRefPositions`
 *  runs BEFORE `pipelineProposalService.apply` is ever called, so the
 *  pipeline's own semantic validity is irrelevant to these cases; only its
 *  JSON shape needs to satisfy `PipelineProposal`'s reader. Each case asserts
 *  `allCounts()` is unchanged — proving nothing was created, not merely that
 *  the response was a 400. */
class CombinedApplyProposalDanglingRefSpec extends CombinedApplyProposalSpecBase {

  private val unreachablePipeline =
    """"pipeline":{"pipelineName":"P","source":{"sourceId":"00000000-0000-0000-0000-000000000000"},
      |"outputDataTypeName":"O","steps":[]}""".stripMargin

  "POST /api/proposals/apply dangling-ref rejection" should {

    "reject a sentinel placed in fieldMapping instead of a binding slot, creating nothing" in {
      val before = allCounts()
      val body =
        s"""{$unreachablePipeline,
           |"dashboard":{"dashboardName":"D","panels":[
           |  {"title":"Bad Field Mapping","type":"text","fieldMapping":{"content":"$$pipelineOutput"}}
           |]}}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("Bad Field Mapping")
      }
      allCounts() shouldBe before
    }

    "reject a sentinel in config.dataTypeId on a DataPanelKinds (chart) panel, creating nothing" in {
      val before = allCounts()
      val body =
        s"""{$unreachablePipeline,
           |"dashboard":{"dashboardName":"D","panels":[
           |  {"title":"Bad Kind Mismatch","type":"chart","config":{"dataTypeId":"$$pipelineOutput"}}
           |]}}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("Bad Kind Mismatch")
      }
      allCounts() shouldBe before
    }

    "reject a duplicate sentinel occurrence alongside a legitimate blessed one, creating nothing" in {
      val before = allCounts()
      val body =
        s"""{$unreachablePipeline,
           |"dashboard":{"dashboardName":"D","panels":[
           |  {"title":"Bad Duplicate","type":"text",
           |   "config":{"dataTypeId":"$$pipelineOutput"},
           |   "fieldMapping":{"content":"$$pipelineOutput"}}
           |]}}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("Bad Duplicate")
      }
      allCounts() shouldBe before
    }

    "reject a sentinel in config.dataTypeId shadowed by an already-set flat dataTypeId, creating nothing" in {
      val before = allCounts()
      val body =
        s"""{$unreachablePipeline,
           |"dashboard":{"dashboardName":"D","panels":[
           |  {"title":"Bad Shadowed","type":"text","dataTypeId":"$pipelineOutputTypeId",
           |   "config":{"dataTypeId":"$$pipelineOutput"}}
           |]}}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("Bad Shadowed")
      }
      allCounts() shouldBe before
    }
  }
}
