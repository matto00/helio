package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model.PipelineRunId
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository.{RunNoLongerOpen, RunState}
import com.helio.services.ServiceError
import spray.json.{JsObject, JsString}
import slick.jdbc.PostgresProfile.api._

import java.sql.DriverManager
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future, Promise}

/** HEL-1518 -- a late finisher of a REAL run: (1) a run whose pipeline was deleted while it executed answers 404 (not
 *  409), a reaped run still 409; (2) a run finalized (reaped or deleted) between the success chain's early open-check and
 *  a node's snapshot write writes nothing for that node and publishes no `succeeded`. The delete-after-the-run-won cases
 *  (HEL-1544 / HEL-1564) live in [[LateFinisherDeleteAfterWonSpec]]; the seams in [[LateFinisherSpecBase]]. */
class LateFinisherRunSpec extends LateFinisherSpecBase {
  "a late finisher (HEL-1518 item 1)" should {

    "answer 404 when its pipeline was deleted while it executed" in {
      val fx = seed()
      afterEngine = () => deletePipeline(fx)
      val (res, _) = submit(fx)
      res shouldBe Left(ServiceError.NotFound(s"Pipeline not found: ${fx.pid.value}"))
      nothingWritten(fx)
      eventsOf(fx) should not contain "succeeded"
    }

    "still answer 409 when its run was reaped and the pipeline still exists" in {
      val fx = seed()
      afterEngine = () => reapAll()
      val (res, _) = submit(fx)
      res shouldBe Left(ServiceError.Conflict("Run was already finalized as abandoned before it finished"))
      runStatus(fx) shouldBe "failed"
      nothingWritten(fx)
    }
  }

  "a run finalized between the early open-check and a node's snapshot write (HEL-1518 item 2)" should {

    "write nothing, publish no succeeded and answer 409 when it was reaped in that window" in {
      val fx = seed()
      val reaped = Promise[Unit]()
      terminalGate = reaped.future // the run's own succeeded write must not beat the reap
      beforeNodeFold = () => reapAll().map(_ => reaped.success(()))
      val (res, _) = submit(fx)
      res shouldBe Left(ServiceError.Conflict("Run was already finalized as abandoned before it finished"))
      runStatus(fx) shouldBe "failed"
      nothingWritten(fx)
      eventsOf(fx) should not contain "succeeded"
    }

    "write nothing, publish no succeeded and answer 404 when its pipeline was deleted in that window" in {
      val fx = seed()
      // HEL-1564: the run's own succeeded write is eager and concurrent with this hook; hold it until the delete finished,
      // or a write that wins first would (correctly) answer success instead of this lost-write 404.
      val deleted = Promise[Unit]()
      terminalGate = deleted.future
      beforeNodeFold = () => deletePipeline(fx).andThen { case _ => deleted.trySuccess(()) }
      val (res, _) = submit(fx)
      res shouldBe Left(ServiceError.NotFound(s"Pipeline not found: ${fx.pid.value}"))
      nothingWritten(fx)
      eventsOf(fx) should not contain "succeeded"
    }
  }
  "a run whose terminal write loses after the node fold (HEL-1518 D7)" should {

    "answer 404, write nothing and publish no succeeded when its pipeline was deleted before the Output list was read" in {
      val fx = seed()
      // The run's own succeeded write is eager and concurrent with this hook; unsequenced, it can commit first (HEL-1544).
      // Hold it until the delete has finished, success or failure, so the delete is what lands first.
      val deleted = Promise[Unit]()
      terminalGate = deleted.future
      beforeOutputList = () => deletePipeline(fx).andThen { case _ => deleted.trySuccess(()) }
      val (res, _) = submit(fx)
      res shouldBe Left(ServiceError.NotFound(s"Pipeline not found: ${fx.pid.value}"))
      nothingWritten(fx)
      eventsOf(fx) should not contain "succeeded"
    }

    "answer 409 and publish no succeeded when the run was reaped after its last node write" in {
      val fx = seed()
      val reaped = Promise[Unit]()
      terminalGate = reaped.future // hold the run's own succeeded write until the reap, which lands after the fold
      beforeNodeFold = () => {
        Future {
          val deadline = System.nanoTime() + 15.seconds.toNanos
          while (count("output_snapshot_history", "pipeline_id", fx.pid.value) < 3 && System.nanoTime() < deadline) Thread.sleep(20)
        }.flatMap(_ => reapAll()).map(_ => reaped.success(()))
        Future.unit
      }
      val (res, _) = submit(fx)
      res shouldBe Left(ServiceError.Conflict("Run was already finalized as abandoned before it finished"))
      runStatus(fx) shouldBe "failed"
      count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 6 // written while the run was open (HEL-1511 Q6)
      eventsOf(fx) should not contain "succeeded"
    }
  }

