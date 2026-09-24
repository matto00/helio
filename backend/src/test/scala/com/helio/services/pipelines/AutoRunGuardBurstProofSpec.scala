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
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1097 tasks.md 3.1/3.2/3.3 -- proof that the pipeline-run guard bounds a burst of
 *  auto-run-triggering dataset writes even when the HEL-1093 debounce coalescing that would
 *  otherwise mask the guard's own necessity is defeated (design.md Decision 1). Every assertion
 *  reads `pipeline_runs` row counts and `pipeline_run_rate_window.request_count` -- never a log
 *  line.
 *
 *  "Debounce defeated" here means writes spaced wider than the debounce window, so each produces
 *  its own independent claim-and-fire cycle (mirrors `DatasetWriteAutoRunCoalescingSpec`'s own
 *  "mutation-proving RED case" framing, extended to the GUARD rather than the debounce itself) --
 *  design.md's Decision 1 alternative (zero-ing the debounce) was rejected there for the same
 *  reason it is not used here: a zero debounce does not exercise "temporal spread", only "no
 *  window at all". */
class AutoRunGuardBurstProofSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
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

  /** Sums `request_count` across every window bucket for `userId` -- the guard's own persisted
   *  admission count, read directly from `pipeline_run_rate_window` rather than inferred from
   *  `pipeline_runs` (which a concurrency-cap rejection, not exercised here, would also affect). */
  private def rateWindowRequestCount(userId: UserId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT COALESCE(SUM(request_count), 0) FROM pipeline_run_rate_window WHERE user_id = ${userId.value}::uuid""".as[Int].head))
  }

  private def newTriggerService(debounceSeconds: Long): AutoRunTriggerService =
    new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds)

  /** `withGuard = false` constructs the fixture WITHOUT `pipelineRunGuardRepo` (design.md Decision
   *  2) -- the standing nullable-optional convention every other collaborator in this class
   *  already uses, reproducing exactly the "guard off" state the AC must never reach in
   *  production. Never touches production wiring (`Main.scala` always passes a real repo). */
  private def newRunService(guardConfig: PipelineRunGuardConfig, withGuard: Boolean): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      pipelineRunGuardRepo = if (withGuard) guardRepo else null,
      guardConfig = guardConfig
    )

  private def newScheduler(runService: PipelineRunService, clock: Clock): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineRunRepo, runService, clock,
      autoRunDebounceRepo = debounceRepo, staleClaimAfterSeconds = 300L
    )

  /** Fires `attempts` independent debounce windows for `pid` through `triggerServices` (round-
   *  robined across however many are given), spaced `spacingSeconds` apart -- well above
   *  `debounceSeconds` so each write produces its OWN claim-and-fire cycle rather than coalescing
   *  with the next. After each write, advances `clock` past that write's own fire time and ticks
   *  EVERY scheduler in `schedulers` concurrently (mirrors two Cloud Run instances racing the same
   *  tick). */
  private def driveIndependentBursts(
      dsId: DataSourceId,
      user: AuthenticatedUser,
      triggerServices: Vector[AutoRunTriggerService],
      schedulers: Vector[PipelineSchedulerService],
      clock: FakeClock,
      t0: Instant,
      attempts: Int,
      debounceSeconds: Long,
      spacingSeconds: Long = 10L
  ): Unit =
    for (i <- 0 until attempts) {
      val t = t0.plusSeconds(i * spacingSeconds)
      val trigger = triggerServices(i % triggerServices.size)
      await(trigger.triggerAutoRun(dsId, user, t))
      clock.set(t.plusSeconds(debounceSeconds + 1))
      await(Future.sequence(schedulers.map(_.tick())))
    }

  "the AC holds with the debounce defeated (HEL-1097 tasks.md 3.1)" should {

    "six independently-fired writes (each its own debounce window) against a budget of three " +
      "produce exactly three pipeline_runs rows and a matching guard rate-window count -- never " +
      "more, regardless of the burst spanning six separate fires" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val user = AuthenticatedUser(owner)

      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 3, rateWindowSeconds = 300, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)
      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clock = new FakeClock(t0)
      val triggerService = newTriggerService(debounceSeconds = 2L)
      val runService = newRunService(guardConfig, withGuard = true)
      val scheduler = newScheduler(runService, clock)

      driveIndependentBursts(dsId, user, Vector(triggerService), Vector(scheduler), clock, t0, attempts = 6, debounceSeconds = 2L)

      runCount(pid) shouldBe 3
      rateWindowRequestCount(owner) shouldBe 3
    }
  }

  "cross-instance exclusivity does not weaken the guard (HEL-1097 tasks.md 3.2)" should {

    "six independently-fired writes split across TWO PipelineSchedulerService instances sharing " +
      "one DB, each tick racing the other for the same claim, still produce at most the " +
      "configured budget's worth of pipeline_runs rows" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val user = AuthenticatedUser(owner)

      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 3, rateWindowSeconds = 300, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)
      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clockA = new FakeClock(t0)
      val clockB = new FakeClock(t0)
      val triggerServiceA = newTriggerService(debounceSeconds = 2L)
      val triggerServiceB = newTriggerService(debounceSeconds = 2L)
      val runServiceA = newRunService(guardConfig, withGuard = true)
      val runServiceB = newRunService(guardConfig, withGuard = true)
      val schedulerA = newScheduler(runServiceA, clockA)
      val schedulerB = newScheduler(runServiceB, clockB)

      // `driveIndependentBursts` advances only ONE `FakeClock` per write -- both instances' clocks
      // must move together (t0 is common to both) for their concurrently-raced ticks to observe
      // the same due row, so this drives them with a shim `Clock` that fans a `set` out to both.
      val fannedClock = new FakeClock(t0) {
        override def set(i: Instant): Unit = { clockA.set(i); clockB.set(i); super.set(i) }
      }
      // Only WHICH instance actually wins each claim (raced concurrently below) is left to real
      // timing, exactly as `DatasetWriteAutoRunCoalescingSpec`'s own cross-instance test.
      driveIndependentBursts(
        dsId, user, Vector(triggerServiceA, triggerServiceB), Vector(schedulerA, schedulerB),
        fannedClock, t0, attempts = 6, debounceSeconds = 2L
      )

      runCount(pid) shouldBe 3
      rateWindowRequestCount(owner) shouldBe 3
    }
  }

  "the guard-bypassed RED case (HEL-1097 tasks.md 3.3)" should {

    // Falsifiability, per systematic-debugging.md: before committing this test in its guard-off
    // form, it was run once with `withGuard = true` substituted in place below and observed to
    // FAIL (runCount(pid) was 3, not 6) -- confirming this is a genuine red case, not dead code
    // that would pass regardless of the guard's wiring. See files-modified.md / PR body for the
    // transcript of that confirmation run.
    "the SAME six-burst scenario as 3.1, submitted through a PipelineRunService fixture " +
      "constructed WITHOUT a pipelineRunGuardRepo, produces all six pipeline_runs rows -- " +
      "proving 3.1's budget-of-three result is not a tautology" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val user = AuthenticatedUser(owner)

      // Same nominal budget as 3.1 -- irrelevant here since the guard repo is omitted, which is
      // exactly the point: `guardConfig`'s limit is never consulted without a repo to check it against.
      val guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 3, rateWindowSeconds = 300, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)
      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clock = new FakeClock(t0)
      val triggerService = newTriggerService(debounceSeconds = 2L)
      val runService = newRunService(guardConfig, withGuard = false)
      val scheduler = newScheduler(runService, clock)

      driveIndependentBursts(dsId, user, Vector(triggerService), Vector(scheduler), clock, t0, attempts = 6, debounceSeconds = 2L)

      runCount(pid) shouldBe 6
    }
  }
}
