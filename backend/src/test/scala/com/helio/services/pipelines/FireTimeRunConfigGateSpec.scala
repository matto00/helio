package com.helio.services.pipelines

import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField, ComputeConfig}
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.audit.AuditService
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.JsString

import java.nio.file.Paths
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1384 -- the run-config gate is evaluated at FIRE time on both scheduler paths.
 *
 *  Gap 1 (debounced auto-run, config + cost verdict flipped after the write), gap 2 (scheduled cron
 *  runs not config-gated at all), gap 3 (a pending debounce row survives a later denial).
 *
 *  Red-first (assertion failures on unmodified main): the "gap" tests below, and the two
 *  undecodable-step-config tests (HEL-1429: re-run against 1bf11f55, the parent of HEL-1384's merge,
 *  both fail on `submitAttempted(s) shouldBe false`, not on a compile or uncaught-exception error).
 *  GUARDS (green on main by design; each is shown failing against a deliberate mutation in the
 *  delivery evidence): the "negative controls" group, the 2.4a failed-run-recording test, and the
 *  run-history cap test's prune assertion.
 *
 *  Literals (not symbols) are used for the skip prefix and log wording so the spec compiles and
 *  fails on assertions against main. */
class FireTimeRunConfigGateSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository       = _
  private var pipelineStepRepo: PipelineStepRepository   = _
  private var pipelineRepo: PipelineRepository           = _
  private var pipelineRootRepo: PipelineRootRepository   = _
  private var pipelineRunRepo: PipelineRunRepository     = _
  private var scheduleRepo: PipelineScheduleRepository   = _
  private var debounceRepo: PipelineAutoRunDebounceRepository = _
  private var guardRepo: PipelineRunGuardRepository      = _
  private var auditService: AuditService                 = _

  private val SkipPrefix = "Step configuration invalid; scheduled run not attempted: "

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(20))
    ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRootRepo = new PipelineRootRepository(ctx)
    pipelineRunRepo  = new PipelineRunRepository(ctx)
    scheduleRepo     = new PipelineScheduleRepository(ctx)
    debounceRepo     = new PipelineAutoRunDebounceRepository(ctx)
    guardRepo        = new PipelineRunGuardRepository(ctx)
    auditService     = new AuditService(new AuditEventRepository(ctx))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private class FakeClock(@volatile private var instant: Instant) extends Clock {
    def set(i: Instant): Unit   = instant = i
    override def now(): Instant = instant
  }

  private val t0 = Instant.parse("2026-03-01T00:00:00Z")

  private val bigGuard = PipelineRunGuardConfig(
    rateLimitPerWindow = 1000, rateWindowSeconds = 60, maxConcurrent = 100,
    concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30
  )

  // The PipelineRunService under test wires a REAL guard repo (HEL-505 budget is observable) and a
  // REAL audit service (a submit audit event is observable).
  private def newRunService(repo: PipelineRunRepository = pipelineRunRepo): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, repo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      auditService = auditService, pipelineRunGuardRepo = guardRepo, guardConfig = bigGuard,
      outputRepo = new OutputRepository(ctx)
    )

  private def newTrigger(): AutoRunTriggerService =
    new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, 1L)

  private def newScheduler(runService: PipelineRunService, clock: Clock): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineStepRepo, pipelineRunRepo, runService, clock,
      pipelineRunGuardRepo = guardRepo, autoRunDebounceRepo = debounceRepo,
      autoRunTriggerService = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo)
    )

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"DELETE FROM pipeline_run_rate_window",
      sqlu"DELETE FROM pipelines",
      sqlu"DELETE FROM dataset_rows",
      sqlu"DELETE FROM data_sources",
      sqlu"DELETE FROM users"
    )))
  }

  /** A pipeline over a one-row dataset plus its owner. */
  private final case class Scenario(owner: UserId, dsId: DataSourceId, pid: PipelineId) {
    def user: AuthenticatedUser = AuthenticatedUser(owner)
  }

  private def seedScenario(): Scenario = {
    import PostgresProfile.api._
    val ownerId = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"$ownerId@test.local"}, now())"""))
    val owner  = UserId(ownerId)
    val now    = Instant.now()
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "ds", owner, now, now)
    val declared = Vector(DatasetFieldDeclaration("name", DataFieldType.StringType))
    val schema = declared.map(f => SchemaField(f.name, DataFieldType.asString(f.fieldType)))
    await(dataSourceRepo.insertDatasetSource(source, declared, Vector(Vector(JsString("seed"))), schema, AuthenticatedUser(owner)))
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES (${UUID.randomUUID().toString}, $pid, ${source.id.value}, 0)"""
    )))
    Scenario(owner, source.id, PipelineId(pid))
  }

  /** A `compute` step with an EMPTY required `column` -- certain to fail `STEP_CONFIG_INVALID`. */
  private def seedMisconfiguredStep(s: Scenario, enabled: Boolean): PipelineStep =
    await(pipelineStepRepo.insertInternal(s.pid, "compute", ComputeConfig("", "1 + 1", None), enabled = enabled, parentStepId = None, explicitRootId = None))

  /** An `analyzewithai` step: valid config, but the cost verdict denies auto-run for it (`ai-step`). */
  private def seedAiStep(s: Scenario, enabled: Boolean): PipelineStep = {
    val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
    await(pipelineStepRepo.insertInternal(s.pid, "analyzewithai", cfg, enabled = enabled, parentStepId = None, explicitRootId = None))
  }

  private def setStepEnabled(step: PipelineStep, enabled: Boolean): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE pipeline_steps SET enabled = $enabled WHERE id = ${step.id.value}"))
  }

  /** Persist a step config that cannot be decoded -- `listByPipelineInternal` throws on every call. */
  private def corruptStepConfig(step: PipelineStep): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE pipeline_steps SET config = 'not json' WHERE id = ${step.id.value}"))
  }

  private def seedDueSchedule(s: Scenario, due: Instant): PipelineScheduleId = {
    val now = Instant.now()
    val sched = PipelineSchedule(
      PipelineScheduleId(UUID.randomUUID().toString), s.pid, ScheduleKind.Interval, "30m", enabled = true,
      timezone = "UTC", nextRunAt = Some(due), lastRunAt = None, createdAt = now, updatedAt = now
    )
    await(scheduleRepo.upsert(sched, s.user))
    sched.id
  }

  private def runs(s: Scenario): Vector[PipelineRunRepository.PipelineRunRow] = await(pipelineRunRepo.listByPipelineInternal(s.pid))

  private def rateWindowCount(s: Scenario): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT coalesce(sum(request_count), 0) FROM pipeline_run_rate_window WHERE user_id = ${s.owner.value}::uuid".as[Int].head))
  }

  private def submitAuditCount(s: Scenario): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM audit_events WHERE action = 'pipeline.run.submit' AND resource_id = ${s.pid.value}".as[Int].head))
  }

  /** True when `submit` was ever entered for the pipeline. The audit event is written before the
   *  run starts, so unlike the rate window it is also written when the engine then throws on an
   *  undecodable step config (the rate window is only touched past the step listing). The audit
   *  write is asynchronous, hence the short settle. */
  private def submitAttempted(s: Scenario): Boolean = { Thread.sleep(300); submitAuditCount(s) > 0 }

  private def debounceRowExists(s: Scenario): Boolean = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT 1 FROM pipeline_auto_run_debounce WHERE pipeline_id = ${s.pid.value}".as[Int])).nonEmpty
  }

  private def nextRunAt(s: Scenario): Option[Instant] = await(scheduleRepo.findByPipelineId(s.pid, s.user)).get.nextRunAt

  /** Captures the scheduler's log output for the duration of `body`. */
  private def captureSchedulerLog[T](body: => T): (T, Vector[String]) = {
    val logger   = LoggerFactory.getLogger(classOf[PipelineSchedulerService]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]()
    val prior    = logger.getLevel
    logger.setLevel(Level.INFO)
    appender.start(); logger.addAppender(appender)
    try {
      val r = body
      (r, appender.list.asScala.toVector.map(_.getFormattedMessage))
    } finally { logger.detachAppender(appender); logger.setLevel(prior) }
  }

  // ---------------------------------------------------------------------------------------------
  // Gap 2: scheduled (cron) runs
  // ---------------------------------------------------------------------------------------------

  "a scheduled fire of a pipeline with a misconfigured enabled step (gap 2)" should {

    "record a failed never-attempted run: no HEL-505 budget, no submit audit, scheduled trigger, schedule advances" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      seedDueSchedule(s, t0.minusSeconds(60))
      setStepEnabled(step, enabled = true) // "turning a step on is not re-checked"
      val scheduler = newScheduler(newRunService(), clock)

      await(scheduler.tick())

      // Red on main: the submit increments the owner's rate window and writes a submit audit event.
      rateWindowCount(s) shouldBe 0
      submitAuditCount(s) shouldBe 0
      val rs = runs(s)
      rs should have size 1
      // Red on main: the engine's StepExecutionException text, not the gate's fixed prefix.
      rs.head.errorLog.getOrElse("") should startWith(SkipPrefix)
      // Regression checks, green on both branches.
      rs.head.status shouldBe "failed"
      rs.head.triggerSource shouldBe "scheduled"
      await(pipelineRepo.findByIdInternal(s.pid)).get.lastRunStatus shouldBe Some("failed")
      nextRunAt(s) shouldBe Some(t0.plus(30, ChronoUnit.MINUTES))
    }

    "keep at most 10 runs over 12 fires, newest being the recorded skip (1.1a; guard for the prune call)" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      seedDueSchedule(s, t0.minusSeconds(60))
      setStepEnabled(step, enabled = true)
      val scheduler = newScheduler(newRunService(), clock)

      (1 to 12).foreach { i =>
        clock.set(t0.plus(31L * i, ChronoUnit.MINUTES))
        await(scheduler.tick())
        Thread.sleep(5)
      }

      val rs = runs(s)
      rs.size should be <= 10
      rs.size shouldBe 10
      // Red on main: newest run carries the engine's text, not the gate's prefix.
      rs.maxBy(_.startedAt).errorLog.getOrElse("") should startWith(SkipPrefix)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Gaps 1 and 3: debounced auto-run
  // ---------------------------------------------------------------------------------------------

  "a debounced auto-run fire" should {

    "skip, log and release the claim when a step is made misconfigured after the allowed write (gap 1, config)" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      await(newTrigger().triggerAutoRun(s.dsId, s.user, t0)) // allowed: the bad step is disabled
      debounceRowExists(s) shouldBe true
      setStepEnabled(step, enabled = true)
      clock.set(t0.plusSeconds(2))
      val scheduler = newScheduler(newRunService(), clock)

      val (_, logs) = captureSchedulerLog(await(scheduler.tick()))

      runs(s) shouldBe empty
      debounceRowExists(s) shouldBe false
      logs.exists(l => l.contains(s.pid.value) && l.contains("step-config-invalid")) shouldBe true
    }

    "skip, log and release the claim when the cost verdict flips to denied before fire, with no dataset write (gap 1, cost)" in {
      cleanDb()
      val s = seedScenario()
      // Flip mechanism: a disabled analyzewithai step is ENABLED directly in the DB after the allowed
      // write -- PipelineCostEstimator then denies the pipeline with `ai-step` (no write re-evaluates).
      val ai = seedAiStep(s, enabled = false)
      val clock = new FakeClock(t0)
      await(newTrigger().triggerAutoRun(s.dsId, s.user, t0))
      debounceRowExists(s) shouldBe true
      setStepEnabled(ai, enabled = true)
      clock.set(t0.plusSeconds(2))
      val scheduler = newScheduler(newRunService(), clock)

      val (_, logs) = captureSchedulerLog(await(scheduler.tick()))

      runs(s) shouldBe empty
      debounceRowExists(s) shouldBe false
      logs.exists(l => l.contains(s.pid.value) && l.contains("ai-step")) shouldBe true
    }

    "not fire a row left pending by an allowed write once a second write is denied at write time (gap 3)" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      val trigger = newTrigger()
      await(trigger.triggerAutoRun(s.dsId, s.user, t0))
      debounceRowExists(s) shouldBe true
      setStepEnabled(step, enabled = true)
      val second = await(trigger.triggerAutoRun(s.dsId, s.user, t0.plusMillis(500)))
      second.exists(_.isInstanceOf[EvaluatedPipeline.Denied]) shouldBe true // denied at write time
      debounceRowExists(s) shouldBe true // a write-time denial leaves the pending row in place
      clock.set(t0.plusSeconds(2))
      val scheduler = newScheduler(newRunService(), clock)

      await(scheduler.tick())

      runs(s) shouldBe empty
      debounceRowExists(s) shouldBe false
    }
  }

  // ---------------------------------------------------------------------------------------------
  // RED-FIRST, undecodable step config (fails on assertions on pre-HEL-1384 code, 1bf11f55)
  // ---------------------------------------------------------------------------------------------

  "fire-time evaluation error: undecodable step config (red-first)" should {

    "never submit, advance the schedule and not re-attempt, for an undecodable step config" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = true)
      corruptStepConfig(step)
      val clock = new FakeClock(t0)
      seedDueSchedule(s, t0.minusSeconds(60))
      val scheduler = newScheduler(newRunService(), clock)

      await(scheduler.tick())
      submitAttempted(s) shouldBe false // never submitted
      val advanced = nextRunAt(s)
      advanced shouldBe Some(t0.plus(30, ChronoUnit.MINUTES))

      clock.set(t0.plusSeconds(60))
      await(scheduler.tick())
      submitAttempted(s) shouldBe false
      nextRunAt(s) shouldBe advanced // not retried every tick
    }

    "never submit and release the claim for an undecodable step config on the auto-run path" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      await(newTrigger().triggerAutoRun(s.dsId, s.user, t0))
      setStepEnabled(step, enabled = true)
      corruptStepConfig(step)
      clock.set(t0.plusSeconds(2))
      val scheduler = newScheduler(newRunService(), clock)

      await(scheduler.tick())
      submitAttempted(s) shouldBe false
      debounceRowExists(s) shouldBe false // claim released, not stuck
      await(scheduler.tick())
      submitAttempted(s) shouldBe false
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GUARDS (green on main by design; each shown red against a deliberate mutation)
  // ---------------------------------------------------------------------------------------------

  "negative controls (GUARD)" should {

    "not gate a schedule or an auto-run on a schema-derived-only analyze error (HEL-1280 class)" in {
      cleanDb()
      val s = seedScenario()
      // Config is complete; the expression references a column absent from the stored schema, which
      // only analyze's schema-derived pass flags.
      await(pipelineStepRepo.insertInternal(s.pid, "compute", ComputeConfig("c", "$missing_col + 1", Some("string")), enabled = true, parentStepId = None, explicitRootId = None))
      val clock = new FakeClock(t0)
      seedDueSchedule(s, t0.minusSeconds(60))
      val scheduler = newScheduler(newRunService(), clock)
      await(scheduler.tick())
      rateWindowCount(s) shouldBe 1 // submitted
      runs(s).head.errorLog.getOrElse("") should not startWith SkipPrefix

      await(newTrigger().triggerAutoRun(s.dsId, s.user, t0))
      clock.set(t0.plusSeconds(2))
      await(scheduler.tick())
      rateWindowCount(s) shouldBe 2 // the auto-run submitted too
    }

    "not gate on a disabled misconfigured step; a valid pipeline still fires on both paths" in {
      cleanDb()
      val s = seedScenario()
      seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      seedDueSchedule(s, t0.minusSeconds(60))
      val scheduler = newScheduler(newRunService(), clock)
      await(scheduler.tick())
      runs(s).map(_.status) shouldBe Vector("succeeded")

      await(newTrigger().triggerAutoRun(s.dsId, s.user, t0))
      clock.set(t0.plusSeconds(2))
      await(scheduler.tick())
      runs(s).map(_.triggerSource).sorted shouldBe Vector("auto-run", "scheduled")
      runs(s).map(_.status).distinct shouldBe Vector("succeeded")
    }
  }

  "fire-time evaluation error (GUARD)" should {

    "still advance the schedule when recording the failed run itself fails (2.4a)" in {
      cleanDb()
      val s = seedScenario()
      val step = seedMisconfiguredStep(s, enabled = false)
      val clock = new FakeClock(t0)
      seedDueSchedule(s, t0.minusSeconds(60))
      setStepEnabled(step, enabled = true)
      val failingRepo = new PipelineRunRepository(ctx) {
        override def updateRunTerminal(
            runId: PipelineRunId, status: String, completedAt: Instant, rowCount: Option[Int],
            errorLog: Option[String], user: AuthenticatedUser, truncatedReadsJson: Option[String]
        ): Future[Unit] = Future.failed(new RuntimeException("boom: updateRunTerminal"))
      }
      val scheduler = newScheduler(newRunService(failingRepo), clock)

      await(scheduler.tick())

      nextRunAt(s) shouldBe Some(t0.plus(30, ChronoUnit.MINUTES))
      clock.set(t0.plusSeconds(60))
      await(scheduler.tick())
      nextRunAt(s) shouldBe Some(t0.plus(30, ChronoUnit.MINUTES)) // not re-fired
    }
  }
}
