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

/** HEL-1504 -- a dataset write's debounced auto-run must not be silently dropped when it comes due
 *  while (a) the pipeline already has an active run, (b) the owner is rate-limited, or (c) the owner
 *  is at the concurrency cap. Every assertion reads `pipeline_auto_run_debounce` / `pipeline_runs` /
 *  `pipeline_run_rate_window` rows while driving `PipelineSchedulerService.tick()` on an injected
 *  clock (scheduler and guard both) -- no sleeps, no log assertions. */
class DatasetWriteAutoRunDroppedFireSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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

  /** CR2 fixture rule: an in-flight run has BOTH `status = 'running'` (what the concurrency cap
   *  counts) and `completed_at IS NULL` (what the active-run check reads). */
  private def seedInFlightRun(pid: PipelineId, startedAt: Instant): PipelineRunId = {
    import PostgresProfile.api._
    val runId = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at)
                          VALUES ($runId, ${pid.value}, 'running', ${Timestamp.from(startedAt)}, NULL)"""))
    PipelineRunId(runId)
  }

  /** Completes via the repository's own terminal update, which sets status AND completed_at. */
  private def completeRun(runId: PipelineRunId, at: Instant): Unit =
    await(pipelineRunRepo.updateRunTerminalInternal(
      runId, "succeeded", at, Some(1), errorLog = None, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson)
    ))

  private def runCount(pid: PipelineId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT count(*) FROM pipeline_runs WHERE pipeline_id = ${pid.value}""".as[Int].head))
  }

  private def debounceRowExists(pid: PipelineId): Boolean = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT 1 FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}""".as[Int])).nonEmpty
  }

  /** (fire_at, claimed_at, guard_retry_count) of the pipeline's pending debounce row. */
  private def debounceState(pid: PipelineId): (Instant, Option[Instant], Int) = {
    import PostgresProfile.api._
    val (fireAt, claimedAt, retries) =
      await(db.run(sql"""SELECT fire_at, claimed_at, guard_retry_count FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}"""
        .as[(Timestamp, Option[Timestamp], Int)].head))
    (fireAt.toInstant, claimedAt.map(_.toInstant), retries)
  }

  private def rateCount(owner: UserId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT coalesce(sum(request_count), 0) FROM pipeline_run_rate_window WHERE user_id = ${owner.value}::uuid""".as[Int].head))
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

  // Epoch-aligned to a minute so the guard's 60s rate window boundaries are exact.
  private val t0 = Instant.parse("2026-01-01T00:00:00Z")

  private def guardConfig(rateLimit: Int, maxConcurrent: Int, maxRetries: Int = 10) =
    PipelineRunGuardConfig(rateLimitPerWindow = rateLimit, rateWindowSeconds = 60, maxConcurrent = maxConcurrent, concurrencyRetryAfterSeconds = 15,
      sourceFetchRateLimitPerWindow = 30, autoRunMaxRetries = maxRetries)

  "a dataset write's debounced auto-run (HEL-1504)" should {

    "(a) stay pending while the pipeline's run is in flight and fire exactly once after it completes" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val clock = new FakeClock(t0)
      val scheduler = newScheduler(newRunService(guardConfig(rateLimit = 100, maxConcurrent = 100), clock), clock)

      val active = seedInFlightRun(pid, t0.minusSeconds(60))
      await(newTriggerService(debounceSeconds = 2L).triggerAutoRun(dsId, AuthenticatedUser(owner), t0))

      clock.set(t0.plusSeconds(3))
      await(scheduler.tick())
      runCount(pid) shouldBe 1
      debounceRowExists(pid) shouldBe true
      // Kept pending untouched: un-claimed, still due, no retry consumed.
      debounceState(pid) shouldBe ((t0.plusSeconds(2), None, 0))

      // A later tick still finds the run in flight: still pending, still no second run.
      clock.set(t0.plusSeconds(10))
      await(scheduler.tick())
      runCount(pid) shouldBe 1
      debounceRowExists(pid) shouldBe true

      completeRun(active, t0.plusSeconds(11))
      clock.set(t0.plusSeconds(12))
      await(scheduler.tick())
      runCount(pid) shouldBe 2
      debounceRowExists(pid) shouldBe false

      // Nothing left to fire.
      clock.set(t0.plusSeconds(20))
      await(scheduler.tick())
      runCount(pid) shouldBe 2
    }

    "(b) stay scheduled when rate-limited and fire exactly once after the rate window resets" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val clock = new FakeClock(t0)
      val scheduler = newScheduler(newRunService(guardConfig(rateLimit = 1, maxConcurrent = 100), clock), clock)

      // Saturate the owner's budget for the window containing t0 (limit 1).
      import PostgresProfile.api._
      await(db.run(sqlu"""INSERT INTO pipeline_run_rate_window (user_id, window_start, request_count)
                            VALUES (${owner.value}::uuid, ${Timestamp.from(t0)}, 1)"""))
      await(newTriggerService(debounceSeconds = 2L).triggerAutoRun(dsId, AuthenticatedUser(owner), t0))

      clock.set(t0.plusSeconds(3))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe true
      // Re-armed for the rejection's Retry-After (the window remainder: 57 s from t0+3).
      debounceState(pid) shouldBe ((t0.plusSeconds(60), None, 1))

      // Still inside the saturated window, before the Retry-After elapsed: no attempt, row kept.
      clock.set(t0.plusSeconds(30))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe true

      // The window has reset: exactly one run.
      clock.set(t0.plusSeconds(61))
      await(scheduler.tick())
      runCount(pid) shouldBe 1
      debounceRowExists(pid) shouldBe false
    }

    "(c) stay scheduled, without burning a rate slot, while the owner is at the concurrency cap, and fire once a slot frees" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val other1 = seedPipeline(owner, seedDataset(owner))
      val other2 = seedPipeline(owner, seedDataset(owner))
      val clock = new FakeClock(t0)
      val scheduler = newScheduler(newRunService(guardConfig(rateLimit = 100, maxConcurrent = 2), clock), clock)

      val run1 = seedInFlightRun(other1, t0.minusSeconds(60))
      seedInFlightRun(other2, t0.minusSeconds(60))
      await(newTriggerService(debounceSeconds = 2L).triggerAutoRun(dsId, AuthenticatedUser(owner), t0))
      rateCount(owner) shouldBe 0

      clock.set(t0.plusSeconds(3))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe true
      // The rejected attempt must not have consumed one of the owner's rate slots.
      rateCount(owner) shouldBe 0
      // Re-armed for the advisory concurrency Retry-After (15 s).
      debounceState(pid) shouldBe ((t0.plusSeconds(18), None, 1))

      completeRun(run1, t0.plusSeconds(4))
      clock.set(t0.plusSeconds(20))
      await(scheduler.tick())
      runCount(pid) shouldBe 1
      debounceRowExists(pid) shouldBe false
    }

    "(d) stop re-arming once the retry allowance is spent: dropped after N re-attempts, nothing fires, and only a fresh write starts over" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val clock = new FakeClock(t0)
      // A rate limit of 0 rejects every attempt, however the window moves.
      val scheduler = newScheduler(newRunService(guardConfig(rateLimit = 0, maxConcurrent = 100, maxRetries = 3), clock), clock)
      val triggerService = newTriggerService(debounceSeconds = 2L)
      await(triggerService.triggerAutoRun(dsId, AuthenticatedUser(owner), t0))

      // Attempts 1..3 are re-armed; each fire lands >= Retry-After after the previous rejection.
      for (attempt <- 1 to 3) {
        clock.set(t0.plusSeconds(100L * attempt))
        await(scheduler.tick())
        withClue(s"after attempt $attempt: ") {
          runCount(pid) shouldBe 0
          debounceRowExists(pid) shouldBe true
          debounceState(pid)._3 shouldBe attempt
        }
      }

      // The 4th rejection finds the allowance spent: the row is gone.
      clock.set(t0.plusSeconds(400))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe false

      // Later ticks do nothing.
      clock.set(t0.plusSeconds(500))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe false

      // A FRESH write starts a new allowance (counter back to 0).
      await(triggerService.triggerAutoRun(dsId, AuthenticatedUser(owner), t0.plusSeconds(600)))
      debounceState(pid)._3 shouldBe 0
    }
  }
}
