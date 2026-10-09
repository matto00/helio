package com.helio.services.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.domain.util.Clock
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.services.audit.AuditService
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, Suite}
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsObject, JsString}

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/** Shared fixture for the `PipelineSchedulerService` specs (HEL-1286): embedded
 *  Postgres with Flyway, the repositories and `PipelineRunService` over a fake
 *  `FileSystem`, an injectable fake `Clock`, the hang-entry overlap machinery,
 *  `cleanDb` and the seed helpers. Each spec mixing this in gets its own
 *  Postgres instance. */
trait PipelineSchedulerServiceFixture extends BeforeAndAfterAll { this: Suite =>

  protected implicit val ec: ExecutionContext = ExecutionContext.global

  protected var embeddedPostgres: EmbeddedPostgres = _
  protected var db: JdbcBackend.Database           = _
  protected var scheduleRepo: PipelineScheduleRepository = _
  protected var pipelineRepo: PipelineRepository         = _
  protected var runRepo: PipelineRunRepository           = _
  protected var pipelineStepRepo: PipelineStepRepository = _
  protected var service: PipelineSchedulerService        = _
  protected var auditEventRepo: AuditEventRepository     = _
  protected var runServiceForHistory: PipelineRunService  = _
  protected var historyCtx: DbContext                     = _

  protected class FakeClock(@volatile private var instant: Instant) extends Clock {
    def set(i: Instant): Unit    = instant = i
    override def now(): Instant  = instant
  }

  protected val fakeClock = new FakeClock(Instant.parse("2026-01-01T00:00:00Z"))

  /** A path registered here hangs `FileSystem.read` on `bytes.future` and
   *  completes `reached` the moment `read` is called for it — the
   *  deterministic hand-off point the overlap-guard test blocks on, instead
   *  of a real timer or a sleep-based race (design.md Decision 8). */
  protected case class HangEntry(bytes: Promise[Array[Byte]], reached: Promise[Unit])
  protected val hangingReads = new ConcurrentHashMap[String, HangEntry]()
  protected val readCount    = new AtomicInteger(0)

  protected val fakeFileSystem: FileSystem = new FileSystem {
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
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo  = new PipelineRepository(ctx, dataSourceRepo)
    scheduleRepo  = new PipelineScheduleRepository(ctx)
    runRepo       = new PipelineRunRepository(ctx)
    auditEventRepo = new AuditEventRepository(ctx)
    val auditService = new AuditService(auditEventRepo)
    val pipelineRunService = new PipelineRunService(
      pipelineRepo,
      pipelineStepRepo,
      dataSourceRepo,
      runRepo,
      new PipelineRunCache(),
      registry = null,
      fakeFileSystem,
      auditService = auditService,
      outputRepo = new OutputRepository(ctx)
    )
    runServiceForHistory = pipelineRunService
    historyCtx = ctx
    service = new PipelineSchedulerService(scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, pipelineRunService, fakeClock)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  protected def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  protected def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_runs"))
    await(db.run(sqlu"DELETE FROM pipeline_schedules"))
    await(db.run(sqlu"DELETE FROM pipelines"))
    await(db.run(sqlu"DELETE FROM data_sources"))
    await(db.run(sqlu"DELETE FROM users"))
    hangingReads.clear()
    readCount.set(0)
  }

  protected val ownerId = UUID.randomUUID().toString
  protected val owner   = UserId(ownerId)
  protected val user    = AuthenticatedUser(owner)

  protected def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"a-$ownerId@helio.test"}, now())"""))
  }

  /** Fully-runnable pipeline over a `DatasetSource` with no rows — succeeds
   *  with zero rows, no steps. */
  protected def seedStaticPipeline(): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  /** Pipeline over a `CsvSource` at `path` — an empty `path` fails
   *  synchronously in `InProcessPipelineEngine.loadRows` (the failure-path
   *  test); a non-empty `path` reads through `fakeFileSystem` (the
   *  overlap-guard hang test). */
  protected def seedCsvPipeline(path: String): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val configJson = JsObject("path" -> JsString(path)).compactPrint
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'csv', $configJson, $ownerId::uuid, now(), now())""",
      
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  protected def seedSchedule(
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
}
