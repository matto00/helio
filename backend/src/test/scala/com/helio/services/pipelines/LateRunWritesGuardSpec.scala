package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.services.ServiceError
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future, Promise}
import scala.util.Try

/** HEL-1541 -- every success-chain write of a real run (not just the node snapshots HEL-1518 guarded) must write nothing for
 *  a run reaped after the executor's early open-check: the per-Output schema (W3), the binary refs (W4), alert firing and
 *  resolve (W5), the schema-drift baseline (W10, owner and editor run) and the `upsertsource` write-back (W1). W3-W5 and W10
 *  run only after the run's own `succeeded` write won; W1 takes a run-scoped advisory key the reaper try-locks (design.md D1/D4).
 *
 *  Orderings are forced by the seams in [[LateFinisherSpecBase]] (held terminal write, `afterNodeWrite`, `beforeOutputList`,
 *  `afterEarlyCheck`) and by lock-wait polling, never sleeps. The app pool is the harness's NOBYPASSRLS role, so the W1
 *  write-back's owner-context run-state read is proven under RLS (standing constraint C3). */
class LateRunWritesGuardSpec extends LateFinisherSpecBase {

  override def beforeAll(): Unit = {
    super.beforeAll()
    assertAppPoolEnforcesRls() // C3: the owner-context run-state read is only proven if the app pool really enforces RLS
  }

  private val AlreadyFinalized = ServiceError.Conflict("Run was already finalized as abandoned before it finished")

  // The run-open advisory class id the write-back transaction holds and the reaper try-locks (design.md D4).

  // ── seeding helpers ──────────────────────────────────────────────────────────────────────────────

  private def outputSchemas(fx: Fx): Vector[String] =
    awaitDb(db.run(sql"SELECT schema::text FROM outputs WHERE pipeline_id = ${fx.pid.value}".as[String])).toVector
  private def binaryRefCount(fx: Fx): Int = count("binary_refs", "pipeline_id", fx.pid.value)
  private def baselineOf(fx: Fx): Option[String] =
    awaitDb(db.run(sql"SELECT last_source_schema::text FROM pipelines WHERE id = ${fx.pid.value}".as[Option[String]].head))

  /** A rule on the step node's plain Output: `metric "*"` is the row count (3), so `gt 0` fires and `lt 0` clears. */
  private def seedRule(fx: Fx, comparator: String): AlertRule = {
    val now = Instant.now()
    val rule = AlertRule(
      id = AlertRuleId(UUID.randomUUID().toString), ownerId = UserId(fx.owner), metric = "*",
      condition = JsObject("comparator" -> JsString(comparator), "threshold" -> JsNumber(0)),
      name = s"rule-$comparator", enabled = true, severity = Severity.Warning, createdAt = now, updatedAt = now,
      targetOutputId = OutputId(fx.p.plainOutput)
    )
    awaitDb(alertRuleRepo.insert(rule, AuthenticatedUser(UserId(fx.owner))))
  }

  private def seedFiringEvent(fx: Fx, rule: AlertRule): Unit =
    awaitDb(alertEventRepo.upsertFiringInternal(rule.id, UserId(fx.owner), rule.targetOutputId, JsNumber(5), None, Severity.Warning)).state shouldBe AlertEventState.Firing

  private def activeEvent(rule: AlertRule): Option[AlertEvent] = awaitDb(alertEventRepo.findActiveByRule(rule.id))

  private def grantEditor(fx: Fx): String = {
    val editor = seedUser("beta")
    grantPipeline(fx.pid.value, editor, "editor")
    editor
  }

  private def targetRows(target: String): Int = count("dataset_rows", "data_source_id", target)

  /** The run is reaped AFTER its first node's write committed and BEFORE its own `succeeded` write (held until then), so
   *  W6 loses and every write that was still to come belongs to a reaped run. */
  private def reapAfterFirstNode(): Unit = {
    val reaped = Promise[Unit]()
    terminalGate = reaped.future
    afterNodeWrite = n => if (n == 1) reapAll().map(_ => reaped.trySuccess(())) else Future.unit
  }