  // ── Healthy run: the guard must not trip on the run's own succeeded terminal write (standing constraint C1) ──

  "a healthy run whose own succeeded terminal write commits before its node writes (positive control, C1)" should {

    "write every node's snapshots, history and payload, publish succeeded and finish succeeded" in {
      val fx = seed()
      // The success chain starts `updateRun` eagerly, concurrently with the node fold; hold the fold until it committed.
      beforeNodeFold = () => Future {
        val deadline = System.nanoTime() + 15.seconds.toNanos
        while (runStatus(fx) != "succeeded" && System.nanoTime() < deadline) Thread.sleep(20)
        require(runStatus(fx) == "succeeded", "the run's own terminal write never committed -- the control would be vacuous")
      }
      val (res, _) = submit(fx)
      res.isRight shouldBe true
      runStatus(fx) shouldBe "succeeded"
      count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 6 // 2 nodes x 3 rows
      scalar(s"SELECT count(DISTINCT coalesce(node_step_id, root_id)) FROM node_snapshots WHERE pipeline_id = '${fx.pid.value}'").toInt shouldBe 2
      count("output_snapshot_history", "pipeline_id", fx.pid.value) shouldBe 3 // opted + plain on the step node, root-out on the root
      count("node_payload_history", "pipeline_id", fx.pid.value) shouldBe 1
      eventsOf(fx) should contain("succeeded")
    }
  }

  // ── Lock behaviour of the guard itself (design.md D3, D6 b/c) ──

