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

/** HEL-1093 tasks.md 3.2/3.3/3.4 -- the ticket's headline AC ("ten increments in two seconds
 *  produce one run, not ten"), proven end-to-end against a real Postgres-backed
 *  `pipeline_auto_run_debounce` and `PipelineSchedulerService` tick, counted from `pipeline_runs`
 *  (never log lines):
 *
 *  - 3.2: ten debounce-triggering calls within a two-second window collapse to ONE run.
 *  - 3.3 (the mutation-proving RED case): the SAME ten calls, submitted directly through
 *    `PipelineRunService.submit` (bypassing the debounce table entirely -- the "debounce
 *    disabled" arm tasks.md calls for), produce TEN rows -- proving the "1" result above is not
 *    a false negative from a broken counting mechanism.
 *  - 3.4: two independent `AutoRunTriggerService`/`PipelineSchedulerService` PAIRS sharing one
 *    database (the closest in-process approximation of two Cloud Run instances) -- writes split
 *    across both, then BOTH schedulers tick concurrently -- still produce exactly one run.
 *
 *  A `FakeClock` drives both the write-time `now` passed to `triggerAutoRun` and the fire-time
 *  `now` passed to `tick()`, so "within two seconds" / "after the debounce window elapses" are
 *  asserted deterministically rather than depending on real wall-clock timing (design.md Decision
 *  2/3; mirrors `PipelineSchedulerServiceSpec`'s own `FakeClock` convention). */
class DatasetWriteAutoRunCoalescingSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
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

  /** A cheap, always-succeeding `dataset`-kind source (one row) owned by `owner`. */
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

  /** A single-root pipeline over `dsId`, owned by `owner` -- always eligible (cheap, no steps). */
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

  private def newTriggerService(debounceSeconds: Long = 5L): AutoRunTriggerService =
    new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds)

  private def newRunService(): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/"))
    )

  private def newScheduler(runService: PipelineRunService, clock: FakeClock, staleClaimAfterSeconds: Long = 300L): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineRunRepo, runService, clock,
      autoRunDebounceRepo = debounceRepo,
      staleClaimAfterSeconds = staleClaimAfterSeconds
    )

  "the debounce AC (HEL-1093 tasks.md 3.2)" should {

    "ten triggerAutoRun calls within a two-second window, once the quiet window elapses, " +
      "produce exactly ONE row in pipeline_runs -- counted from pipeline_runs, never log lines" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)

      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clock = new FakeClock(t0)
      val triggerService = newTriggerService(debounceSeconds = 5L)
      val runService      = newRunService()
      val scheduler        = newScheduler(runService, clock)

      // Ten "increments" spread across a 1.8s window (within the AC's 2s burst).
      for (i <- 0 until 10) {
        await(triggerService.triggerAutoRun(dsId, t0.plusMillis(i * 200L)))
      }

      // No run yet -- the write path never submits synchronously.
      runCount(pid) shouldBe 0

      // Advance past the quiet window (debounceSeconds after the LAST write) and tick.
      clock.set(t0.plusMillis(9 * 200L).plusSeconds(6))
      await(scheduler.tick())

      runCount(pid) shouldBe 1
    }
  }

  "the mutation-proving RED case (HEL-1093 tasks.md 3.3)" should {

    "the SAME ten-writes scenario, submitted directly through PipelineRunService.submit " +
      "(debounce disabled / bypassed), produces TEN rows -- proving 3.2's count of ONE actually " +
      "distinguishes debounced from non-debounced behavior" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)
      val user  = AuthenticatedUser(owner)
      val runService = newRunService()

      for (_ <- 0 until 10) {
        await(runService.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
      }

      runCount(pid) shouldBe 10
    }
  }

  "cross-instance exclusivity (HEL-1093 tasks.md 3.4)" should {

    "ten writes split across TWO independent AutoRunTriggerService instances, then BOTH " +
      "PipelineSchedulerService instances ticking CONCURRENTLY, still produce exactly ONE row " +
      "in pipeline_runs -- proves claimDue's atomicity, not just single-process correctness" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, dsId)

      val t0 = Instant.parse("2026-01-01T00:00:00Z")
      val clockA = new FakeClock(t0)
      val clockB = new FakeClock(t0)
      // Two independent AutoRunTriggerService "instances" -- distinct objects, same underlying
      // DB/debounceRepo, exactly like two Cloud Run instances sharing one Postgres.
      val triggerServiceA = newTriggerService()
      val triggerServiceB = newTriggerService()
      val runServiceA = newRunService()
      val runServiceB = newRunService()
      val schedulerA = newScheduler(runServiceA, clockA)
      val schedulerB = newScheduler(runServiceB, clockB)

      // Five writes via "instance A", five via "instance B", interleaved within a 1.8s window.
      for (i <- 0 until 10) {
        val t = t0.plusMillis(i * 200L)
        if (i % 2 == 0) await(triggerServiceA.triggerAutoRun(dsId, t))
        else            await(triggerServiceB.triggerAutoRun(dsId, t))
      }

      runCount(pid) shouldBe 0

      val fireAt = t0.plusMillis(9 * 200L).plusSeconds(6)
      clockA.set(fireAt)
      clockB.set(fireAt)

      // Both instances' ticks race the SAME claim -- the atomic UPDATE ... RETURNING (design.md
      // Decision 3 step 1) must let exactly one of them win.
      await(Future.sequence(Seq(schedulerA.tick(), schedulerB.tick())))

      runCount(pid) shouldBe 1
    }
  }
}
