package com.helio.services.pipelines

import com.helio.domain.model.{AuthenticatedUser, Pipeline, PipelineId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.{DatasetRowsTestSupport, DraftSaveApiFixture, DraftSaveSeed}
import slick.dbio.DBIO
import slick.jdbc.PostgresProfile.api._
import spray.json.JsObject

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Future

/** HEL-1882 D2 (X1): the Output backfill (after an Output create or update) re-checks the acting user's owner-or-editor access
 *  before it evaluates and inside the snapshot write's transaction.
 *
 *  Deterministic, no sleeps: the racer commits (on a SEPARATE superuser connection) at a named point of the backfill.
 *  (a) fires AFTER `findByIdShared` returned and BEFORE the start check; (b) fires inside `overwriteRows`, as the write begins
 *  (the guard, when passed, runs as the transaction's first action, after the racer's commit). A backfill that was refused
 *  writes no `node_snapshots` row and leaves the Output's schema empty; variant (a) also records ZERO `overwriteRows` calls,
 *  which only the start check can produce. A revoke BEFORE `findByIdShared` is a GUARD (the read already refuses it). */
class OutputBackfillGrantRecheckSpec extends DraftSaveApiFixture {

  private val editorB = AuthenticatedUser(UserId(userB))
  private val ownerA  = AuthenticatedUser(UserId(userA))

  private val noFs: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]]               = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                    = Future.successful(())
    def exists(path: String): Future[Boolean]                 = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private def revoke(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"DELETE FROM resource_permissions WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")
  private def downgrade(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"UPDATE resource_permissions SET role='viewer' WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")

  /** Races `findByIdShared`: the racer commits after super returned (`afterRead`) or before it is called. */
  private final class RacyPipelineRepo(dsRepo: DataSourceRepository, racer: () => Future[Any], afterRead: Boolean, var armed: Boolean) extends PipelineRepository(ctx, dsRepo) {
    override def findByIdShared(id: PipelineId, user: Option[AuthenticatedUser]): Future[Option[Pipeline]] =
      if (!armed) super.findByIdShared(id, user)
      else {
        armed = false
        if (afterRead) super.findByIdShared(id, user).flatMap(p => racer().map(_ => p))
        else racer().flatMap(_ => super.findByIdShared(id, user))
      }
  }

  /** Counts `overwriteRows` calls; races the write itself when armed (the racer commits before the delegate's transaction). */
  private final class SpySnapshotRepo(c: DbContext) extends NodeSnapshotRepository(c) {
    val calls = new AtomicInteger(0)
    @volatile var racer: Option[() => Future[Any]] = None
    override def overwriteRows(pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String], guard: Option[DBIO[Unit]]): Future[Unit] = {
      calls.incrementAndGet()
      racer match {
        case Some(r) => racer = None; r().flatMap(_ => super.overwriteRows(pipelineId, nodeStepId, rows, explicitRootId, guard))
        case None    => super.overwriteRows(pipelineId, nodeStepId, rows, explicitRootId, guard)
      }
    }
  }

  private final class Rig(val seed: DraftSaveSeed) {
    val dsRepo     = new DataSourceRepository(ctx)
    var pipelineRacer: () => Future[Any] = () => Future.successful(())
    val snapshots  = new SpySnapshotRepo(ctx)
    val stepRepo   = new PipelineStepRepository(ctx)
    val outputRepo = new OutputRepository(ctx)
    val runRepo    = new PipelineRunRepository(ctx)
    def service(afterRead: Boolean): PipelineRunService = {
      val repo = new RacyPipelineRepo(dsRepo, () => pipelineRacer(), afterRead, pipelineArmed)
      new PipelineRunService(repo, stepRepo, dsRepo, runRepo, new PipelineRunCache(), null, noFs, outputRepo = outputRepo, nodeSnapshotRepo = snapshots)
    }
    var pipelineArmed = false
    def backfill(afterRead: Boolean, user: AuthenticatedUser): Future[Unit] =
      service(afterRead).backfillOutputNode(PipelineId(seed.pipeline), Some(PipelineStepId(seed.t2)), user, None)
  }

  /** A seeded pipeline whose source has rows, one succeeded run, B an editor, and NO snapshot on the target node `t2`. */
  private def rig(): Rig = {
    val seed = seedPipeline()
    exec(seed.grant(userB, "editor"))
    await(superDb.run(DatasetRowsTestSupport.seedActionsFromRaw(seed.ds1, """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"],["bob"]]}""")))
    exec(s"INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count, trigger_source) VALUES ('${UUID.randomUUID()}', '${seed.pipeline}', 'succeeded', now(), now(), 1, 'manual')")
    new Rig(seed)
  }

  private def snapshotRows(seed: DraftSaveSeed): Vector[String] =
    queryStrings(s"SELECT node_step_id||'|'||row_index FROM node_snapshots WHERE pipeline_id='${seed.pipeline}' AND node_step_id='${seed.t2}'")
  private def schemaOf(seed: DraftSaveSeed): String = queryStrings(s"SELECT schema::text FROM outputs WHERE id='${seed.oa}'").head

  private def raceCases(label: String)(run: (Rig, DraftSaveSeed => Future[Any]) => Unit): Unit =
    Vector[(String, DraftSaveSeed => Future[Any])]("revoked" -> revoke _, "downgraded to viewer" -> downgrade _).foreach { case (kind, racer) =>
      s"$label ($kind)" in run(rig(), racer)
    }

  "an Output backfill whose editor grant changes during it" should {
    raceCases("(a) writes nothing and never reaches the snapshot write when the grant changes after findByIdShared returns, before the start check") { (r, racer) =>
      r.pipelineRacer = () => racer(r.seed); r.pipelineArmed = true
      await(r.backfill(afterRead = true, editorB))
      withClue(s"snapshot rows written: ${snapshotRows(r.seed)}")(snapshotRows(r.seed) shouldBe Vector.empty)
      withClue(s"overwriteRows calls")(r.snapshots.calls.get shouldBe 0)
      schemaOf(r.seed) shouldBe "[]"
    }
    raceCases("(b) writes nothing when the grant changes while the snapshot write begins") { (r, racer) =>
      r.snapshots.racer = Some(() => racer(r.seed))
      await(r.backfill(afterRead = true, editorB))
      withClue(s"snapshot rows written: ${snapshotRows(r.seed)}")(snapshotRows(r.seed) shouldBe Vector.empty)
      schemaOf(r.seed) shouldBe "[]"
    }

    // GUARDS (green on main).
    "GUARD: writes nothing when the editor grant is revoked BEFORE findByIdShared (the read already refuses it)" in {
      val r = rig()
      r.pipelineRacer = () => revoke(r.seed); r.pipelineArmed = true
      await(r.backfill(afterRead = false, editorB))
      snapshotRows(r.seed) shouldBe Vector.empty
      r.snapshots.calls.get shouldBe 0
      schemaOf(r.seed) shouldBe "[]"
    }
    "GUARD: a current editor's backfill still writes the snapshot and the Output schema" in {
      val r = rig()
      await(r.backfill(afterRead = true, editorB))
      snapshotRows(r.seed).size shouldBe 1
      r.snapshots.calls.get shouldBe 1
      schemaOf(r.seed) should include("name")
    }
    "GUARD: the pipeline owner's backfill still writes" in {
      val r = rig()
      await(r.backfill(afterRead = true, ownerA))
      snapshotRows(r.seed).size shouldBe 1
      schemaOf(r.seed) should include("name")
    }
  }
}
