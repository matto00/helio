package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRunGuardRepository, PipelineRunRepository}
import com.helio.testsupport.{DatasetRowsTestSupport, DraftPreviewApiFixture}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1630 tasks 5.1, 5.2, 5.3, 5.7: the stream's line order and contents, and the three guarantees that live outside the
 *  code under test: it never reads a data source, never calls the AI client, and leaves no trace in run history.
 *
 *  The counters (`sourceAccess`, `aiCalls`) sit on the repository and the engine's client, NOT inside the preview code, and the
 *  persisted sources carry content markers that differ from the supplied frames, so a read would show twice: in the counter and
 *  in the rows. */
class DraftPreviewStreamSpec extends DraftPreviewApiFixture {

  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository = new PipelineRunRepository(ctx)(ec)
  override protected def pipelineRunGuardRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunGuardRepository = new PipelineRunGuardRepository(ctx)(ec)

  private def seedWithPersistedSources() = {
    val seed = seedPipeline()
    await(superDb.run(DatasetRowsTestSupport.seedActionsFromRaw(seed.ds1, """{"columns":[{"name":"k","type":"integer"},{"name":"tag","type":"string"}],"rows":[[1,"PERSISTED-PRIMARY"]]}""")))
    await(superDb.run(DatasetRowsTestSupport.seedActionsFromRaw(seed.ds2, """{"columns":[{"name":"k","type":"integer"},{"name":"tag","type":"string"}],"rows":[[1,"PERSISTED-SECONDARY"]]}""")))
    seed
  }

  private val suppliedRoot = rootOf("r", jobj("k" -> intCell(1), "name" -> jstr("a")), jobj("k" -> intCell(2), "name" -> jstr("b")))

  private def joinStep(id: String, source: String, parent: Option[String] = None, position: Int = 0) =
    stepJson(id, "join", jobj("secondaryInput" -> jobj("kind" -> jstr("source"), "dataSourceId" -> jstr(source)), "joinKey" -> jstr("k"), "joinType" -> jstr("inner")), parent, position = position)