  /** Runs `fx` with the reap forced between its first node write and its terminal write; asserts the shared outcome. */
  private def lateReapedRun(fx: Fx, who: Option[String] = None): Unit = {
    binaryTarget = (fx.pid.value, fx.p.stepId.value)
    reapAfterFirstNode()
    val res = Try(Await.result(submitAsync(fx, binary = true, who), 60.seconds))
    res.get shouldBe Left(AlreadyFinalized)
    runStatus(fx) shouldBe "failed"
    eventsOf(fx) should not contain "succeeded"
  }

  // ── 3.1: each write of a run reaped after the early check ───────────────────────────────────────

  "a run reaped after its first node write (HEL-1541 3.1)" should {

    "write no per-Output schema (W3)" in {
      val fx = seed()
      lateReapedRun(fx)
      outputSchemas(fx).distinct shouldBe Vector("[]")
    }

    "write no binary refs (W4)" in {
      val fx = seed()
      lateReapedRun(fx)
      binaryRefCount(fx) shouldBe 0
    }

    "fire no alert (W5, firing)" in {
      val fx   = seed()
      val rule = seedRule(fx, "gt")
      lateReapedRun(fx)
      activeEvent(rule) shouldBe None
    }

    "resolve no alert (W5, resolve)" in {
      val fx   = seed()
      val rule = seedRule(fx, "lt")
      seedFiringEvent(fx, rule)
      lateReapedRun(fx)
      activeEvent(rule).map(_.state) shouldBe Some(AlertEventState.Firing)
    }

    "write no schema-drift baseline for an owner run (W10)" in {
      val fx = seed()
      lateReapedRun(fx)
      baselineOf(fx) shouldBe None
    }

    "write no schema-drift baseline for an editor run (W10, privileged path)" in {
      val fx     = seed()
      val editor = grantEditor(fx)
      lateReapedRun(fx, Some(editor))
      baselineOf(fx) shouldBe None
    }
  }

  // ── 3.2: the write-back (W1) ─────────────────────────────────────────────────────────────────────

  "a run reaped between the early open-check and its upsertsource write-back (HEL-1541 3.2, W1)" should {

    "write no dataset row, no terminal write of its own and no event, and answer 409" in {
      val (fx, target) = seedWriteBack()
      afterEarlyCheck = () => reapAll()
      val res = Try(Await.result(submitAsync(fx, binary = false), 60.seconds))
      res.get shouldBe Left(AlreadyFinalized)
      targetRows(target) shouldBe 0
      runStatus(fx) shouldBe "failed"
      scalar(s"SELECT error_log FROM pipeline_runs WHERE pipeline_id = '${fx.pid.value}'") should startWith("Run abandoned")
      val published = eventsOf(fx) // `queued`/`running`/progress precede the write-back; no TERMINAL event may follow it
      published should not contain "failed"
      published should not contain "succeeded"
    }

    "keep the write-back rows that committed before the reap and write nothing else (W3-W5, W10 skipped)" in {
      val (fx, target) = seedWriteBack()
      val reaped = Promise[Unit]()
      terminalGate = reaped.future
      binaryTarget = (fx.pid.value, fx.p.stepId.value)
      // `beforeOutputList` runs after the write-back transaction committed and before the node fold.
      beforeOutputList = () => reapAll().map(_ => reaped.trySuccess(()))
      val res = Try(Await.result(submitAsync(fx, binary = true), 60.seconds))
      res.get shouldBe Left(AlreadyFinalized)
      targetRows(target) shouldBe 2
      binaryRefCount(fx) shouldBe 0
      baselineOf(fx) shouldBe None
      outputSchemas(fx).distinct shouldBe Vector("[]")
    }
  }

  // ── 3.3: the reaper skips a run whose write-back transaction is open ────────────────────────────

