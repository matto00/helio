package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.Paths
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1097 tasks.md 3.4, reversed by HEL-1504 (design.md D2/D6 case d) -- `dataset-write-auto-run`'s
 *  "A guard-rejected auto-run's debounce claim is released without a retry storm" scenario: a guard
 *  rejection no longer drops the write. The claim is handed back (never stuck), the row is re-armed for
 *  the rejection's Retry-After, at most one attempt happens per pipeline per tick, none happens before
 *  the Retry-After, and after the configured number of re-attempts the row is removed so no further
 *  attempt occurs unless a NEW dataset write re-schedules the debounce. Every assertion reads
 *  `pipeline_auto_run_debounce`/`pipeline_runs` row state directly, driving
 *  `PipelineSchedulerService.tick()` across synthetic ticks on an injected clock (scheduler and guard)
 *  -- never a log line, never the actor/timer. */
class AutoRunGuardNoRetryStormSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(20))
    ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRootRepo  = new PipelineRootRepository(ctx)
    pipelineRunRepo   = new PipelineRunRepository(ctx)
    scheduleRepo      = new PipelineScheduleRepository(ctx)
    debounceRepo      = new PipelineAutoRunDebounceRepository(ctx)
    guardRepo         = new PipelineRunGuardRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

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

  private class FakeClock(@volatile private var instant: Instant) extends Clock {
    def set(i: Instant): Unit   = instant = i
    override def now(): Instant = instant
  }

  private def seedUser(id: String = UUID.randomUUID().toString): UserId = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now())
                          ON CONFLICT DO NOTHING"""))
    UserId(id)
  }

  private def seedDataset(owner: UserId): DataSourceId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', ${owner.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    DataSourceId(dsId)
  }

  private def seedPipeline(owner: UserId, dsId: DataSourceId): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES (${UUID.randomUUID().toString}, $pid, ${dsId.value}, 0)"""
    )))
    PipelineId(pid)
  }

  private def runCount(pid: PipelineId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT count(*) FROM pipeline_runs WHERE pipeline_id = ${pid.value}""".as[Int].head))
  }

  /** (fire_at, claimed_at, guard_retry_count) of the pipeline's pending debounce row. */
  private def debounceState(pid: PipelineId): (Instant, Option[Instant], Int) = {
    import PostgresProfile.api._
    val (fireAt, claimedAt, retries) =
      await(db.run(sql"""SELECT fire_at, claimed_at, guard_retry_count FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}"""
        .as[(Timestamp, Option[Timestamp], Int)].head))
    (fireAt.toInstant, claimedAt.map(_.toInstant), retries)
  }

  private def debounceRowExists(pid: PipelineId): Boolean = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT 1 FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}""".as[Int])).nonEmpty
  }

  private def newTriggerService(debounceSeconds: Long): AutoRunTriggerService =
    new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds)

  private def newRunService(guardConfig: PipelineRunGuardConfig, guardClock: Clock): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      pipelineRunGuardRepo = guardRepo, guardConfig = guardConfig,
      outputRepo = new OutputRepository(ctx), guardClock = guardClock
    )

  private def newScheduler(runService: PipelineRunService, clock: Clock): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineStepRepo, pipelineRunRepo, runService, clock,
      autoRunDebounceRepo = debounceRepo,
      autoRunTriggerService = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo), staleClaimAfterSeconds = 300L
    )

  "a guard-rejected auto-run's debounce row (HEL-1097 tasks.md 3.4, reversed by HEL-1504 / spec: " +
    "'A guard-rejected auto-run's debounce claim is released without a retry storm')" should {

    "be re-armed after each rejection's Retry-After at most N times with one attempt per tick, then be " +
      "removed -- only a NEW write re-schedules a fresh attempt" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val user  = AuthenticatedUser(owner)

      // A limit of 0 makes every fire attempt deterministically denied (PipelineRunGuardRepository
      // .incrementRateIfUnderLimit's own `limit < 1` short-circuit). The 300 s window makes the
      // Retry-After the remainder of the current window, on the injected guard clock.
      val alwaysDeniedGuard = PipelineRunGuardConfig(rateLimitPerWindow = 0, rateWindowSeconds = 300, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15,
        sourceFetchRateLimitPerWindow = 30, autoRunMaxRetries = 2)
      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clock = new FakeClock(t0)
      val runService = newRunService(alwaysDeniedGuard, clock)
      val triggerService = newTriggerService(debounceSeconds = 2L)
      val scheduler = newScheduler(runService, clock)

      await(triggerService.triggerAutoRun(dsId, user, t0))
      debounceRowExists(pid) shouldBe true

      // Tick #1 (t0+3): denied (Retry-After 297 s) -> claim handed back, re-armed for t0+300.
      clock.set(t0.plusSeconds(3))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceState(pid) shouldBe ((t0.plusSeconds(300), None, 1))

      // Ticks before the Retry-After elapses: no attempt (the row is untouched).
      for (i <- 1 to 4) {
        clock.set(t0.plusSeconds(3 + 50L * i))
        await(scheduler.tick())
        withClue(s"before the Retry-After, tick $i: ") {
          runCount(pid) shouldBe 0
          debounceState(pid) shouldBe ((t0.plusSeconds(300), None, 1))
        }
      }

      // Tick at t0+300 (>= Retry-After): exactly one attempt, denied again -> second re-arm.
      clock.set(t0.plusSeconds(300))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceState(pid) shouldBe ((t0.plusSeconds(600), None, 2))

      // Tick at t0+600: the third rejection finds the allowance (2) spent -> the row is removed.
      clock.set(t0.plusSeconds(600))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe false

      // Later ticks: the SAME denied write never reappears.
      for (i <- 1 to 3) {
        clock.set(t0.plusSeconds(600 + 300L * i))
        await(scheduler.tick())
        withClue(s"after exhaustion, tick $i: ") {
          runCount(pid) shouldBe 0
          debounceRowExists(pid) shouldBe false
        }
      }

      // A FRESH dataset write DOES re-schedule, with a fresh allowance.
      val t1 = t0.plusSeconds(2000)
      await(triggerService.triggerAutoRun(dsId, user, t1))
      debounceState(pid) shouldBe ((t1.plusSeconds(2), None, 0))
    }
  }
}