  "POST /api/pipelines/:id/draft-preview" should {
    "stream one step line per step before a single final rows line, as application/x-ndjson" in {
      val seed = seedPipeline()
      val body = draftBody(Vector(suppliedRoot), Vector(limitStep("a", 5), limitStep("b", 1, Some("a")), limitStep("c", 1, Some("b"))))
      assertValidRequest(body)
      val res = preview(seed, userA, body)
      res.status shouldBe StatusCodes.OK
      res.contentType should startWith("application/x-ndjson")
      res.types shouldBe Vector("step", "step", "step", "rows")
      res.ofType("step").map(l => l.fields("step").convertTo[String] -> l.fields("count").convertTo[Int]) shouldBe Vector("a" -> 2, "b" -> 1, "c" -> 1)
      res.ofType("step").head.fields("schema").convertTo[Vector[JsObject]].map(c => c.fields("name").convertTo[String] -> c.fields("type").convertTo[String]).toMap shouldBe Map("k" -> "int", "name" -> "string")
      val rows = res.rowsLine
      rows.fields("step") shouldBe jstr("c")
      rows.fields("available") shouldBe JsTrue
      rows.fields("count") shouldBe JsNumber(1)
      rows.fields("truncated") shouldBe JsFalse
      rows.fields("rows").convertTo[Vector[JsObject]].head.fields("k") shouldBe intCell(1)
    }

    "truncate the rows line at 1,000 rows while reporting the full count" in {
      val seed = seedPipeline()
      val big  = rootOf("r", Vector.tabulate(1500)(i => jobj("i" -> intCell(i))): _*)
      val res  = preview(seed, userA, draftBody(Vector(big), Vector(limitStep("a", 2000))))
      res.rowsLine.fields("rows").convertTo[Vector[JsObject]].size shouldBe 1000
      res.rowsLine.fields("count") shouldBe JsNumber(1500)
      res.rowsLine.fields("truncated") shouldBe JsTrue
    }

    "report a requested rows step, a disabled one carrying its pass-through frame, and the root frame when there is no step" in {
      val seed = seedPipeline()
      val steps = Vector(limitStep("a", 1), limitStep("off", 1, Some("a"), enabled = false), limitStep("c", 1, Some("off")))
      preview(seed, userA, draftBody(Vector(suppliedRoot), steps, "rowsStepId" -> jstr("off"))).rowsLine.fields("count") shouldBe JsNumber(1)
      val rootOnly = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector.empty)).rowsLine
      rootOnly.fields("step") shouldBe JsNull
      rootOnly.fields("count") shouldBe JsNumber(2)
      preview(seed, userA, draftBody(Vector(suppliedRoot), steps)).ofType("step").map(_.fields("step").convertTo[String]) shouldBe Vector("a", "c")
    }
  }

  "the never-read guarantee (ruling C2)" should {
    "answer a join from the supplied secondary, never the persisted one, with zero data-source access" in {
      val seed   = seedWithPersistedSources()
      val before = sourceAccess.get
      val body = draftBody(
        Vector(suppliedRoot), Vector(joinStep("j", seed.ds2)),
        "sources" -> jobj(seed.ds2 -> jobj("rows" -> jrows(jobj("k" -> intCell(1), "tag" -> jstr("SUPPLIED-SECONDARY"))), "complete" -> JsTrue))
      )
      val res = preview(seed, userA, body)
      withClue(res.body)(res.types shouldBe Vector("step", "rows"))
      res.body should include("SUPPLIED-SECONDARY")
      res.body should not include "PERSISTED"
      res.rowsLine.fields("rows").convertTo[Vector[JsObject]].map(_.fields("tag")) shouldBe Vector(jstr("SUPPLIED-SECONDARY"))
      sourceAccess.get shouldBe before
    }

    "give a join whose secondary is complete:false a sourceNotSupplied line, and still read nothing" in {
      val seed   = seedWithPersistedSources()
      val before = sourceAccess.get
      val body = draftBody(
        Vector(suppliedRoot), Vector(joinStep("j", seed.ds2), limitStep("below", 1, Some("j"))),
        "sources" -> jobj(seed.ds2 -> jobj("rows" -> jrows(jobj("k" -> intCell(1))), "complete" -> JsFalse))
      )
      val res = preview(seed, userA, body)
      res.ofType("unavailable").map(l => l.fields("step").convertTo[String] -> l.fields("reason").convertTo[String]) shouldBe
        Vector("j" -> "sourceNotSupplied", "below" -> "downstreamOfUnavailable")
      res.rowsLine.fields("available") shouldBe JsFalse
      res.body should not include "PERSISTED"
      sourceAccess.get shouldBe before
    }

    "give a join with no secondary supplied at all a sourceNotSupplied line, and read nothing" in {
      val seed   = seedWithPersistedSources()
      val before = sourceAccess.get
      val res    = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(joinStep("j", seed.ds2))))
      res.ofType("unavailable").map(_.fields("reason")) shouldBe Vector(jstr("sourceNotSupplied"))
      sourceAccess.get shouldBe before
    }

    "evaluate over the supplied input frame, not the persisted primary" in {
      val seed = seedWithPersistedSources()
      val res  = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(limitStep("a", 9))))
      res.body should not include "PERSISTED"
      res.ofType("step").head.fields("count") shouldBe JsNumber(2)
    }
  }

  "the never-call-AI guarantee (ruling F)" should {
    val aiConfig = jobj("inputField" -> jstr("name"), "instruction" -> jstr("shout"), "outputField" -> jstr("out"))

    "mark AI steps and everything below them unavailable, evaluate an independent branch, and make zero AI calls" in {
      val seed   = seedPipeline()
      val before = aiCalls.get
      val steps = Vector(
        limitStep("a", 9), stepJson("ai", "generatetext", aiConfig, Some("a")), limitStep("below", 9, Some("ai")),
        limitStep("side", 9, Some("a"), position = 1)
      )
      val res = preview(seed, userA, draftBody(Vector(suppliedRoot), steps))
      res.ofType("unavailable").map(l => l.fields("step").convertTo[String] -> l.fields("reason").convertTo[String]) shouldBe
        Vector("ai" -> "aiStep", "below" -> "downstreamOfAiStep")
      res.ofType("step").map(_.fields("step").convertTo[String]).toSet shouldBe Set("a", "side")
      aiCalls.get shouldBe before
    }

    "report a rows step below an AI step as available:false with no rows" in {
      val seed = seedPipeline()
      val res  = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(stepJson("ai", "generatetext", aiConfig), limitStep("t", 1, Some("ai")))))
      res.rowsLine shouldBe jobj("type" -> jstr("rows"), "step" -> jstr("t"), "available" -> JsFalse, "rows" -> JsArray.empty, "count" -> JsNumber(0), "truncated" -> JsFalse)
    }

    "treat a disabled AI step as transparent" in {
      val seed = seedPipeline()
      val res  = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(stepJson("ai", "generatetext", aiConfig, enabled = false), limitStep("t", 1, Some("ai")))))
      res.ofType("unavailable") shouldBe empty
      res.ofType("step").map(_.fields("step")) shouldBe Vector(jstr("t"))
    }
  }

  "error isolation" should {
    val badConvert = jobj("field" -> jstr("missing"), "from" -> jstr("csv"), "to" -> jstr("json"), "outputField" -> jstr("o"))

    "give the failing step an error line, its subtree downstreamOfError right after it, keep the sibling branch, and end with rows" in {
      val seed = seedPipeline()
      val steps = Vector(
        limitStep("a", 9), stepJson("b", "convertformat", badConvert, Some("a")), limitStep("c", 9, Some("b")),
        limitStep("d", 9, Some("a"), position = 1), limitStep("e", 9, Some("d"))
      )
      val res = preview(seed, userA, draftBody(Vector(suppliedRoot), steps, "rowsStepId" -> jstr("e")))
      res.status shouldBe StatusCodes.OK
      val compact = res.lines.map(l => l.fields("type").convertTo[String] + ":" + l.fields("step").convertTo[String]).filterNot(_.startsWith("rows"))
      compact shouldBe Vector("step:a", "step:d", "step:e", "error:b", "unavailable:c")
      res.ofType("error").head.fields("message").convertTo[String] should include("field-missing")
      res.ofType("unavailable").head.fields("reason") shouldBe jstr("downstreamOfError")
      res.rowsLine.fields("available") shouldBe JsTrue
      res.rowsLine.fields("step") shouldBe jstr("e")
    }

    "report the default rows step as available:false when it is the errored step's descendant" in {
      val seed = seedPipeline()
      val res = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(stepJson("b", "convertformat", badConvert), limitStep("c", 9, Some("b")))))
      res.rowsLine.fields("step") shouldBe jstr("c")
      res.rowsLine.fields("available") shouldBe JsFalse
    }

    "refuse a node past the 20,000-row ceiling with the backstop message and keep going" in {
      val seed  = seedPipeline()
      val ten   = Vector.tabulate(10000)(i => jobj("i" -> intCell(i)))
      val lane  = jobj("rows" -> JsArray(ten))
      val union = (id: String, parent: Option[String], laneId: String) =>
        stepJson(id, "union", jobj("secondaryInput" -> jobj("kind" -> jstr("lane"), "stepId" -> jstr(laneId)), "mode" -> jstr("byPosition")), parent)
      val body = draftBody(
        Vector(rootOf("r", ten: _*)), Vector(union("u1", None, "l1"), union("u2", Some("u1"), "l2"), limitStep("after", 9, Some("u2"))),
        "lanes" -> jobj("l1" -> lane, "l2" -> lane)
      )
      val res = preview(seed, userA, body)
      res.ofType("step").map(_.fields("step").convertTo[String]) shouldBe Vector("u1")
      res.ofType("error").head.fields("message") shouldBe jstr("node produced 30000 rows, over the draft preview limit of 20,000")
      res.ofType("unavailable").map(_.fields("step").convertTo[String]) shouldBe Vector("after")
    }
  }

  "side effects (task 5.7)" should {
    def traces(seedId: String): Vector[String] = Vector(
      "SELECT count(*) FROM pipeline_runs", "SELECT count(*) FROM pipeline_run_rate_window", "SELECT count(*) FROM data_sources",
      "SELECT count(*) FROM node_snapshots", "SELECT count(*) FROM dataset_rows",
      s"SELECT coalesce(last_run_status,'-')||coalesce(last_run_at::text,'-') FROM pipelines WHERE id='$seedId'"
    ).map(q => queryStrings(q).head)

    def upsert(target: JsObject) = stepJson("up", "upsertsource", jobj("target" -> target, "mode" -> jstr("append")))

    "leave runs, the rate window, last_run, snapshots and sources unchanged for an upsertsource into an existing source" in {
      val seed   = seedWithPersistedSources()
      val before = traces(seed.pipeline)
      val res = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(upsert(jobj("kind" -> jstr("existingSource"), "dataSourceId" -> jstr(seed.ds2))), limitStep("after", 1, Some("up")))))
      res.ofType("error") shouldBe empty
      res.ofType("step").map(_.fields("step").convertTo[String]) shouldBe Vector("up", "after")
      traces(seed.pipeline) shouldBe before
    }

    "leave the same traces for an upsertsource that would create a new source" in {
      val seed   = seedWithPersistedSources()
      val before = traces(seed.pipeline)
      val res = preview(seed, userA, draftBody(Vector(suppliedRoot), Vector(upsert(jobj("kind" -> jstr("newSource"), "name" -> jstr("brand-new"))))))
      res.ofType("step").map(_.fields("step").convertTo[String]) shouldBe Vector("up")
      traces(seed.pipeline) shouldBe before
      queryStrings("SELECT count(*) FROM data_sources WHERE name='brand-new'") shouldBe Vector("0")
    }
  }
}
