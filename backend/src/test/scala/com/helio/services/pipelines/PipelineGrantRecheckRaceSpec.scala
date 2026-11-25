package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, CreatePipelineStepRequest, DraftSaveRequest, ReorderPipelineStepsRequest, UpdatePipelineStepRequest}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineRootId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.pipelines.{LockSite, PipelineDefinitionLocks}
import com.helio.services.ServiceError
import com.helio.services.pipelines.draft.DraftSaveMode
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveHarness, DraftSaveSeed}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1707 items 1 and 2: a pipeline deleted, or an editor grant revoked or downgraded, between a write's service-layer
 *  owner-or-editor check and its privileged transaction.
 *
 *  Deterministic, no sleeps: the repositories are built on [[RaceLocks]], whose `lockPipelines` first runs the racer (committed
 *  on a SEPARATE superuser connection) as a step of the write's own transaction, then takes the real lock. Under READ COMMITTED
 *  the transaction's next statement sees the racer's commit, exactly as if it had landed between the service check and the
 *  write. The service layer is driven directly (the routes always build `PipelineDefinitionLocks.Enforced`).
 *
 *  Expected bodies are what the route's own service-layer check answers had the racer landed first (design.md D2 table). */
class PipelineGrantRecheckRaceSpec extends DraftSaveApiFixture {


  /** Locks that run one armed racer inside the write's transaction. `site = None`: before the next `lockPipelines`; `Some(s)`: at `choose(s)`. */
  private final class RaceLocks extends PipelineDefinitionLocks {
    private case class Armed(site: Option[LockSite], racer: () => Future[Any])
    @volatile private var armed: Option[Armed] = None
    def active(site: LockSite): Boolean = true
    def arm(site: Option[LockSite] = None)(racer: => Future[Any]): Unit = armed = Some(Armed(site, () => racer))
    private def fireIf(matches: Option[LockSite] => Boolean): DBIO[Unit] = armed.filter(a => matches(a.site)) match {
      case Some(a) => armed = None; DBIO.successful(()).flatMap(_ => DBIO.from(a.racer())).map(_ => ())
      case None    => DBIO.successful(())
    }
    override def lockPipelines(site: LockSite, ids: Seq[String])(implicit e: ExecutionContext): DBIO[Boolean] =
      fireIf(_.isEmpty).flatMap(_ => super.lockPipelines(site, ids))
    override def choose[A](site: LockSite, action: => DBIO[A], otherwise: => DBIO[A]): DBIO[A] =
      fireIf(_.contains(site)).flatMap(_ => super.choose(site, action, otherwise))
  }

  private final class Rig(val seed: DraftSaveSeed, val locks: RaceLocks) {
    val h       = new DraftSaveHarness(ctx, locks)
    val service = new PipelineService(h.pipelineRepo, h.stepRepo, h.dataSourceRepo, outputRepo = h.outputRepo, pipelineRootRepo = h.rootRepo)
  }

  private val editorB = AuthenticatedUser(UserId(userB))

  private def rig(): Rig = {
    val seed = seedPipeline()
    exec(seed.grant(userB, "editor"))
    new Rig(seed, new RaceLocks)
  }

  private def revoke(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"DELETE FROM resource_permissions WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")
  private def downgrade(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"UPDATE resource_permissions SET role='viewer' WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")
  private def deletePipeline(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"DELETE FROM pipelines WHERE id=${seed.pipeline}")

  private def seedSourceB(seed: DraftSaveSeed): String = {
    val id = seed.id("dsB")
    exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('$id','dsB','dataset','{}',now(),now(),'$userB','[]')")
    id
  }

  private def notFoundPipeline(seed: DraftSaveSeed): ServiceError   = ServiceError.NotFound(s"Pipeline not found: ${seed.pipeline}")
  private def notFoundStep(stepId: String): ServiceError             = ServiceError.NotFound(s"Pipeline step not found: $stepId")
  private val forbidden: ServiceError                                = ServiceError.Forbidden("Forbidden")

  // ---- Item 1: root add for a pipeline deleted mid-request -> the unknown-pipeline 404, never a 500 ----

