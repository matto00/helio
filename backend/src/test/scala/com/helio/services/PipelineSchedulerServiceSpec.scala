package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext, FileSystem, ListPage, PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsObject, JsString}

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/** HEL-415 — `PipelineSchedulerService.tick`: due-schedule firing through the
 *  real `PipelineRunService.submit` path (embedded Postgres, mirrors
 *  `AlertEvaluationServiceSpec`'s fixture shape), both overlap-guard layers,
 *  the restart/null-recompute catch-up policy, the failure-recorded path,
 *  and the no-schedule no-op (task 6.2). Uses an injected fake `Clock` —
 *  never exercises Pekko's real timer (`PipelineSchedulerActor` is untested
 *  here by design; see design.md Decision 6). */
class PipelineSchedulerServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var scheduleRepo: PipelineScheduleRepository = _
  private var pipelineRepo: PipelineRepository         = _
  private var runRepo: PipelineRunRepository           = _
  private var service: PipelineSchedulerService        = _

  private class FakeClock(@volatile private var instant: Instant) extends Clock {
    def set(i: Instant): Unit    = instant = i
    override def now(): Instant  = instant
  }

  private val fakeClock = new FakeClock(Instant.parse("2026-01-01T00:00:00Z"))

  /** A path registered here hangs `FileSystem.read` on `bytes.future` and
   *  completes `reached` the moment `read` is called for it — the
   *  deterministic hand-off point the overlap-guard test blocks on, instead
   *  of a real timer or a sleep-based race (design.md Decision 8). */
  private case class HangEntry(bytes: Promise[Array[Byte]], reached: Promise[Unit])
  private val hangingReads = new ConcurrentHashMap[String, HangEntry]()
  private val readCount    = new AtomicInteger(0)

  private val fakeFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]] = {
      readCount.incrementAndGet()
      Option(hangingReads.get(path)) match {
        case Some(entry) =>
          entry.reached.trySuccess(())
          entry.bytes.future
        case None => Future.successful("col\n1\n".getBytes(StandardCharsets.UTF_8))
      }
    }
    def delete(path: String): Future[Unit]    = Future.successful(())
    def exists(path: String): Future[Boolean] = Future.successful(true)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] =
      Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val dataTypeRepo   = new DataTypeRepository(ctx)
    val dataTypeRowRepo = new DataTypeRowRepository(ctx)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo  = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    scheduleRepo  = new PipelineScheduleRepository(ctx)
    runRepo       = new PipelineRunRepository(ctx)
    val pipelineRunService = new PipelineRunService(
      pipelineRepo,
      pipelineStepRepo,
      dataSourceRepo,
      runRepo,
      dataTypeRepo,
      dataTypeRowRepo,
      new PipelineRunCache(),
      registry = null,
      fakeFileSystem
    )
    service = new PipelineSchedulerService(scheduleRepo, pipelineRepo, runRepo, pipelineRunService, fakeClock)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_runs"))
    await(db.run(sqlu"DELETE FROM pipeline_schedules"))
    await(db.run(sqlu"DELETE FROM pipelines"))
    await(db.run(sqlu"DELETE FROM data_sources"))
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM users"))
    hangingReads.clear()
    readCount.set(0)
  }

  private val ownerId = UUID.randomUUID().toString
  private val owner   = UserId(ownerId)
  private val user    = AuthenticatedUser(owner)

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"a-$ownerId@helio.test"}, now())"""))
  }

  /** Fully-runnable pipeline over a `StaticSource` with no rows — succeeds
   *  with zero rows, no steps. */
  private def seedStaticPipeline(): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
             VALUES ($pid, 'pipe', $dsId, $dtId, $ownerId::uuid, now(), now())"""
    )))
    PipelineId(pid)
  }

  /** Pipeline over a `CsvSource` at `path` — an empty `path` fails
   *  synchronously in `InProcessPipelineEngine.loadRows` (the failure-path
   *  test); a non-empty `path` reads through `fakeFileSystem` (the
   *  overlap-guard hang test). */
  private def seedCsvPipeline(path: String): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val configJson = JsObject("path" -> JsString(path)).compactPrint
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'csv', $configJson, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
             VALUES ($pid, 'pipe', $dsId, $dtId, $ownerId::uuid, now(), now())"""
    )))
    PipelineId(pid)
  }

  private def seedSchedule(
      pipelineId: PipelineId,
      nextRunAt: Option[Instant],
      lastRunAt: Option[Instant] = None,
      kind: ScheduleKind = ScheduleKind.Interval,
      expression: String = "30m"
  ): PipelineScheduleId = {
    val now = Instant.now()
    val schedule = PipelineSchedule(
      id         = PipelineScheduleId(UUID.randomUUID().toString),
      pipelineId = pipelineId,
      kind       = kind,
      expression = expression,
      enabled    = true,
      timezone   = "UTC",
      nextRunAt  = nextRunAt,
      lastRunAt  = lastRunAt,
      createdAt  = now,
      updatedAt  = now
    )
    await(scheduleRepo.upsert(schedule, user))
    schedule.id
  }

  "PipelineSchedulerService.tick" should {

    "fire a due interval schedule, submit a run, and advance next_run_at/last_run_at" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
      runs.head.status        shouldBe "succeeded"
      // HEL-417: the scheduler-fired run must persist trigger_source = 'scheduled'.
      runs.head.triggerSource shouldBe "scheduled"

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.lastRunAt shouldBe Some(fakeClock.now())
      updated.nextRunAt shouldBe Some(fakeClock.now().plus(30, ChronoUnit.MINUTES))
    }

    "fire a due cron schedule, submit a run, and advance next_run_at/last_run_at" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:02:00Z"))
      val expression = "*/5 * * * *"
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), kind = ScheduleKind.Cron, expression = expression)

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
      runs.head.status shouldBe "succeeded"

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.lastRunAt shouldBe Some(fakeClock.now())
      updated.nextRunAt shouldBe CronSchedule.nextFireTime(ScheduleKind.Cron, expression, "UTC", fakeClock.now())
    }

    "never submit a run for a pipeline with no schedule" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()

      await(service.tick())

      await(runRepo.listByPipelineInternal(pid)) shouldBe empty
    }

    "recompute next_run_at without submitting a run when it is unset (restart / first-deploy case)" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = None, lastRunAt = None, expression = "30m")

      await(service.tick())

      await(runRepo.listByPipelineInternal(pid)) shouldBe empty

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.nextRunAt shouldBe Some(fakeClock.now().plus(30, ChronoUnit.MINUTES))
      updated.lastRunAt shouldBe None
    }

    "record a failed scheduled run in run history and still advance next_run_at/last_run_at" in {
      cleanDb(); seedUser()
      val pid = seedCsvPipeline("") // empty path fails synchronously in InProcessPipelineEngine.loadRows
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
      runs.head.status shouldBe "failed"
      runs.head.errorLog shouldBe defined
      runs.head.errorLog.get should not be empty
      // HEL-417: trigger_source is set at insert time (submit), independent
      // of the terminal outcome.
      runs.head.triggerSource shouldBe "scheduled"

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.lastRunAt shouldBe Some(fakeClock.now())
      updated.nextRunAt shouldBe Some(fakeClock.now().plus(30, ChronoUnit.MINUTES))
    }

    "leave next_run_at untouched and skip firing when a persisted active run blocks the pipeline" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      val due = fakeClock.now().minusSeconds(60)
      seedSchedule(pid, nextRunAt = Some(due), expression = "30m")

      import PostgresProfile.api._
      await(db.run(
        sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count, error_log)
               VALUES (${UUID.randomUUID().toString}, ${pid.value}, 'queued', now(), NULL, NULL, NULL)"""
      ))

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1 // the pre-seeded active run only — no new fire

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.nextRunAt shouldBe Some(due) // unchanged — retried next tick
      updated.lastRunAt shouldBe None
    }

    "guard two back-to-back tick() calls against firing the same due pipeline twice (in-memory guard)" in {
      cleanDb(); seedUser()
      val path = s"hang-${UUID.randomUUID()}.csv"
      val pid  = seedCsvPipeline(path)
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      val entry = HangEntry(Promise[Array[Byte]](), Promise[Unit]())
      hangingReads.put(path, entry)

      val f1 = service.tick()
      val f2 = service.tick()

      // Block until whichever call reserved the pipeline reaches the hang
      // point (proves it started firing).
      await(entry.reached.future)

      // The winner cannot possibly have completed yet (still hanging on
      // entry.bytes) — the ONLY future able to complete at this point is
      // the loser's, so this deterministically resolves without a race.
      await(Future.firstCompletedOf(Seq(f1, f2)))
      readCount.get() shouldBe 1 // only the winner ever reached FileSystem.read

      entry.bytes.success("col\n1\n".getBytes(StandardCharsets.UTF_8))
      await(Future.sequence(Seq(f1, f2)))

      readCount.get() shouldBe 1
      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
    }
  }
}
