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

/** HEL-1097 tasks.md 3.4 -- `dataset-write-auto-run`'s "A guard-rejected auto-run's debounce
 *  claim is released without a retry storm" scenario: a denial on one tick must not leave the
 *  claim stuck, and must not be re-attempted on any LATER tick for the SAME write -- only a FRESH
 *  dataset write may schedule another fire attempt. Every assertion reads
 *  `pipeline_auto_run_debounce`/`pipeline_runs` row state directly, driving
 *  `PipelineSchedulerService.tick()` across several synthetic ticks (design.md Decision 4) --
 *  never a log line, never the actor/timer. */
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

  private def debounceRowExists(pid: PipelineId): Boolean = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT 1 FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}""".as[Int])).nonEmpty
  }

  private def newTriggerService(debounceSeconds: Long): AutoRunTriggerService =
    new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds)

  private def newRunService(guardConfig: PipelineRunGuardConfig): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      pipelineRunGuardRepo = guardRepo, guardConfig = guardConfig
    )

  private def newScheduler(runService: PipelineRunService, clock: Clock): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineRunRepo, runService, clock,
      autoRunDebounceRepo = debounceRepo, staleClaimAfterSeconds = 300L
    )

  "a guard-rejected auto-run's debounce claim (HEL-1097 tasks.md 3.4 / spec: " +
    "'A guard-rejected auto-run's debounce claim is released without a retry storm')" should {

    "release the claim on the SAME tick that denies it, and never re-attempt the SAME denied " +
      "write on any subsequent tick -- only a NEW write re-schedules a fresh attempt" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val user  = AuthenticatedUser(owner)

      // A limit of 0 makes every fire attempt deterministically denied (PipelineRunGuardRepository
      // .incrementRateIfUnderLimit's own `limit < 1` short-circuit) -- no need to first burn a real
      // budget, and no dependence on the guard's own real-wall-clock window rolling over between
      // assertions.
      val alwaysDeniedGuard = PipelineRunGuardConfig(rateLimitPerWindow = 0, rateWindowSeconds = 300, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)
      val runService = newRunService(alwaysDeniedGuard)
      val triggerService = newTriggerService(debounceSeconds = 2L)
      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clock = new FakeClock(t0)
      val scheduler = newScheduler(runService, clock)

      await(triggerService.triggerAutoRun(dsId, user, t0))
      debounceRowExists(pid) shouldBe true

      // Tick #1: claims the due row, fires, is denied by the guard, and releases the claim --
      // all on this one tick.
      clock.set(t0.plusSeconds(3))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe false

      // Ticks #2-#5: no new write occurred, so there is nothing due -- the SAME denied write must
      // never reappear as a claim, and no new pipeline_runs row is ever created.
      for (i <- 2 to 5) {
        clock.set(t0.plusSeconds(3 + i))
        await(scheduler.tick())
        withClue(s"after synthetic tick #$i: ") {
          runCount(pid) shouldBe 0
          debounceRowExists(pid) shouldBe false
        }
      }

      // A FRESH dataset write, in contrast, DOES re-schedule -- the debounce row reappears
      // immediately (before any further tick), proving the no-retry-storm behavior above is a
      // property of "no new write", not of the debounce mechanism being permanently wedged.
      val t1 = t0.plusSeconds(30)
      await(triggerService.triggerAutoRun(dsId, user, t1))
      debounceRowExists(pid) shouldBe true

      // That fresh attempt is, correctly, ALSO denied (the guard limit is still 0) -- and its own
      // claim is released cleanly in turn, exactly like the first.
      clock.set(t1.plusSeconds(3))
      await(scheduler.tick())
      runCount(pid) shouldBe 0
      debounceRowExists(pid) shouldBe false
    }
  }
}
