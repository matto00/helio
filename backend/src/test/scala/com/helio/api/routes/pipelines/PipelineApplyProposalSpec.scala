package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Route-level coverage for `POST /api/pipelines/apply-proposal` (HEL-383)
 *  under real RLS — mirrors `DashboardApplyProposalSpec`'s structure.
 *
 *  Happy paths (inline `static` source, existing `sourceId`) plus the
 *  structural-pre-validation guardrails (design.md D1/D2/D3). Mid-apply
 *  rollback (run failure, source-fetch failure, static-branch addStep
 *  failure) and the RLS-enforcement case live in
 *  `PipelineApplyProposalRollbackSpec`, split out to keep both files under
 *  the ~250-line soft budget. */
class PipelineApplyProposalSpec extends PipelineApplyProposalSpecBase {

  "POST /api/pipelines/apply-proposal" should {

    "atomically create source+pipeline+steps and run for an inline static proposal" in {
      val beforeSources  = dataSourceCount()
      val beforePipelines = pipelineCount()
      val beforeSteps    = pipelineStepCount()
      val beforeTypes    = dataTypeCount()
      val body =
        """{
          |  "pipelineName": "Static Pipeline",
          |  "source": {"type":"static","name":"Inline Static",
          |    "config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"],["y"]]}},
          |  "outputDataTypeName": "Static Output",
          |  "steps": [{"type":"limit","config":{"count":10}}]
          |}""".stripMargin
      var outputTypeId = ""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("source").asJsObject.fields("type").convertTo[String] shouldBe "static"
        obj.fields("pipeline").asJsObject.fields("name").convertTo[String] shouldBe "Static Pipeline"
        outputTypeId = obj.fields("outputDataTypeId").convertTo[String]
        outputTypeId should not be empty
        obj.fields("run").asJsObject.fields("rowCount").convertTo[Int] shouldBe 2
      }
      dataSourceCount() shouldBe (beforeSources + 1)
      pipelineCount() shouldBe (beforePipelines + 1)
      pipelineStepCount() shouldBe (beforeSteps + 1)
      // Static source's companion DataType only -- HEL-904 task 3.5:
      // `pipelineRepo.create` no longer mints its own output DataType.
      dataTypeCount() shouldBe (beforeTypes + 1)

      // HEL-904 task 3.8: `outputDataTypeId` (field name unchanged — see
      // design.md) is now a real Output id, not a DataType id — there is no
      // `GET /api/outputs/:id` route yet (P1.3/HEL-906's job), so the old
      // "read it back and check sourceId is absent" verification has no
      // Output-shaped equivalent here; `outputTypeId should not be empty`
      // above already covers the meaningful assertion (a real id was minted).
    }

    "create nothing new for the source when the proposal references an existing sourceId" in {
      val beforeSources = dataSourceCount()
      val body =
        s"""{
           |  "pipelineName": "Existing Source Pipeline",
           |  "source": {"sourceId": "$existingSourceId"},
           |  "outputDataTypeName": "Existing Output",
           |  "steps": [{"type":"limit","config":{"count":10}}]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.get("source") shouldBe None
        obj.fields("pipeline").asJsObject.fields("sourceDataSourceId").convertTo[String] shouldBe existingSourceId
      }
      dataSourceCount() shouldBe beforeSources
    }
  }

  "structural pre-validation" should {

    "reject a proposal with both sourceId and an inline type, creating nothing" in {
      val before = allCounts()
      val body =
        s"""{"pipelineName":"P","source":{"sourceId":"$existingSourceId","type":"static",
           |"name":"n","config":{"columns":[],"rows":[]}},"outputDataTypeName":"O","steps":[]}""".stripMargin
      apply(body) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      allCounts() shouldBe before
    }

    "reject a proposal whose source sets neither sourceId nor an inline type" in {
      val before = allCounts()
      val body = """{"pipelineName":"P","source":{},"outputDataTypeName":"O","steps":[]}"""
      apply(body) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      allCounts() shouldBe before
    }

    "reject an inline csv source with a structured 4xx, creating nothing" in {
      val before = allCounts()
      val body =
        """{"pipelineName":"P","source":{"type":"csv","name":"n","config":{"path":"x.csv"}},
          |"outputDataTypeName":"O","steps":[]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include("inline csv")
      }
      allCounts() shouldBe before
    }

    "reject an inline source missing name, creating nothing" in {
      val before = allCounts()
      val body =
        """{"pipelineName":"P","source":{"type":"sql",
          |"config":{"dialect":"postgresql","host":"h","port":5432,"database":"d","user":"u","password":"p","query":"SELECT 1"}},
          |"outputDataTypeName":"O","steps":[]}""".stripMargin
      apply(body) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      allCounts() shouldBe before
    }

    "reject an inline sql/rest_api source missing its config, creating nothing" in {
      val before = allCounts()
      val sqlBody  = """{"pipelineName":"P","source":{"type":"sql","name":"n"},"outputDataTypeName":"O","steps":[]}"""
      val restBody = """{"pipelineName":"P","source":{"type":"rest_api","name":"n"},"outputDataTypeName":"O","steps":[]}"""
      apply(sqlBody) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      apply(restBody) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      allCounts() shouldBe before
    }

    "reject non-SELECT SQL verbatim, creating nothing" in {
      val before = allCounts()
      val body =
        """{"pipelineName":"P","source":{"type":"sql","name":"Bad Sql",
          |"config":{"dialect":"postgresql","host":"h","port":5432,"database":"d","user":"u","password":"p",
          |"query":"DROP TABLE users"}},"outputDataTypeName":"O","steps":[]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("DDL/DML")
      }
      allCounts() shouldBe before
    }

    "reject an unrecognized step type, creating nothing" in {
      val before = allCounts()
      val body =
        s"""{"pipelineName":"P","source":{"sourceId":"$existingSourceId"},"outputDataTypeName":"O",
           |"steps":[{"type":"not_a_real_step","config":{}}]}""".stripMargin
      apply(body) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      allCounts() shouldBe before
    }
  }

  /** Sum of the four resource counts the atomicity contract covers — a single
   *  scalar delta is enough to prove "nothing created" for the guardrail
   *  cases above (none of them reach a partial-creation state to roll back;
   *  see `PipelineApplyProposalRollbackSpec` for cases that do). */
  private def allCounts(): Int = dataSourceCount() + pipelineCount() + pipelineStepCount() + dataTypeCount()
}