  private def insertOpenRun(fx: Fx): String = {
    val id = UUID.randomUUID().toString
    awaitDb(db.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source, heartbeat_at)
                          VALUES ($id, ${fx.pid.value}, 'queued', now() - interval '2 hours', NULL, 'manual', now() - interval '20 minutes')"""))
    id
  }

  /** Non-vacuity: bounded wait until some backend is blocked on a lock (a wait-for-condition, not a timing assumption).
   *  `pending` is the operation expected to be the waiter: if it already FAILED, that failure is the story, not "no wait". */
  private def awaitAnyLockWait(pending: Future[_]): Unit = {
    val deadline = System.nanoTime() + 60.seconds.toNanos
    def blocked = scalar("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'").toInt > 0
    while (!blocked && !pending.isCompleted && System.nanoTime() < deadline) Thread.sleep(25)
    pending.value.foreach(t => withClue("the operation expected to block finished instead: ")(t.map(_ => ()).get))
    val activity = awaitDb(db.run(sql"SELECT pid::text || ' ' || coalesce(state, '') || ' ' || coalesce(wait_event_type, '-') || ' ' || left(query, 60) FROM pg_stat_activity WHERE datname = current_database()".as[String]))
    withClue(s"no backend ever blocked on a lock -- the case would be vacuous; activity: ${activity.mkString(" | ")}: ") { blocked shouldBe true }
  }

  private val rows3 = Vector(JsObject("label" -> JsString("a")), JsObject("label" -> JsString("b")))

  /** A node write whose `andThen` parks until `release` completes, signalling `inTx` once the guard and replace ran. */
  private def parkedNodeWrite(fx: Fx, runId: String, inTx: Promise[Unit], release: Promise[Unit], tail: DBIO[Unit] = DBIO.successful(())): Future[Unit] = {
    // The signal is raised from INSIDE the transaction (a DBIO step that runs after the guard and replace), never when
    // the DBIO is merely built: a signal raised at construction lets the test race ahead of a transaction not yet begun.
    val park: DBIO[Unit] = DBIO.successful(()).map(_ => { inTx.trySuccess(()); () }).andThen(DBIO.from(release.future)).andThen(tail)
    snapshotRepo.overwriteRowsWith(fx.pid.value, Some(fx.p.stepId.value), rows3, None, park, Some(runRepo.runGuardAction(fx.pid, PipelineRunId(runId))))
  }

  "the in-transaction guard (HEL-1518 D3)" should {

    "make a reap wait for an open node transaction, then finalize the run after it commits" in {
      val fx = seed()
      val runId = insertOpenRun(fx)
      val inTx = Promise[Unit](); val release = Promise[Unit]()
      val write = parkedNodeWrite(fx, runId, inTx, release)
      Await.result(inTx.future, 15.seconds)
      val reaping = reapIds()
      awaitAnyLockWait(reaping)
      reaping.isCompleted shouldBe false
      scalar(s"SELECT status FROM pipeline_runs WHERE id = '$runId'") shouldBe "queued"
      release.success(())
      awaitDb(write)
      awaitDb(reaping) should contain(runId)
      scalar(s"SELECT status FROM pipeline_runs WHERE id = '$runId'") shouldBe "failed"
      count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe rows3.size // committed before the reap
    }

    "let a concurrent pipeline delete finish without a deadlock when the node write holds the guard locks (history + payload inserts follow)" in {
      val fx = seed()
      val runId = insertOpenRun(fx)
      val inTx = Promise[Unit](); val release = Promise[Unit]()
      val now = Instant.now()
      // The FK-bearing inserts (payload -> pipelines, history -> outputs) come AFTER the park, as in production.
      val tail: DBIO[Unit] =
        payloadRepo.writeAction(fx.pid.value, Some(fx.p.stepId.value), None, Some(runId), "manual", now, rows3, PayloadHistoryConfig.Defaults)
          .flatMap(payloadId => historyRepo.insertAction(Seq(
            historyEntry(fx.p.optedOutput, fx.pid.value, now, runId).copy(nodeStepId = Some(fx.p.stepId.value), rootId = None, payloadId = payloadId)
          )))
      val write = parkedNodeWrite(fx, runId, inTx, release, tail)
      Await.result(inTx.future, 15.seconds)
      val deleting = deletePipeline(fx)
      awaitAnyLockWait(deleting)
      deleting.isCompleted shouldBe false
      release.success(())
      awaitDb(write)    // a 40P01 on either side fails one of these two
      awaitDb(deleting)
      count("pipelines", "id", fx.pid.value) shouldBe 0
      count("pipeline_runs", "id", runId) shouldBe 0
    }

    "fail with Missing, writing nothing, when a pipeline delete commits first" in {
      val fx = seed()
      val runId = insertOpenRun(fx)
      val c = DriverManager.getConnection(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      try {
        c.setAutoCommit(false)
        c.createStatement().execute(s"DELETE FROM pipelines WHERE id = '${fx.pid.value}'")
        val inTx = Promise[Unit](); val release = Promise[Unit]()
        release.success(())
        val write = parkedNodeWrite(fx, runId, inTx, release)
        awaitAnyLockWait(write)
        write.isCompleted shouldBe false
        c.commit()
        Await.ready(write, 15.seconds)
        write.failed.value.get.get shouldBe RunNoLongerOpen(RunState.Missing)
      } finally c.close()
      count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 0
    }
  }
}
