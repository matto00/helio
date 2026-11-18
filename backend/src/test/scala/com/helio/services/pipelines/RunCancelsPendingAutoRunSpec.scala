package com.helio.services.pipelines

import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, PipelineExecutionBackend, PipelineExecutionOutcome, NodeKey, SchemaField}
import com.helio.domain.model._
import com.helio.domain.util.SystemClock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.JsString

import java.nio.file.Paths
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1739: a successful real run cancels the pending dataset-write auto-run of the writes it read (design.md D1-D7).
 *  Every mid-run interleaving is driven through [[SeamBackend]], whose `beforeExecute` runs at the point where the engine
 *  would first read source rows, so no case depends on timing. */
class RunCancelsPendingAutoRunSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineRootRepo: PipelineRootRepository = _
  private var pipelineRunRepo: PipelineRunRepository   = _
  private var scheduleRepo: PipelineScheduleRepository = _
  private var debounceRepo: PipelineAutoRunDebounceRepository = _
  private var guardRepo: PipelineRunGuardRepository    = _
  private var outputRepo: OutputRepository             = _

  private val roomyGuard = PipelineRunGuardConfig(rateLimitPerWindow = 1000, rateWindowSeconds = 60, maxConcurrent = 1000, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
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
    outputRepo       = new OutputRepository(ctx)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  import PostgresProfile.api._

  private def cleanDb(): Unit =
    await(db.run(DBIO.seq(
      sqlu"DELETE FROM pipeline_run_rate_window", sqlu"DELETE FROM pipelines", sqlu"DELETE FROM dataset_rows",
      sqlu"DELETE FROM data_sources", sqlu"DELETE FROM users"
    )))

  private def seedUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now()) ON CONFLICT DO NOTHING"""))
    UserId(id)
  }

  private def seedPipeline(owner: UserId): PipelineId = {
    val declared = Vector(DatasetFieldDeclaration("name", DataFieldType.StringType))
    val now      = Instant.now()
    val source   = DatasetSource(DataSourceId(UUID.randomUUID().toString), "ds", owner, now, now)
    val schema   = declared.map(f => SchemaField(f.name, DataFieldType.asString(f.fieldType)))
    await(dataSourceRepo.insertDatasetSource(source, declared, Vector(Vector(JsString("seed"))), schema, AuthenticatedUser(owner)))
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES (${UUID.randomUUID().toString}, $pid, ${source.id.value}, 0)"""
    )))
    PipelineId(pid)
  }

  /** The write-time hook, as `AutoRunTriggerService` calls it (a due-immediately debounce row). */
  private def write(pid: PipelineId): Unit = await(debounceRepo.upsertDebounce(pid, Instant.now().minusSeconds(1)))

  private def generation(pid: PipelineId): Option[Long] = await(debounceRepo.pendingWriteGeneration(pid))
  private def rowExists(pid: PipelineId): Boolean       = generation(pid).isDefined
  private def runCount(pid: PipelineId, trigger: Option[String] = None): Int =
    await(db.run(trigger match {
      case Some(t) => sql"SELECT count(*) FROM pipeline_runs WHERE pipeline_id = ${pid.value} AND trigger_source = $t".as[Int].head
      case None    => sql"SELECT count(*) FROM pipeline_runs WHERE pipeline_id = ${pid.value}".as[Int].head
    }))
  private def claimedAt(pid: PipelineId): Option[Timestamp] =
    await(db.run(sql"SELECT claimed_at FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}".as[Option[Timestamp]].head))

  /** Delegates to the real in-process engine after running `beforeExecute`, the first point a run touches source rows. */
  private final class SeamBackend(var beforeExecute: () => Unit = () => (), var failRun: Boolean = false) extends PipelineExecutionBackend {
    private val real = new InProcessExecutionBackend(new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))), pipelineStepRepo)
    override def execute(
        pipeline: Pipeline, roots: Vector[(String, DataSource)], steps: Vector[PipelineStep], dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink, truncationSink: TruncationSink, retain: Set[NodeKey], onNodeProgress: (NodeKey, Long) => Unit,
        writeBackSink: WriteBackSink, ownerUserId: Option[String]
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      beforeExecute()
      if (failRun) Future.failed(new IllegalStateException("HEL-1739 seam: forced engine failure"))
      else real.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, retain, onNodeProgress, writeBackSink, ownerUserId)
    }
  }

  private def newRunService(backend: PipelineExecutionBackend, guard: PipelineRunGuardConfig = roomyGuard, withDebounce: Boolean = true): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      executionBackend = backend, pipelineRunGuardRepo = guardRepo, guardConfig = guard, outputRepo = outputRepo,
      autoRunDebounceRepo = if (withDebounce) debounceRepo else null
    )

  private def newScheduler(runService: PipelineRunService): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineStepRepo, pipelineRunRepo, runService, SystemClock,
      autoRunDebounceRepo = debounceRepo,
      autoRunTriggerService = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo),
      staleClaimAfterSeconds = 300L
    )

  "a successful real run" should {

    "remove the pending auto-run armed by a write before it, so no auto-run fires" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val service = newRunService(new SeamBackend())
      write(pid)
      rowExists(pid) shouldBe true

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      rowExists(pid) shouldBe false
      await(newScheduler(service).tick())
      runCount(pid) shouldBe 1
      runCount(pid, Some(TriggerSource.AutoRun)) shouldBe 0
    }

    "keep the auto-run of a write that lands after the snapshot, and still fire it" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val backend = new SeamBackend(beforeExecute = () => write(pid))
      val service = newRunService(backend)
      write(pid)
      val before = generation(pid).get

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      rowExists(pid) shouldBe true
      generation(pid).get should be > before
      backend.beforeExecute = () => ()
      await(newScheduler(service).tick())
      runCount(pid, Some(TriggerSource.AutoRun)) shouldBe 1
    }

    "cancel nothing when a write armed the row only after a snapshot saw no row" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val service = newRunService(new SeamBackend(beforeExecute = () => write(pid)))

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      rowExists(pid) shouldBe true
    }

    "not cancel a row deleted and recreated between the snapshot and success (no ABA)" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val service = newRunService(new SeamBackend(beforeExecute = () => {
        // The firer fires and releases the old row, then a fresh write recreates it: a per-row counter would restart and match.
        await(debounceRepo.claimDue(Instant.now(), Instant.now().minusSeconds(300))).foreach { case (p, at) => await(debounceRepo.releaseClaim(p, at)) }
        write(pid)
      }))
      write(pid)

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      rowExists(pid) shouldBe true
    }
  }

  "a real run that does not succeed" should {

    "leave the pending auto-run in place, and it fires afterwards" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val backend = new SeamBackend(failRun = true)
      val service = newRunService(backend)
      write(pid)
      val before = generation(pid)

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))).isLeft shouldBe true

      generation(pid) shouldBe before
      backend.failRun = false
      await(newScheduler(service).tick())
      runCount(pid, Some(TriggerSource.AutoRun)) shouldBe 1
    }

    "leave it in place when admission is refused (concurrency cap), discarding the snapshot" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val service = newRunService(new SeamBackend(), guard = roomyGuard.copy(maxConcurrent = 0))
      write(pid)

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))).isLeft shouldBe true

      rowExists(pid) shouldBe true
    }
  }

  "a dry run" should {
    "cancel nothing" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val service = newRunService(new SeamBackend())
      write(pid)

      await(service.submit(pid, isDry = true, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      rowExists(pid) shouldBe true
    }
  }

  "a run on a service with no debounce repository" should {
    "succeed and leave the row alone" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      val service = newRunService(new SeamBackend(), withDebounce = false)
      write(pid)

      await(service.submit(pid, isDry = false, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      rowExists(pid) shouldBe true
    }
  }

  "a firer tick during the run (HEL-1504 in-flight carve-out)" should {
    "unclaim the due row while the run is active, then be cancelled at success with no second run" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      var claimedDuringRun: Option[Option[Timestamp]] = None
      var holder: PipelineRunService = null
      val backend = new SeamBackend(beforeExecute = () => {
        await(newScheduler(holder).tick())
        claimedDuringRun = Some(claimedAt(pid))
      })
      holder = newRunService(backend)
      write(pid)

      await(holder.submit(pid, isDry = false, AuthenticatedUser(owner))) shouldBe a[Right[_, _]]

      claimedDuringRun shouldBe Some(None) // the tick found an active run and handed the claim back (row still pending)
      rowExists(pid) shouldBe false         // cancelled by the run's success
      await(newScheduler(holder).tick())
      runCount(pid) shouldBe 1
    }
  }

  "the write generation" should {
    "change on both the insert and the conflict path of upsertDebounce" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      write(pid)
      val g1 = generation(pid).get
      write(pid)
      val g2 = generation(pid).get
      g2 should be > g1
    }

    "stay unchanged through unclaim and every rearm outcome" in {
      cleanDb()
      val owner = seedUser(); val pid = seedPipeline(owner)
      write(pid)
      val g = generation(pid).get
      def claim(): Instant = await(debounceRepo.claimDue(Instant.now(), Instant.now().minusSeconds(300))).head._2
      generation(pid) shouldBe Some(g)

      await(debounceRepo.unclaim(pid, claim()))
      generation(pid) shouldBe Some(g)

      val rearmed = await(debounceRepo.rearmAfterGuardRejection(pid, claim(), Instant.now().minusSeconds(1), maxRetries = 5))
      rearmed shouldBe a[RearmOutcome.Rearmed]
      generation(pid) shouldBe Some(g)

      await(debounceRepo.rearmAfterGuardRejection(pid, Instant.now().minusSeconds(999), Instant.now(), maxRetries = 5)) shouldBe RearmOutcome.Superseded
      generation(pid) shouldBe Some(g)

      val exhausted = await(debounceRepo.rearmAfterGuardRejection(pid, claim(), Instant.now(), maxRetries = 0))
      exhausted shouldBe a[RearmOutcome.Exhausted]
      rowExists(pid) shouldBe false
    }
  }
}
