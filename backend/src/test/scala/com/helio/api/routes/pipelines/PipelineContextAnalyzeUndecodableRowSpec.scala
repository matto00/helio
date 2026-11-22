package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository
import com.helio.testsupport.ContextAnalyzeApiFixture
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1625 (CR1, design D6): a stored step row whose config cannot be decoded fails the WHOLE read (non-2xx), not
 *  one pipeline, exactly as `GET /api/pipelines/context-details` fails on the same row (both decode every step row in
 *  the shared batch step read). The MCP then analyzes each pipeline separately. A GUARD of the built behaviour. */
class PipelineContextAnalyzeUndecodableRowSpec extends ContextAnalyzeApiFixture {

  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository =
    new PipelineRunRepository(ctx)

  private def statusOf(path: String, user: String): StatusCode =
    req(HttpMethods.GET, path, user) ~> routes ~> check(status)

  "a stored step row that cannot be decoded" should {
    "fail the whole context-analyze read, the same way context-details fails, while every other route still answers" in {
      reset()
      val s = seedSource(userA, "s")
      val (healthy, _) = seedPipeline(userA, "healthy", Vector(s))
      val (broken, Vector(root)) = seedPipeline(userA, "broken", Vector(s))
      statusOf("/api/pipelines/context-analyze", userA) shouldBe StatusCodes.OK
      val badStep = UUID.randomUUID().toString
      await(privilegedDb.run(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($badStep, $broken, 0, 'filter', 'not json at all', true, now(), now(), NULL, $root)"""
      ))
      try {
        val analyzeStatus = statusOf("/api/pipelines/context-analyze", userA)
        val detailsStatus = statusOf("/api/pipelines/context-details", userA)
        analyzeStatus.isSuccess() shouldBe false
        analyzeStatus shouldBe detailsStatus
        // the healthy pipeline's own /analyze still answers: the MCP's per-pipeline fallback works for it
        statusOf(s"/api/pipelines/$healthy/analyze", userA) shouldBe StatusCodes.OK
      } finally {
        await(privilegedDb.run(sqlu"DELETE FROM pipeline_steps WHERE id = $badStep"))
      }
    }
  }
}