  private def insertStaleOpenRun(fx: Fx): String = {
    val id = UUID.randomUUID().toString
    awaitDb(db.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source, heartbeat_at)
                          VALUES ($id, ${fx.pid.value}, 'queued', now() - interval '2 hours', NULL, 'manual', now() - interval '20 minutes')"""))
    id
  }

  "the reaper (HEL-1541 3.3, D4)" should {

    "skip, without waiting, a run whose REAL write-back guard holds its run-open key on the RLS app pool, and reap it on a later pass" in {
      val (fx, target) = seedWriteBack()
      val runId = insertStaleOpenRun(fx)
      val inTx = Promise[Unit](); val release = Promise[Unit]()
      // The real guard (`runOpenGuardAction`) first in the owner's write-back transaction on the NOBYPASSRLS app pool (C3),
      // then parked until `release`: the shared advisory key is held for the park, exactly as in production.
      val park: DBIO[Unit] = DBIO.successful(()).map { _ => inTx.trySuccess(()); () }.andThen(DBIO.from(release.future))
      val guard = runRepo.runOpenGuardAction(PipelineRunId(runId)).andThen(park)
      val write = PendingWrite(fx.p.stepId.value, UpsertSourceConfig(UpsertTarget.ExistingSource(target), UpsertMode.Append), Seq(Map("name" -> "alice")))
      val parked = dataSourceRepo.applyWriteBacks(AuthenticatedUser(UserId(fx.owner)), Vector(write), stepRepo, 1000, Some(guard))
      Await.result(inTx.future, 15.seconds)
      val during = awaitDb(reapIds())
      during should not contain runId
      scalar(s"SELECT status FROM pipeline_runs WHERE id = '$runId'") shouldBe "queued"
      release.success(())
      Await.result(parked, 15.seconds) shouldBe Right(())
      targetRows(target) shouldBe 1 // the released write-back committed
      awaitDb(reapIds()) should contain(runId)
      scalar(s"SELECT status FROM pipeline_runs WHERE id = '$runId'") shouldBe "failed"
    }
  }

  // ── 3.5: healthy positive controls ───────────────────────────────────────────────────────────────

  private def healthyAssertions(fx: Fx, fire: AlertRule, clear: AlertRule): Unit = {
    outputSchemas(fx).foreach(_ should not be "[]")
    binaryRefCount(fx) shouldBe 1
    activeEvent(fire).map(_.state) shouldBe Some(AlertEventState.Firing)
    activeEvent(clear) shouldBe None // resolved
    baselineOf(fx) should not be None
    runStatus(fx) shouldBe "succeeded"
    count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 6
  }

  "a healthy, never-reaped run (HEL-1541 3.5, positive controls)" should {

    "land every write for an owner run" in {
      val fx    = seed()
      val fire  = seedRule(fx, "gt")
      val clear = seedRule(fx, "lt"); seedFiringEvent(fx, clear)
      binaryTarget = (fx.pid.value, fx.p.stepId.value)
      Await.result(submitAsync(fx), 60.seconds).isRight shouldBe true
      healthyAssertions(fx, fire, clear)
    }

    "land every write for an editor run" in {
      val fx     = seed()
      val editor = grantEditor(fx)
      val fire   = seedRule(fx, "gt")
      val clear  = seedRule(fx, "lt"); seedFiringEvent(fx, clear)
      binaryTarget = (fx.pid.value, fx.p.stepId.value)
      Await.result(submitAsync(fx, binary = true, Some(editor)), 60.seconds).isRight shouldBe true
      healthyAssertions(fx, fire, clear)
    }

    "land every write when the run's own succeeded write commits before the node writes" in {
      val fx    = seed()
      val fire  = seedRule(fx, "gt")
      val clear = seedRule(fx, "lt"); seedFiringEvent(fx, clear)
      binaryTarget = (fx.pid.value, fx.p.stepId.value)
      val written = terminalWritten
      beforeNodeFold = () => written.future // the node fold starts only after the terminal write returned
      Await.result(submitAsync(fx), 60.seconds).isRight shouldBe true
      healthyAssertions(fx, fire, clear)
    }

    "land the write-back rows for a never-reaped run" in {
      val (fx, target) = seedWriteBack()
      Await.result(submitAsync(fx, binary = false), 60.seconds).isRight shouldBe true
      targetRows(target) shouldBe 2
      runStatus(fx) shouldBe "succeeded"
    }
  }
}
