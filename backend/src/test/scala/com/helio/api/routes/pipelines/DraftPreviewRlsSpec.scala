package com.helio.api.routes.pipelines

import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.testsupport.DraftPreviewApiFixture
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1630 task 5.6 (owner ruling 1, constraint C1): owner-or-editor only, on a role WITHOUT BYPASSRLS (the production
 *  shape; the dev and CI role bypasses RLS, which is how an RLS defect ships), and the HEL-1516 re-check right before the walk.
 *
 *  The revoke seam follows `Hel1516GranteeDriftPreviewSpec`: a repository subclass whose role read answers and THEN deletes the
 *  editor's grant, so the only thing that can notice is a second role read made after parsing and planning. */
class DraftPreviewRlsSpec extends DraftPreviewApiFixture {

  /** Runs once, right after the next role read answers. */
  private val afterNextRoleRead = new AtomicReference[Option[() => Unit]](None)

  override protected def pipelineRepoFor(ctx: DbContext, dataSourceRepo: DataSourceRepository)(implicit ec: ExecutionContext): PipelineRepository =
    new PipelineRepository(ctx, dataSourceRepo)(ec) {
      override def checkPreviewAccessInternal(id: PipelineId, user: AuthenticatedUser, requireEditor: Boolean): Future[PipelineRunRepository.RunAuthorization] =
        super.checkPreviewAccessInternal(id, user, requireEditor).map { answer =>
          afterNextRoleRead.getAndSet(None).foreach(_.apply())
          answer
        }
    }

  private val body = draftBody(Vector(rootOf("r", jobj("a" -> intCell(1)))), Vector(limitStep("a", 1)))

  "the draft preview on a non-BYPASSRLS application role" should {
    "serve the owner and an editor grantee with step lines, refuse a viewer with 403 and a stranger with 404" in {
      val seed = seedPipeline()
      preview(seed, userA, body).types shouldBe Vector("step", "rows")
      preview(seed, userB, body).status shouldBe StatusCodes.NotFound
      exec(seed.grant(userB, "editor"))
      val editor = preview(seed, userB, body)
      editor.status shouldBe StatusCodes.OK
      editor.types shouldBe Vector("step", "rows")
      exec(s"UPDATE resource_permissions SET role='viewer' WHERE resource_id='${seed.pipeline}' AND grantee_id='$userB'")
      val viewer = preview(seed, userB, body)
      viewer.status shouldBe StatusCodes.Forbidden
      viewer.body should not include "\"type\""
      preview(seed, userC, body).status shouldBe StatusCodes.NotFound
    }

    "answer 404 for a pipeline that does not exist" in {
      val seed = seedPipeline()
      previewRequest(seed.copy(prefix = "ghost-"), userA, body.compactPrint) ~> routes ~> check { response.status shouldBe StatusCodes.NotFound }
    }

    "refuse with 403, and evaluate nothing, when the editor's grant is revoked between the first access check and the walk" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      afterNextRoleRead.set(Some(() => exec(s"DELETE FROM resource_permissions WHERE resource_id='${seed.pipeline}' AND grantee_id='$userB'")))
      val res = preview(seed, userB, body)
      withClue(res.body)(res.status shouldBe StatusCodes.Forbidden)
      res.body should not include "\"type\":\"step\""
      queryStrings(s"SELECT count(*) FROM resource_permissions WHERE resource_id='${seed.pipeline}' AND grantee_id='$userB'") shouldBe Vector("0")
    }
  }
}
