package com.helio.api.routes.pipelines

import com.helio.api.protocols.pipelines.DraftSaveRequest
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.pipelines.draft.{DraftHookPoint, DraftSaveHooks}
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveHarness, DraftSaveSeed}
import slick.dbio.DBIO
import spray.json._

/** HEL-1629 task 6.2: the save is ONE transaction. A fault injected after any stage of the chain (through the service's own
 *  hook seam, so the failure happens inside the transaction after real writes) leaves the stored definition, its fingerprint,
 *  the journal and the audit log byte-identical to before the request; and a save takes `hel1498_lock_panels` exactly once
 *  (lock (1), "first and once"). */
class DraftSaveFaultSpec extends DraftSaveApiFixture {

  private val actor = AuthenticatedUser(UserId(userA))

  private def failingAt(point: DraftHookPoint): DraftSaveHooks = new DraftSaveHooks {
    def at(p: DraftHookPoint): DBIO[Unit] = if (p == point) DBIO.failed(new RuntimeException(s"injected fault at $p")) else DBIO.successful(())
  }

  private def request(seed: DraftSaveSeed): DraftSaveRequest = {
    val (fingerprint, definition) = read(seed)
    wholeDraft(seed, fingerprint, definition).convertTo[DraftSaveRequest]
  }

  private val points = Vector(
    DraftHookPoint.AfterCompare, DraftHookPoint.AfterInserts, DraftHookPoint.AfterRelinks, DraftHookPoint.AfterDeletes,
    DraftHookPoint.AfterUpdates, DraftHookPoint.AfterOutputs, DraftHookPoint.BeforeCommit
  )

  points.foreach { point =>
    s"a fault after $point" should {
      "leave the definition, its fingerprint, the journal and the audit log unchanged" in {
        val seed = seedPipeline()
        val req0 = request(seed)
        val (fingerprint, _) = read(seed)
        val before = storedState(seed)
        val journals = journalCount(userA)
        val audits = queryStrings("SELECT count(*) FROM audit_events").head
        val harness = new DraftSaveHarness(ctx, hooks = failingAt(point))
        val result = await(harness.service.save(PipelineId(seed.pipeline), req0, actor))
        result.isLeft shouldBe true
        storedState(seed) shouldBe before
        read(seed)._1 shouldBe fingerprint
        journalCount(userA) shouldBe journals
        queryStrings("SELECT count(*) FROM audit_events").head shouldBe audits
      }
    }
  }

  "the same draft with no fault" should {
    "commit, so the fault specs above are not passing because the draft can never be saved" in {
      val seed = seedPipeline()
      val req0 = request(seed)
      val before = storedState(seed)
      val result = await(new DraftSaveHarness(ctx).service.save(PipelineId(seed.pipeline), req0, actor))
      withClue(result.toString)(result.isRight shouldBe true)
      storedState(seed) should not be before
    }
  }

  "a save" should {
    "take hel1498_lock_panels exactly once" in {
      val seed = seedPipeline()
      val req0 = request(seed)
      def calls(): Long = {
        queryStrings("SELECT pg_stat_clear_snapshot()::text")
        queryStrings("SELECT coalesce(sum(calls),0) FROM pg_stat_user_functions WHERE funcname='hel1498_lock_panels'").head.toLong
      }
      val before = calls()
      // Function statistics are flushed when a backend exits: run the save on a private pool and close it before reading.
      val appPool  = newPool(Some("helio_app_test"), 2)
      val privPool = newPool(Some("helio_privileged"), 2)
      try {
        val harness = new DraftSaveHarness(new DbContext(appPool, privPool))
        await(harness.service.save(PipelineId(seed.pipeline), req0, actor)).isRight shouldBe true
      } finally { appPool.close(); privPool.close() }
      val deadline = System.nanoTime() + 10L * 1000000000L
      while (calls() - before < 1L && System.nanoTime() < deadline) Thread.sleep(200)
      calls() - before shouldBe 1L
    }
  }
}
