package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.api.protocols.PipelineProposalApplyResponse

/** Mid-apply failure rollback + RLS coverage for `POST
 *  /api/pipelines/apply-proposal` (HEL-383, design.md D5/D6) — split out of
 *  `PipelineApplyProposalSpec` to keep both files under the ~250-line soft
 *  budget.
 *
 *  HEL-755 (design.md D1-D3): an inline `rest_api`/`sql` schema-fetch
 *  failure, and any `rest_api`/`sql` source (healthy or not, inline or
 *  existing-`sourceId`) whose kind the run engine can't execute at all, are
 *  NO LONGER rollback triggers — apply creates what it safely can and
 *  reports a durably-persisted `blocked` run instead. Each such case below
 *  asserts `201 Created`, the created/retained resource counts, the
 *  response's `run.blocked`/`blockedReason`, AND that a real `pipeline_runs`
 *  row was persisted (`latestPipelineRun`, `PipelineApplyProposalSpecBase`) —
 *  not just returned transiently in the apply response.
 *
 *  The remaining true-rollback cases (assert-blocked run, addStep failure,
 *  cross-tenant sourceId) are unchanged and continue to assert the four
 *  resource counts (`data_sources`, `pipelines`, `pipeline_steps`,
 *  `data_types`) are unchanged from immediately before the call. */
class PipelineApplyProposalRollbackSpec extends PipelineApplyProposalSpecBase {

  "POST /api/pipelines/apply-proposal rollback" should {

    "create the pipeline and report a blocked run for a healthy inline rest_api source (execution-unsupported kind)" in {
      val beforeSources   = dataSourceCount()
      val beforePipelines = pipelineCount()
      val beforeSteps     = pipelineStepCount()
      val beforeTypes     = dataTypeCount()
      val body =
        s"""{"pipelineName":"Rest Run Fail","source":{"type":"rest_api","name":"Inline Rest",
           |"config":{"url":"$RestSuccessUrl"}},"outputDataTypeName":"O",
           |"steps":[{"type":"limit","config":{"count":10}}]}""".stripMargin
      var pipelineId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineProposalApplyResponse]
        resp.run.blocked shouldBe true
        resp.run.blockedReason.get should include("executed automatically yet")
        pipelineId = resp.pipeline.id
      }
      // Source + its companion DataType (RestSuccessUrl's fetch succeeds) +
      // the pipeline + its output DataType + the one "limit" step are all
      // retained, not rolled back.
      dataSourceCount() shouldBe (beforeSources + 1)
      pipelineCount() shouldBe (beforePipelines + 1)
      pipelineStepCount() shouldBe (beforeSteps + 1)
      dataTypeCount() shouldBe (beforeTypes + 2)

      val (runStatus, runErrorLog) = latestPipelineRun(pipelineId).get
      runStatus shouldBe "failed"
      runErrorLog.get should include("executed automatically yet")
    }

    "create the source and pipeline and report a blocked run on an inline rest_api schema-fetch failure" in {
      val beforeSources   = dataSourceCount()
      val beforePipelines = pipelineCount()
      val beforeSteps     = pipelineStepCount()
      val beforeTypes     = dataTypeCount()
      val body =
        s"""{"pipelineName":"Rest Fetch Fail","source":{"type":"rest_api","name":"Inline Rest Fail",
           |"config":{"url":"$RestFailureUrl"}},"outputDataTypeName":"O","steps":[]}""".stripMargin
      var pipelineId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineProposalApplyResponse]
        resp.run.blocked shouldBe true
        resp.run.blockedReason.get should include("connector: endpoint unreachable")
        pipelineId = resp.pipeline.id
      }
      // Source is KEPT despite the fetch failure — no companion DataType,
      // since schema inference never ran — plus the pipeline and its output
      // DataType.
      dataSourceCount() shouldBe (beforeSources + 1)
      pipelineCount() shouldBe (beforePipelines + 1)
      pipelineStepCount() shouldBe beforeSteps
      dataTypeCount() shouldBe (beforeTypes + 1)

      val (runStatus, runErrorLog) = latestPipelineRun(pipelineId).get
      runStatus shouldBe "failed"
      runErrorLog.get should include("connector: endpoint unreachable")
    }

    "create the source and pipeline and report a blocked run for an inline sql source whose connection fails" in {
      val beforeSources   = dataSourceCount()
      val beforePipelines = pipelineCount()
      val beforeSteps     = pipelineStepCount()
      val beforeTypes     = dataTypeCount()
      // localhost:1 fails fast and deterministically (connection refused, no
      // DNS delay) — the same pattern SqlConnectorSpec's "SQL connection
      // failed" test uses.
      val body =
        """{"pipelineName":"Sql Connect Fail","source":{"type":"sql","name":"Inline Sql Fail",
          |"config":{"dialect":"postgresql","host":"localhost","port":1,"database":"d","user":"u",
          |"password":"p","query":"SELECT 1"}},"outputDataTypeName":"O","steps":[]}""".stripMargin
      var pipelineId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineProposalApplyResponse]
        resp.run.blocked shouldBe true
        resp.run.blockedReason.get should include("SQL execution failed")
        pipelineId = resp.pipeline.id
      }
      dataSourceCount() shouldBe (beforeSources + 1)
      pipelineCount() shouldBe (beforePipelines + 1)
      pipelineStepCount() shouldBe beforeSteps
      dataTypeCount() shouldBe (beforeTypes + 1)

      val (runStatus, runErrorLog) = latestPipelineRun(pipelineId).get
      runStatus shouldBe "failed"
      runErrorLog.get should include("SQL execution failed")
    }

    "report a blocked run without rollback for an existing-sourceId reference to a healthy pre-existing rest_api source" in {
      val preExistingId = createRestSource(RestSuccessUrl, "Pre-existing Rest")

      val beforeSources   = dataSourceCount()
      val beforePipelines = pipelineCount()
      val beforeSteps     = pipelineStepCount()
      val beforeTypes     = dataTypeCount()
      val body =
        s"""{"pipelineName":"Existing Rest","source":{"sourceId":"$preExistingId"},
           |"outputDataTypeName":"O","steps":[]}""".stripMargin
      var pipelineId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineProposalApplyResponse]
        resp.run.blocked shouldBe true
        resp.run.blockedReason.get should include("executed automatically yet")
        pipelineId = resp.pipeline.id
      }
      // No NEW source/companion DataType — only the pipeline + its output DataType.
      dataSourceCount() shouldBe beforeSources
      pipelineCount() shouldBe (beforePipelines + 1)
      pipelineStepCount() shouldBe beforeSteps
      dataTypeCount() shouldBe (beforeTypes + 1)

      val (runStatus, runErrorLog) = latestPipelineRun(pipelineId).get
      runStatus shouldBe "failed"
      runErrorLog.get should include("executed automatically yet")
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

  /** Creates a pre-existing `rest_api` source directly via `POST /api/sources`
   *  (not through apply-proposal), for the existing-`sourceId` coverage
   *  above — returns the created source's id. */
  private def createRestSource(url: String, name: String): String = {
    val body = s"""{"name":"$name","type":"rest_api","config":{"url":"$url"}}"""
    var id = ""
    Post("/api/sources", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      id = responseAs[CreateSourceResponse].source.id
    }
    id
  }
}
