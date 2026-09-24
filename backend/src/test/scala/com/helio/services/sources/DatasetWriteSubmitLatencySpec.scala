package com.helio.services.sources

import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.AutoRunTriggerService
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsString, JsValue}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1096 tasks.md 3.4 (design.md Decision 2, C12 -- owner instruction: "measure, don't just
 *  ship"): p50/p95 submit-latency BEFORE (no `AutoRunTriggerService` wired -- the write returns
 *  without waiting on any downstream evaluation, matching the pre-HEL-1096 fire-and-forget shape
 *  from the CALLER's perspective) vs. AFTER (the real awaited evaluation, HEL-1096 design.md D1)
 *  for `appendFormRow`, `replaceRows`, and `patchRow` -- the three call sites design.md D2 names
 *  -- on a fixture with 5 downstream pipelines (3 allowed, 2 denied). Not a pass/fail
 *  correctness gate (wall-clock timing on a shared CI/dev machine is inherently noisy) -- the
 *  measured numbers are logged and restated plainly in the executor's PR-body/handoff, per C12.
 *  A loose sanity assertion (after >= before) guards against a future regression that makes the
 *  "after" measurement meaningless (e.g. the awaited call accidentally becoming a no-op). */
class DatasetWriteSubmitLatencySpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private val log = LoggerFactory.getLogger(getClass)

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres             = _
  private var db: JdbcBackend.Database                       = _
  private var dataSourceRepo: DataSourceRepository            = _
  private var pipelineRepo: PipelineRepository                = _
  private var pipelineStepRepo: PipelineStepRepository        = _
  private var pipelineRootRepo: PipelineRootRepository        = _
  private var debounceRepo: PipelineAutoRunDebounceRepository = _
  private var serviceBefore: DataSourceService                 = _ // no AutoRunTriggerService wired
  private var serviceAfter: DataSourceService                  = _ // real, AWAITED AutoRunTriggerService

  private val Iterations = 20

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRootRepo  = new PipelineRootRepository(ctx)
    debounceRepo      = new PipelineAutoRunDebounceRepository(ctx)
    val triggerService = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds = 60L)
    val fileSystem = new LocalFileSystem(newTempDir("hel1096-latency"))
    serviceBefore = new DataSourceService(dataSourceRepo, fileSystem, autoRunTriggerService = null)
    serviceAfter  = new DataSourceService(dataSourceRepo, fileSystem, autoRunTriggerService = triggerService)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def seedUser(): UserId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now())"""))
    UserId(id)
  }

  private def seedDataset(owner: AuthenticatedUser, service: DataSourceService): DataSourceId = {
    val req = StaticDataSourceRequest(
      name = "latency-src", `type` = "dataset",
      columns = Vector(StaticColumnPayload("name", "string")),
      rows    = Vector(Vector(JsString("seed")))
    )
    await(service.createStatic(req, owner)).getOrElse(fail("expected Right")).id
  }

  /** 5 downstream pipelines reading `dsId`: 3 cheap (no steps -- trivially `autoRunnable`), 2
   *  denied (an enabled `analyzewithai` step each). */
  private def seedFiveDownstreamPipelines(owner: UserId, dsId: DataSourceId): Unit = {
    import PostgresProfile.api._
    def seedPipeline(): PipelineId = {
      val pid = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'latency-pipe', ${owner.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
               VALUES (${UUID.randomUUID().toString}, $pid, ${dsId.value}, 0)"""
      )))
      PipelineId(pid)
    }
    (1 to 3).foreach(_ => seedPipeline())
    (1 to 2).foreach { _ =>
      val pid = seedPipeline()
      val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
      await(pipelineStepRepo.insertInternal(pid, "analyzewithai", cfg, enabled = true, parentStepId = None, explicitRootId = None))
    }
  }

  private def percentile(samplesMs: Seq[Long], p: Double): Long = {
    val sorted = samplesMs.sorted
    val idx    = math.min(sorted.length - 1, math.ceil(p * sorted.length).toInt - 1).max(0)
    sorted(idx)
  }

  private def report(label: String, samplesMs: Seq[Long]): Unit = {
    val p50 = percentile(samplesMs, 0.50)
    val p95 = percentile(samplesMs, 0.95)
    log.info(s"HEL-1096 submit-latency [$label]: p50=${p50}ms p95=${p95}ms n=${samplesMs.size} samples=$samplesMs")
    // scalastyle/println deliberately used here too -- sbt's default logger config can swallow
    // INFO lines depending on the invoking harness; this measurement must be visible in the raw
    // `sbt test` transcript the executor pastes into the PR body regardless of log level.
    println(s"HEL-1096 submit-latency [$label]: p50=${p50}ms p95=${p95}ms n=${samplesMs.size}")
  }

  "appendFormRow submit latency (design.md D2)" should {
    "measures p50/p95 before (fire-and-forget-equivalent) vs. after (awaited, 5-pipeline fixture)" in {
      val ownerBefore = seedUser()
      val dsBefore    = seedDataset(AuthenticatedUser(ownerBefore), serviceBefore)
      seedFiveDownstreamPipelines(ownerBefore, dsBefore)
      val build = (_: Vector[DatasetFieldDeclaration], _: java.time.Instant) => Right(Vector[JsValue](JsString("v")))

      val beforeSamples = (1 to Iterations).map { _ =>
        val t0 = System.nanoTime()
        await(serviceBefore.appendFormRow(dsBefore, build, PanelId(UUID.randomUUID().toString), AuthenticatedUser(ownerBefore)))
        (System.nanoTime() - t0) / 1000000L
      }

      val ownerAfter = seedUser()
      val dsAfter    = seedDataset(AuthenticatedUser(ownerAfter), serviceAfter)
      seedFiveDownstreamPipelines(ownerAfter, dsAfter)

      val afterSamples = (1 to Iterations).map { _ =>
        val t0 = System.nanoTime()
        await(serviceAfter.appendFormRow(dsAfter, build, PanelId(UUID.randomUUID().toString), AuthenticatedUser(ownerAfter)))
        (System.nanoTime() - t0) / 1000000L
      }

      report("appendFormRow / before", beforeSamples)
      report("appendFormRow / after", afterSamples)
      percentile(afterSamples, 0.50) should be >= percentile(beforeSamples, 0.50) - 5L // 5ms noise floor
    }
  }

  "replaceRows submit latency (design.md D2)" should {
    "measures p50/p95 before vs. after (awaited, 5-pipeline fixture)" in {
      val ownerBefore = seedUser()
      val dsBefore    = seedDataset(AuthenticatedUser(ownerBefore), serviceBefore)
      seedFiveDownstreamPipelines(ownerBefore, dsBefore)

      val beforeSamples = (1 to Iterations).map { i =>
        val t0 = System.nanoTime()
        await(serviceBefore.replaceRows(dsBefore, Vector(Vector(JsString(s"r$i"))), AuthenticatedUser(ownerBefore)))
        (System.nanoTime() - t0) / 1000000L
      }

      val ownerAfter = seedUser()
      val dsAfter    = seedDataset(AuthenticatedUser(ownerAfter), serviceAfter)
      seedFiveDownstreamPipelines(ownerAfter, dsAfter)

      val afterSamples = (1 to Iterations).map { i =>
        val t0 = System.nanoTime()
        await(serviceAfter.replaceRows(dsAfter, Vector(Vector(JsString(s"r$i"))), AuthenticatedUser(ownerAfter)))
        (System.nanoTime() - t0) / 1000000L
      }

      report("replaceRows / before", beforeSamples)
      report("replaceRows / after", afterSamples)
      percentile(afterSamples, 0.50) should be >= percentile(beforeSamples, 0.50) - 5L
    }
  }

  "patchRow submit latency (design.md D2)" should {
    "measures p50/p95 before vs. after (awaited, 5-pipeline fixture)" in {
      val ownerBefore = seedUser()
      val dsBefore    = seedDataset(AuthenticatedUser(ownerBefore), serviceBefore)
      seedFiveDownstreamPipelines(ownerBefore, dsBefore)
      var rowBefore = await(serviceBefore.appendRows(dsBefore, Vector(Vector(JsString("seed"))), AuthenticatedUser(ownerBefore)))
        .getOrElse(fail("expected Right")).rows.head

      val beforeSamples = (1 to Iterations).map { i =>
        val t0 = System.nanoTime()
        val result = await(serviceBefore.patchRow(dsBefore, rowBefore.id, rowBefore.updatedAt.toString, Vector(JsString(s"p$i")), AuthenticatedUser(ownerBefore)))
          .getOrElse(fail("expected Right"))
        rowBefore = RowWriteRow(result.rowId, result.seq, result.rowUpdatedAt)
        (System.nanoTime() - t0) / 1000000L
      }

      val ownerAfter = seedUser()
      val dsAfter    = seedDataset(AuthenticatedUser(ownerAfter), serviceAfter)
      seedFiveDownstreamPipelines(ownerAfter, dsAfter)
      var rowAfter = await(serviceAfter.appendRows(dsAfter, Vector(Vector(JsString("seed"))), AuthenticatedUser(ownerAfter)))
        .getOrElse(fail("expected Right")).rows.head

      val afterSamples = (1 to Iterations).map { i =>
        val t0 = System.nanoTime()
        val result = await(serviceAfter.patchRow(dsAfter, rowAfter.id, rowAfter.updatedAt.toString, Vector(JsString(s"p$i")), AuthenticatedUser(ownerAfter)))
          .getOrElse(fail("expected Right"))
        rowAfter = RowWriteRow(result.rowId, result.seq, result.rowUpdatedAt)
        (System.nanoTime() - t0) / 1000000L
      }

      report("patchRow / before", beforeSamples)
      report("patchRow / after", afterSamples)
      percentile(afterSamples, 0.50) should be >= percentile(beforeSamples, 0.50) - 5L
    }
  }
}
