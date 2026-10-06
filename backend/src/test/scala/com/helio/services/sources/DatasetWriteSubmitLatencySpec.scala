package com.helio.services.sources

import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{AutoRunTriggerService, EvaluatedPipeline}
import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
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
 *  ship") on a fixture with 5 downstream pipelines (3 allowed, 2 denied by an enabled
 *  `analyzewithai` step), for `appendFormRow`, `replaceRows`, and `patchRow` -- the three call
 *  sites design.md D2 names. BEFORE = no `AutoRunTriggerService` wired (the write returns without
 *  waiting on any downstream evaluation); AFTER = the real awaited evaluation (HEL-1096 D1).
 *
 *  Two layers (HEL-1344):
 *  - Default suite, DETERMINISTIC (no wall clock in any pass/fail decision): every AFTER write's
 *    response carries exactly the two seeded AI pipelines as denied entries, each with reason code
 *    `ai-step`; every BEFORE write carries none. That is the guard's real intent -- "the awaited
 *    call performed the downstream evaluation, it did not silently become a no-op". (The BEFORE == 0
 *    half holds by construction -- null trigger service -- and only documents the contrast; the
 *    AFTER half is the guard.) The earlier `p50(after) >= p50(before) - 5ms` wall-clock assertion
 *    was removed: it flaked under a contended `testFull` (HEL-1344).
 *  - Opt-in measurement, REPORT-ONLY: with `HELIO_MEASURE=1` in the environment of the forked test
 *    JVM, the p50/p95 sampling runs (after discarded warm-up iterations per phase) and prints the
 *    `HEL-1096 submit-latency [...]` lines, restated in the PR body per C12, plus a labelled line
 *    when p95 growth (after - before) exceeds HEL-1096 D2's 200ms reporting trigger. It never
 *    asserts on timing. Without it those tests are canceled, never failed. Note `sbt --client`
 *    does not forward the env to an already-running server; use a plain `sbt` invocation. */
class DatasetWriteSubmitLatencySpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
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

  private val Iterations       = 20 // timed samples per phase (HELIO_MEASURE=1 only)
  private val WarmupIterations  = 5  // discarded per phase, so the report is not order-biased
  private val CountIterations   = 3  // default-mode writes per phase; 3 is enough to prove "every write"
  private val P95GrowthReportMs = 200L // HEL-1096 design.md D2's PR-body reporting trigger
  private val Measure           = sys.env.get("HELIO_MEASURE").contains("1")

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
  private def seedFiveDownstreamPipelines(owner: UserId, dsId: DataSourceId): Vector[PipelineId] = {
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
    (1 to 2).map { _ =>
      val pid = seedPipeline()
      val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
      await(pipelineStepRepo.insertInternal(pid, "analyzewithai", cfg, enabled = true, parentStepId = None, explicitRootId = None))
      pid
    }.toVector
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

  /** One write against a fresh dataset+owner+5-pipeline fixture; each call performs one write and
   *  returns the denied pipelines folded into that write's response. */
  private final case class Fixture(write: () => Vector[EvaluatedPipeline.Denied], aiPipelineIds: Vector[PipelineId])

  private val build = (_: Vector[DatasetFieldDeclaration], _: java.time.Instant) => Right(Vector[JsValue](JsString("v")))

  private def fixture(kind: String, service: DataSourceService): Fixture = {
    val owner = seedUser()
    val user  = AuthenticatedUser(owner)
    val ds    = seedDataset(user, service)
    val ai    = seedFiveDownstreamPipelines(owner, ds)
    val write: () => Vector[EvaluatedPipeline.Denied] = kind match {
      case "appendFormRow" =>
        () => await(service.appendFormRow(ds, build, PanelId(UUID.randomUUID().toString), user))
          .getOrElse(fail("expected Right")).deniedPipelines
      case "replaceRows" =>
        var i = 0
        () => { i += 1; await(service.replaceRows(ds, Vector(Vector(JsString(s"r$i"))), user)).getOrElse(fail("expected Right")).deniedPipelines }
      case "patchRow" =>
        var row = await(service.appendRows(ds, Vector(Vector(JsString("seed"))), user)).getOrElse(fail("expected Right")).rows.head
        var i   = 0
        () => {
          i += 1
          val result = await(service.patchRow(ds, row.id, row.updatedAt.toString, Vector(JsString(s"p$i")), user)).getOrElse(fail("expected Right"))
          row = RowWriteRow(result.rowId, result.seq, result.rowUpdatedAt)
          result.deniedPipelines
        }
    }
    Fixture(write, ai)
  }

  private def timed(f: Fixture): Long = {
    val t0 = System.nanoTime()
    f.write()
    (System.nanoTime() - t0) / 1000000L
  }

  private def sampleAfterWarmup(f: Fixture): Seq[Long] = {
    (1 to WarmupIterations).foreach(_ => f.write())
    (1 to Iterations).map(_ => timed(f))
  }

  for (kind <- Seq("appendFormRow", "replaceRows", "patchRow")) {
    s"$kind submit (design.md D2)" should {
      "AFTER (awaited) reports exactly the 2 seeded AI pipelines as denied (ai-step) on every write; BEFORE reports none" in {
        val before = fixture(kind, serviceBefore)
        val after  = fixture(kind, serviceAfter)

        (1 to CountIterations).foreach { _ =>
          before.write() shouldBe empty
          val denied = after.write()
          denied.map(_.pipelineId).sortBy(_.value) shouldBe after.aiPipelineIds.sortBy(_.value)
          all(denied.map(_.reasons.map(_.code))) should contain("ai-step")
        }
      }

      "reports p50/p95 before vs. after (report-only; HELIO_MEASURE=1)" in {
        assume(Measure, "set HELIO_MEASURE=1 to run the report-only HEL-1096 latency measurement")
        val before = sampleAfterWarmup(fixture(kind, serviceBefore))
        val after  = sampleAfterWarmup(fixture(kind, serviceAfter))
        report(s"$kind / before", before)
        report(s"$kind / after", after)
        val growth = percentile(after, 0.95) - percentile(before, 0.95)
        if (growth > P95GrowthReportMs)
          println(s"HEL-1096 REPORT [$kind]: p95 growth ${growth}ms exceeds ${P95GrowthReportMs}ms -- restate in the PR body (design.md D2)")
      }
    }
  }
}
