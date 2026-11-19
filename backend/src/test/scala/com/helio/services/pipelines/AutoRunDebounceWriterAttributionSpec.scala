package com.helio.services.pipelines

import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, SchemaField}
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
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** The writer of a dataset write is stored on the pipeline's debounce row and becomes the auto-run's
 *  `triggered_by_user_id`, while the run itself is still submitted as, and counted against, the pipeline owner. */
class AutoRunDebounceWriterAttributionSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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

  private def storedWriter(pid: PipelineId): Option[String] =
    await(db.run(sql"SELECT triggered_by_user_id::text FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}".as[Option[String]].head))

  private def autoRunRows(pid: PipelineId): Vector[(Option[String], Boolean)] =
    await(db.run(
      sql"""SELECT triggered_by_user_id::text, true FROM pipeline_runs
            WHERE pipeline_id = ${pid.value} AND trigger_source = ${TriggerSource.AutoRun}""".as[(Option[String], Boolean)]
    )).toVector

  private def newScheduler(): PipelineSchedulerService = {
    val runService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      executionBackend = new InProcessExecutionBackend(new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))), pipelineStepRepo),
      pipelineRunGuardRepo = guardRepo, guardConfig = roomyGuard, outputRepo = outputRepo, autoRunDebounceRepo = debounceRepo
    )
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineStepRepo, pipelineRunRepo, runService, SystemClock,
      autoRunDebounceRepo = debounceRepo,
      autoRunTriggerService = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo),
      staleClaimAfterSeconds = 300L
    )
  }

  "upsertDebounce" should {
    "store the writer on insert and replace it on conflict (last writer wins)" in {
      cleanDb()
      val owner = seedUser(); val first = seedUser(); val second = seedUser()
      val pid = seedPipeline(owner)
      await(debounceRepo.upsertDebounce(pid, Instant.now().plusSeconds(60), first))
      storedWriter(pid) shouldBe Some(first.value)
      await(debounceRepo.upsertDebounce(pid, Instant.now().plusSeconds(60), second))
      storedWriter(pid) shouldBe Some(second.value)
    }

    "null the writer when the writing user is deleted, keeping the pending row" in {
      cleanDb()
      val owner = seedUser(); val writer = seedUser()
      val pid = seedPipeline(owner)
      await(debounceRepo.upsertDebounce(pid, Instant.now().plusSeconds(60), writer))
      await(db.run(sqlu"DELETE FROM users WHERE id = ${writer.value}::uuid"))
      storedWriter(pid) shouldBe None
      await(debounceRepo.pendingWriteGeneration(pid)) shouldBe defined
    }
  }

  "claimDue" should {
    "return the stored writer with each claim, and None for a row with no writer" in {
      cleanDb()
      val owner = seedUser(); val writer = seedUser()
      val withWriter = seedPipeline(owner); val without = seedPipeline(owner)
      await(debounceRepo.upsertDebounce(withWriter, Instant.now().minusSeconds(1), writer))
      await(db.run(sqlu"INSERT INTO pipeline_auto_run_debounce (pipeline_id, fire_at) VALUES (${without.value}, now() - interval '1 second')"))
      val claimed = await(debounceRepo.claimDue(Instant.now(), Instant.now().minusSeconds(300)))
      claimed.map(c => c.pipelineId -> c.triggeredByUserId).toMap shouldBe Map(withWriter -> Some(writer), without -> None)
    }
  }

  "a fired auto-run" should {
    "be recorded with the stored writer as its trigger and counted against the pipeline owner" in {
      cleanDb()
      val owner = seedUser(); val editor = seedUser()
      val pid = seedPipeline(owner)
      await(debounceRepo.upsertDebounce(pid, Instant.now().minusSeconds(1), editor))
      await(newScheduler().tick())
      autoRunRows(pid) shouldBe Vector((Some(editor.value), true))
      await(db.run(sql"SELECT owner_id::text FROM pipelines WHERE id = ${pid.value}".as[String].head)) shouldBe owner.value
    }

    "fall back to the pipeline owner when the debounce row carries no writer" in {
      cleanDb()
      val owner = seedUser()
      val pid = seedPipeline(owner)
      await(db.run(sqlu"INSERT INTO pipeline_auto_run_debounce (pipeline_id, fire_at) VALUES (${pid.value}, now() - interval '1 second')"))
      await(newScheduler().tick())
      autoRunRows(pid) shouldBe Vector((Some(owner.value), true))
    }
  }
}
