package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRunGuardRepository, PipelineRunRepository}
import com.helio.services.pipelines.PipelineRunGuardConfig
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1629 task 6.7 (§8.6): the run after a save goes through the unchanged HEL-505 guard AFTER the save commits. A guard
 *  rejection is `200` with `run: {started: false, code: 429, retryAfterSeconds, reason}` and never rolls the save back; an
 *  editor's real run counts against the pipeline OWNER's concurrency cap (HEL-1492, the owner-keyed lock, unchanged). */
class DraftSaveRunSpec extends DraftSaveApiFixture {

  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository = new PipelineRunRepository(ctx)
  override protected def pipelineRunGuardRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunGuardRepository = new PipelineRunGuardRepository(ctx)
  override protected def pipelineRunGuardConfig: PipelineRunGuardConfig =
    PipelineRunGuardConfig(rateLimitPerWindow = 2, rateWindowSeconds = 600, maxConcurrent = 1, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)

  private def draftWithChange(seed: DraftSaveSeed, user: String, run: String): JsObject = {
    val (fp, definition) = read(seed, user)
    val d = draftOf(fp, definition)
    JsObject(withSteps(d, replacing(stepsOf(d), seed.t2)(s => set(s, "config", limit(41)))).fields + ("runAfterSave" -> JsString(run)))
  }

  "a save with runAfterSave" should {
    "return run: null when no run is requested" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      save(seed, userA, draftOf(fp, definition))._2.fields("run") shouldBe JsNull
    }

    "answer 200 with started: false and retryAfterSeconds when the guard rejects the run, and keep the save" in {
      val seed = seedPipeline()
      // The window admits 2 runs per user; the third dry run in it is refused.
      val results = (1 to 3).map(_ => save(seed, userA, draftWithChange(seed, userA, "dryRun")))
      info(results.map(_._2.fields("run").compactPrint).mkString("runs: ", " | ", ""))
      results.take(2).map(_._2.fields("run").asJsObject.fields("started")) shouldBe Vector(JsBoolean(true), JsBoolean(true))
      val rejected = results.map(_._2.fields("run")).collect { case o: JsObject if o.fields("started") == JsBoolean(false) => o }
      withClue(results.map(_._2.compactPrint).mkString("\n"))(rejected should not be empty)
      val first = rejected.head
      first.fields("code") shouldBe JsNumber(429)
      first.fields("retryAfterSeconds").convertTo[Long] should be > 0L
      first.fields("reason").convertTo[String] should not be empty
      results.foreach(_._1 shouldBe StatusCodes.OK)
      queryStrings(s"SELECT config FROM pipeline_steps WHERE id='${seed.t2}'").head shouldBe "{\"count\":41}"
    }

    "count an editor's real run against the pipeline owner's concurrency cap" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      exec(s"INSERT INTO pipeline_runs (id,pipeline_id,status,started_at,trigger_source,heartbeat_at) VALUES ('${seed.id("busy")}','${seed.pipeline}','running',now(),'manual',now())")
      val (code, body) = save(seed, userB, draftWithChange(seed, userB, "run"))
      withClue(body.compactPrint) {
        code shouldBe StatusCodes.OK
        val run = body.fields("run").asJsObject
        run.fields("started") shouldBe JsBoolean(false)
        run.fields("code") shouldBe JsNumber(429)
      }
      queryStrings(s"SELECT config FROM pipeline_steps WHERE id='${seed.t2}'").head shouldBe "{\"count\":41}"
    }
  }
}
