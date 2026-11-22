package com.helio.api.routes.pipelines

import com.helio.domain.SelectConfig
import com.helio.testsupport.{ContextAnalyzeApiFixture, JsonSchemaValidation}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1625: `GET /api/pipelines/context-analyze` over the full route tree on a non-BYPASSRLS app pool.
 *
 *  4.1 owner-scoped item set/order, zero-step, 401, schema; 4.2 parity with `/analyze` on a rich fixture;
 *  4.3 isolation between an owner, an editor grantee and a viewer grantee. */
class PipelineContextAnalyzeRoutesSpec extends ContextAnalyzeApiFixture {

  private val SchemaPath = "pipelines/pipeline-context-analyze-response.schema.json"

  private def itemOf(items: Vector[JsObject], pid: String): JsObject =
    items.find(_.fields("pipelineId") == JsString(pid)).getOrElse(fail(s"no item for $pid"))

  "GET /api/pipelines/context-analyze" should {

    "respond 401 without a credential, like GET /api/pipelines" in {
      Get("/api/pipelines/context-analyze") ~> routes ~> check { status shouldBe StatusCodes.Unauthorized }
      Get("/api/pipelines") ~> routes ~> check { status shouldBe StatusCodes.Unauthorized }
    }

    "return exactly the owner-scoped pipelines GET /api/pipelines lists, in the same order; an editor-granted pipeline is absent" in {
      reset()
      val s = seedSource(userA, "s")
      seedPipeline(userA, "A1", Vector(s))
      seedPipeline(userA, "A2", Vector(s))
      val sb = seedSource(userB, "sb")
      val (bPipeline, _) = seedPipeline(userB, "B1", Vector(sb))
      grant(bPipeline, userA, "editor")

      val ids = contextItems(userA).map(_.fields("pipelineId").convertTo[String])
      ids should have size 2
      ids shouldBe listedIds(userA)
      ids should not contain bPipeline
      contextItems(userB).map(_.fields("pipelineId").convertTo[String]) shouldBe listedIds(userB)
    }

    "include a pipeline with zero steps as steps: [] and warnings: []" in {
      reset()
      val s = seedSource(userA, "s")
      val (id, _) = seedPipeline(userA, "Empty", Vector(s))
      val item = itemOf(contextItems(userA), id)
      item.fields("steps") shouldBe JsArray()
      item.fields("warnings") shouldBe JsArray()
    }

    "return steps and warnings equal to GET /:id/analyze for every case of a rich fixture" in {
      reset()
      val pipelines = seedRichPipelines(userA, userB)
      val items     = contextItems(userA)
      items.map(_.fields("pipelineId").convertTo[String]) shouldBe listedIds(userA)
      items should have size pipelines.size.toLong

      var totalWarnings = 0
      var errored       = 0
      pipelines.foreach { case (name, pid) =>
        val analyze = analyzeOf(pid, userA)
        val item    = itemOf(items, pid)
        withClue(s"pipeline '$name': ") {
          item.fields.keySet shouldBe Set("pipelineId", "steps", "warnings")
          item.fields("steps") shouldBe analyze.fields("steps")
          item.fields("warnings") shouldBe analyze.fields("warnings")
        }
        totalWarnings += analyze.fields("warnings").convertTo[Vector[JsValue]].size
        errored += analyze.fields("steps").convertTo[Vector[JsObject]].count(_.fields.contains("validationError"))
      }
      // The fixture must actually exercise the interesting cases, or equality above is vacuous.
      totalWarnings should be > 0
      errored should be >= 4 // bogus join, upsert missing / foreign / csv target
      // the foreign-root pipeline is analyzed as the caller sees it: no schema for a root they do not own
      val foreignRoot = analyzeOf(pipelines("foreign-root"), userA)
      foreignRoot.fields("sourceSchemas").convertTo[Vector[JsObject]].last.fields("sourceSchema") shouldBe JsArray()
    }

    "produce a body that validates against the committed schema (seam guard, backend half)" in {
      reset()
      seedRichPipelines(userA, userB)
      val schema = JsonSchemaValidation.compile(SchemaPath)
      val body   = contextAnalyze(userA)
      JsonSchemaValidation.validationErrors(schema, body.compactPrint) shouldBe empty

      // The guard can fail: renaming one key at the envelope, item and warning level is rejected by the same schema.
      JsonSchemaValidation.validationErrors(schema, JsObject("results" -> body.fields("items")).compactPrint) should not be empty
      val items = body.fields("items").convertTo[Vector[JsObject]]
      val renamedItem = JsObject("items" -> JsArray(items.map(i => JsObject(i.fields - "pipelineId" + ("pipeline_id" -> i.fields("pipelineId"))))))
      JsonSchemaValidation.validationErrors(schema, renamedItem.compactPrint) should not be empty
      val renamedWarning = JsObject("items" -> JsArray(items.map { i =>
        JsObject(i.fields + ("warnings" -> JsArray(i.fields("warnings").convertTo[Vector[JsObject]].map(w =>
          JsObject(w.fields - "stepId" + ("step_id" -> w.fields("stepId")))))))
      }))
      JsonSchemaValidation.validationErrors(schema, renamedWarning.compactPrint) should not be empty
    }

    "never return another user's pipelines or steps to an editor or viewer grantee (non-BYPASSRLS pool), and leave their /analyze unchanged" in {
      reset()
      val pipelines = seedRichPipelines(userA, userB)
      val shared    = pipelines("upserts")
      grant(shared, userB, "editor")
      grant(shared, userC, "viewer")
      val sb = seedSource(userB, "orders-b")
      val (bOwn, Vector(rb)) = seedPipeline(userB, "B own", Vector(sb))
      addStep(bOwn, "select", SelectConfig(Vector("order_id")), root = Some(rb))

      val aSteps = analyzeOf(shared, userA).fields("steps").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String])
      aSteps should not be empty
      val aIds = pipelines.values.toVector ++ aSteps

      val bBody = contextAnalyze(userB).compactPrint
      aIds.foreach(id => withClue(s"B must not see $id: ")(bBody should not include id))
      val bItems = contextItems(userB)
      bItems.map(_.fields("pipelineId").convertTo[String]) shouldBe Vector(bOwn)
      bItems.head.fields("steps") shouldBe analyzeOf(bOwn, userB).fields("steps")
      bItems.head.fields("warnings") shouldBe analyzeOf(bOwn, userB).fields("warnings")

      contextItems(userC) shouldBe Vector.empty
      val cBody = contextAnalyze(userC).compactPrint
      aIds.foreach(id => withClue(s"C must not see $id: ")(cBody should not include id))

      // A's own batch still equals A's own analyze, so the absences above are not an empty-database artifact
      contextItems(userA).size shouldBe pipelines.size

      // the grantees' per-pipeline analyze of A's pipeline still answers 200 with the steps (status and shape unchanged)
      for (u <- Seq(userB, userC))
        analyzeOf(shared, u).fields("steps").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String]) shouldBe aSteps
    }
  }
}
