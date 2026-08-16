package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes

/** Mid-apply failure rollback + RLS coverage for `POST
 *  /api/pipelines/apply-proposal` (HEL-383, design.md D5/D6) — split out of
 *  `PipelineApplyProposalSpec` to keep both files under the ~250-line soft
 *  budget.
 *
 *  Each case asserts the four resource counts (`data_sources`, `pipelines`,
 *  `pipeline_steps`, `data_types`) are unchanged from immediately before the
 *  call — the DB-count-based proof design.md calls for, rather than trusting
 *  the error response alone. */
class PipelineApplyProposalRollbackSpec extends PipelineApplyProposalSpecBase {

  "POST /api/pipelines/apply-proposal rollback" should {

    "roll back the pipeline, its output type, and an inline rest_api source when the run fails" in {
      val before = allCounts()
      val body =
        s"""{"pipelineName":"Rest Run Fail","source":{"type":"rest_api","name":"Inline Rest",
           |"config":{"url":"$RestSuccessUrl"}},"outputDataTypeName":"O",
           |"steps":[{"type":"limit","config":{"count":10}}]}""".stripMargin
      apply(body) ~> routes ~> check {
        // PipelineRunService rejects RestSource for Spark submission (Context/D6) —
        // a deterministic run failure, not a test-only injection point.
        status shouldBe StatusCodes.UnprocessableEntity
      }
      allCounts() shouldBe before
    }

    "roll back the just-created source on an inline rest_api schema-fetch failure" in {
      val before = allCounts()
      val body =
        s"""{"pipelineName":"Rest Fetch Fail","source":{"type":"rest_api","name":"Inline Rest Fail",
           |"config":{"url":"$RestFailureUrl"}},"outputDataTypeName":"O","steps":[]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadGateway
        responseAs[String] should include("connector: endpoint unreachable")
      }
      allCounts() shouldBe before
    }

    "roll back the pipeline, its output type, and an inline source when the run is blocked by an error-severity assertion" in {
      val before = allCounts()
      // HEL-570 (design.md Decision 8): the run itself completes execution
      // without exception, but the `assert` step's error-severity rowCountMax
      // rule fails (2 rows > count: 1) — treated identically to a run
      // failure for rollback purposes, since the proposal's output DataType
      // was never actually populated either way.
      val body =
        s"""{"pipelineName":"Assert Blocked","source":{"type":"static","name":"Assert Blocked Source",
           |"config":{"columns":[{"name":"revenue","type":"integer"}],"rows":[[5],[10]]}},
           |"outputDataTypeName":"O",
           |"steps":[{"type":"assert","config":{"rules":[{"kind":"rowCountMax","params":{"count":1},"severity":"error"}]}}]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      allCounts() shouldBe before
    }

    "roll back an inline static source (and its companion type) when a later addStep fails" in {
      val before = allCounts()
      val body =
        s"""{"pipelineName":"Static AddStep Fail","source":{"type":"static","name":"Static For Union",
           |"config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}},"outputDataTypeName":"O",
           |"steps":[{"type":"union","config":{"otherDataSourceId":"$otherUserSourceId","mode":"byPosition"}}]}""".stripMargin
      apply(body) ~> routes ~> check {
        // union's right-source ownership pre-flight (PipelineService.addStep) rejects
        // a source the caller doesn't own — otherUserSourceId is owned by otherId.
        status shouldBe StatusCodes.NotFound
      }
      allCounts() shouldBe before
    }

    "reject a sourceId owned by another user as not found, creating nothing (RLS)" in {
      val before = allCounts()
      val body =
        s"""{"pipelineName":"Cross Tenant","source":{"sourceId":"$otherUserSourceId"},
           |"outputDataTypeName":"O","steps":[]}""".stripMargin
      apply(body) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      allCounts() shouldBe before
    }
  }

  private def allCounts(): Int = dataSourceCount() + pipelineCount() + pipelineStepCount() + dataTypeCount()
}
