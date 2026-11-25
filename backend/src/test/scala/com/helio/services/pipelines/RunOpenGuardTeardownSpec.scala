package com.helio.services.pipelines

import com.helio.domain.model.{AuthenticatedUser, PendingWrite, PipelineRunId, UserId}
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import org.postgresql.util.PSQLException
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future, Promise}
import scala.util.{Failure, Try}

/** HEL-1541 task 3.4 -- a GUARD, not a red-first test: removing the write-back's run-open guard creates no deadlock, so this
 *  spec cannot be red on the unmodified tree. What it holds the line on is the lock order (design.md D4/D7): the write-back
 *  transaction takes its run-scoped SHARED advisory key first and no pipeline or run row lock, so a workspace teardown of a
 *  tag holding the pipeline and its target dataset (sources first, then the pipeline row, then the cascaded run rows) never
 *  forms a cycle with it. The CONTROL puts the rejected round-1 guard (pipeline `FOR KEY SHARE`, then run `FOR SHARE`) first,
 *  parked before the dataset's source lock (0); the teardown then holds (0) and waits on the pipeline delete, and the
 *  write-back's own (0) request closes a cycle that PostgreSQL must break with `40P01`, so the spec can fail. */
class RunOpenGuardTeardownSpec extends LateFinisherSpecBase {

  private def insertOpenRun(pid: String): String = {
    val id = UUID.randomUUID().toString
    awaitDb(db.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source)
                          VALUES ($id, $pid, 'queued', now(), NULL, 'manual')"""))
    id
  }

  private def tagAll(fx: Fx, target: String): String = {
    val tag = s"tag-${UUID.randomUUID()}"
    awaitDb(db.run(DBIO.seq(
      sqlu"UPDATE pipelines SET tag = $tag WHERE id = ${fx.pid.value}",
      sqlu"UPDATE data_sources SET tag = $tag WHERE id = $target OR id IN (SELECT data_source_id FROM pipeline_roots WHERE pipeline_id = ${fx.pid.value})"
    )))
    tag
  }

  private def hasDeadlock(t: Throwable): Boolean = t match {
    case null           => false
    case e: PSQLException if e.getSQLState == "40P01" => true
    case e              => e.getCause != t && hasDeadlock(e.getCause)
  }

  private def awaitLockWait(pending: Future[_]): Unit = {
    val deadline = System.nanoTime() + 60.seconds.toNanos
    def blocked = scalar("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'").toInt > 0
    while (!blocked && !pending.isCompleted && System.nanoTime() < deadline) Thread.sleep(25)
    withClue("the teardown never blocked on a lock -- the control would be vacuous: ") { blocked shouldBe true }
    pending.isCompleted shouldBe false
  }

  private def writeBack(fx: Fx, target: String, guard: DBIO[Unit]): Future[Either[String, Unit]] = {
    val write = PendingWrite(fx.p.stepId.value, UpsertSourceConfig(UpsertTarget.ExistingSource(target), UpsertMode.Append), Seq(Map("name" -> "alice")))
    dataSourceRepo.applyWriteBacks(AuthenticatedUser(UserId(fx.owner)), Vector(write), stepRepo, 1000, Some(guard))
  }

  private def park(inTx: Promise[Unit], release: Promise[Unit]): DBIO[Unit] =
    DBIO.successful(()).map { _ => inTx.trySuccess(()); () }.andThen(DBIO.from(release.future))

  "the write-back's run-open guard against a workspace teardown (HEL-1541 3.4, D4/D7)" should {

    "let both finish with no 40P01: the write-back holds only the advisory key, so the teardown deletes everything without waiting and the released write-back then finds its target gone" in {
      val (fx, target) = seedWriteBack()
      val runId = insertOpenRun(fx.pid.value)
      val tag   = tagAll(fx, target)
      val inTx = Promise[Unit](); val release = Promise[Unit]()
      val write = writeBack(fx, target, runRepo.runOpenGuardAction(PipelineRunId(runId)).andThen(park(inTx, release)))
      Await.result(inTx.future, 15.seconds)
      val outcome = Await.result(new WorkspaceTeardownRepository(ctx).teardown(tag, dryRun = false, AuthenticatedUser(UserId(fx.owner))), 30.seconds)
      outcome.committed shouldBe true
      release.success(())
      Await.ready(write, 30.seconds)
      withClue(s"write-back result: ${write.value}: ") { write.value.get.failed.toOption.exists(hasDeadlock) shouldBe false } // finished, no 40P01
      count("pipelines", "id", fx.pid.value) shouldBe 0
      count("data_sources", "id", target) shouldBe 0
    }

    "CONTROL: the rejected round-1 row guard first, parked before the source lock, deadlocks with 40P01" in {
      val (fx, target) = seedWriteBack()
      val runId = insertOpenRun(fx.pid.value)
      val tag   = tagAll(fx, target)
      val inTx = Promise[Unit](); val release = Promise[Unit]()
      val write = writeBack(fx, target, runRepo.runGuardAction(fx.pid, PipelineRunId(runId)).andThen(park(inTx, release)))
      Await.result(inTx.future, 15.seconds)
      val teardown = new WorkspaceTeardownRepository(ctx).teardown(tag, dryRun = false, AuthenticatedUser(UserId(fx.owner)))
      awaitLockWait(teardown) // the teardown holds the target source and waits on the pipeline delete the key-share row lock blocks
      release.success(())
      val settled = Try { Await.ready(write, 60.seconds); Await.ready(teardown, 60.seconds) }
      settled.isSuccess shouldBe true
      val failures = Seq(write.value.get, teardown.value.get).collect { case Failure(e) => e }
      withClue(s"failures: $failures: ") { failures.exists(hasDeadlock) shouldBe true }
    }
  }
}