  "root add for a pipeline deleted mid-request" should {
    "answer the unknown-pipeline 404 when the pipeline is gone before the name read (1a)" in {
      val r   = rig()
      val dsB = seedSourceB(r.seed)
      r.locks.arm(Some(LockSite.RootAddSourceShare))(deletePipeline(r.seed))
      val result = await(r.service.addRoot(PipelineId(r.seed.pipeline), CreatePipelineRootRequest(sourceId = Some(dsB)), editorB))
      result shouldBe Left(notFoundPipeline(r.seed))
      queryStrings(s"SELECT id FROM pipeline_roots WHERE data_source_id='$dsB'") shouldBe Vector.empty
    }

    "answer the unknown-pipeline 404 when the pipeline is gone after the name read, before the lock (1b)" in {
      val r   = rig()
      val dsB = seedSourceB(r.seed)
      r.locks.arm()(deletePipeline(r.seed))
      val result = await(r.service.addRoot(PipelineId(r.seed.pipeline), CreatePipelineRootRequest(sourceId = Some(dsB)), editorB))
      result shouldBe Left(notFoundPipeline(r.seed))
      queryStrings(s"SELECT id FROM pipeline_roots WHERE data_source_id='$dsB'") shouldBe Vector.empty
    }
  }

  // ---- Item 2: grant revoked / downgraded between the service check and the privileged transaction ----

  private val racers: Vector[(String, DraftSaveSeed => Future[Any])] = Vector("revoked" -> revoke _, "downgraded to viewer" -> downgrade _)

  /** `notFound` is the body a user with no grant gets; a remaining viewer grant is always 403. */
  private def refusedBody(kind: String, notFound: ServiceError): ServiceError = if (kind == "revoked") notFound else forbidden

  private def writeCase(route: String)(notFound: (Rig, DraftSaveSeed) => ServiceError)(call: (Rig, DraftSaveSeed) => Future[Either[ServiceError, Any]]): Unit =
    racers.foreach { case (kind, racer) =>
      s"refuse $route and write nothing when the editor grant is $kind mid-request" in {
        val r = rig()
        seedSourceB(r.seed)
        val before = storedState(r.seed)
        val roots  = queryStrings("SELECT id FROM pipeline_roots ORDER BY id")
        r.locks.arm()(racer(r.seed))
        val result = await(call(r, r.seed))
        result shouldBe Left(refusedBody(kind, notFound(r, r.seed)))
        storedState(r.seed) shouldBe before
        queryStrings("SELECT id FROM pipeline_roots ORDER BY id") shouldBe roots
      }
    }

  private def draftBody(r: Rig): DraftSaveRequest = {
    val (fp, definition) = read(r.seed, userA)
    val draft0           = draftOf(fp, definition)
    withOutputs(draft0, replacing(outputsOf(draft0), r.seed.ob)(o => set(o, "name", JsString("ob2")))).convertTo[DraftSaveRequest]
  }

  "an editor write whose grant changes between the service check and the transaction" should {
    writeCase("POST /roots")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.service.addRoot(PipelineId(s.pipeline), CreatePipelineRootRequest(sourceId = Some(s.id("dsB"))), editorB)
    }
    writeCase("DELETE /roots/:rootId")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.service.removeRoot(PipelineId(s.pipeline), PipelineRootId(s.r2), editorB)
    }
    writeCase("POST /draft/save")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.h.service.save(PipelineId(s.pipeline), draftBody(r), editorB)
    }
    writeCase("a draft-save undo restore")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.h.service.saveCore(PipelineId(s.pipeline), draftBody(r), editorB, DraftSaveMode.Restore)
    }
    writeCase("POST /steps (attach as tail)")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.service.addStep(PipelineId(s.pipeline), CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(7)), parentStepId = Some(s.t1), attachAsTail = Some(true)), editorB)
    }
    writeCase("POST /steps (splice insert)")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.service.addStep(PipelineId(s.pipeline), CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(7)), parentStepId = Some(s.t1)), editorB)
    }
    writeCase("PUT /steps/order")((r, s) => notFoundPipeline(s)) { (r, s) =>
      r.service.reorderSteps(PipelineId(s.pipeline), ReorderPipelineStepsRequest(Seq(s.t4, s.t2, s.t1)), editorB)
    }
    writeCase("PATCH /pipeline-steps/:id")((r, s) => notFoundStep(s.t2)) { (r, s) =>
      r.service.updateStep(PipelineStepId(s.t2), UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(22))), None), editorB)
    }
    writeCase("DELETE /pipeline-steps/:id")((r, s) => notFoundStep(s.t3)) { (r, s) =>
      r.service.deleteStep(PipelineStepId(s.t3), editorB)
    }
    writeCase("POST /pipeline-steps/:id/duplicate")((r, s) => notFoundStep(s.t2)) { (r, s) =>
      r.service.duplicateStep(PipelineStepId(s.t2), editorB)
    }
  }
}
