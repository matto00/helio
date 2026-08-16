package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.{
  DataSourceRepository,
  DataTypeRepository,
  DataTypeRowRepository,
  DbContext,
  LocalFileSystem,
  PipelineRepository,
  PipelineRunRepository,
  PipelineStepRepository
}
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsNumber, JsObject}

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-509 (419-B): `PipelineRunService.executeRun`'s assertion-persistence
 *  wiring — real run / dry run, success / failure, owner / editor-grantee.
 *  Modelled after `PipelineRunRoutesSpec`'s real-Postgres fixture but calls
 *  `PipelineRunService.submit` directly (service-layer, not route-layer). */
class PipelineRunServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var ctx: DbContext                         = _
  private var pipelineRepo: PipelineRepository       = _
  private var stepRepo: PipelineStepRepository       = _
  private var dataSourceRepo: DataSourceRepository   = _
  private var pipelineRunRepo: PipelineRunRepository = _
  private var dataTypeRepo: DataTypeRepository       = _
  private var dataTypeRowRepo: DataTypeRowRepository = _
  private var service: PipelineRunService            = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx             = new DbContext(db, db)
    dataTypeRepo    = new DataTypeRepository(ctx)
    dataSourceRepo  = new DataSourceRepository(ctx)
    stepRepo        = new PipelineStepRepository(ctx)
    pipelineRepo    = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    pipelineRunRepo = new PipelineRunRepository(ctx)
    dataTypeRowRepo = new DataTypeRowRepository(ctx)
    val cache       = new PipelineRunCache()
    val fileSystem  = new LocalFileSystem(Paths.get("/"))
    service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo, dataTypeRowRepo,
      cache, registry = null, fileSystem
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private def seedDsWithData(): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-with-data', 'static', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  private def seedPipeline(dsId: String): PipelineId = {
    import PostgresProfile.api._
    val pid  = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
    )))
    PipelineId(pid)
  }

  /** Grants `role` on `pipelineId` to a freshly-created user, returning that
   *  user's `AuthenticatedUser` (HEL-279 sharing model). */
  private def seedGrantee(pipelineId: PipelineId, role: String): AuthenticatedUser = {
    import PostgresProfile.api._
    val granteeId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
               VALUES ($granteeId::uuid, ${"grantee-" + granteeId + "@test"}, 'Grantee', now(), now())""",
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('pipeline', ${pipelineId.value}, $granteeId::uuid, $role, now())"""
    )))
    AuthenticatedUser(UserId(granteeId))
  }

  private def countAssertionRows(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT COUNT(*) FROM pipeline_run_assertions".as[Int].head))
  }

  private val passingAssertRule = AssertRule("notNull", Some("name"), JsObject.empty, "error")

  // HEL-570: `seedDsWithData` always produces exactly 2 rows (alice, bob) —
  // a dataset-level `rowCountMax` rule with `count = 1` fails deterministically
  // regardless of column values, independent of the notNull-style fixtures above.
  private val blockingErrorRule = AssertRule("rowCountMax", None, JsObject("count" -> JsNumber(1)), "error")
  private val nonBlockingWarnRule = AssertRule("rowCountMax", None, JsObject("count" -> JsNumber(1)), "warn")

  /** A step whose `evaluate` throws synchronously — `StringOpsStep.apply`
   *  requires `pattern` for `extractRegex` and throws `IllegalArgumentException`
   *  when it's absent. Scala's `Future.flatMap` catches a synchronous
   *  exception thrown by the function it's given and turns it into a failed
   *  `Future`, which is exactly the mid-pipeline-failure scenario this
   *  ticket's persistence path must survive. */
  private val failingStepConfig = StringOpsConfig(
    operation = "extractRegex", field = "name", outputColumn = "out",
    pattern = None, separator = None, index = None, fields = None
  )

  "PipelineRunService.executeRun (HEL-509 / 419-B assertion persistence)" should {

    "persists assertion results on a successful real run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val runId = result.toOption.get.runId.get

      val results = await(pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(runId)))
      results should have size 1
      results.head.passed shouldBe true
      results.head.kind   shouldBe "notNull"
    }

    "persists partial assertion results after a failed real run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      await(stepRepo.insert(pid, "stringops", failingStepConfig, dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status shouldBe "failed"

      val results = await(pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(runs.head.id)))
      results should have size 1
      results.head.passed shouldBe true
    }

    "persists assertion results on a successful dry run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))

      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Right[_, _]]
      val runId = result.toOption.get.runId.get

      val results = await(pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(runId)))
      results should have size 1
      results.head.passed shouldBe true
    }

    "a failed dry run does not attempt to persist assertion results and resolves with the same error as before" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      await(stepRepo.insert(pid, "stringops", failingStepConfig, dummyUser))

      val before = countAssertionRows()
      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]

      // No pipeline_runs row exists for a failed dry run, so there is nothing
      // to link an assertion result to — verify no row was written anywhere,
      // not just for a specific (unknowable) runId.
      countAssertionRows() shouldBe before
      await(pipelineRunRepo.listByPipeline(pid, dummyUser)) shouldBe empty
    }

    "an editor-grantee-triggered real run resolves normally despite no persisted run row" in {
      val dsId    = seedDsWithData()
      val pid     = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      val grantee = seedGrantee(pid, "editor")

      val result = await(service.submit(pid, isDry = false, grantee))
      result shouldBe a[Right[_, _]]

      // insertRun already silently no-ops for a non-owner (existing, tested
      // behavior) -- no pipeline_runs row for the owner to see either.
      await(pipelineRunRepo.listByPipeline(pid, dummyUser)) shouldBe empty
    }

    "an editor-grantee-triggered dry run resolves normally despite no persisted run row" in {
      val dsId    = seedDsWithData()
      val pid     = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      val grantee = seedGrantee(pid, "editor")

      val result = await(service.submit(pid, isDry = true, grantee))
      result shouldBe a[Right[_, _]]

      await(pipelineRunRepo.listByPipeline(pid, dummyUser)) shouldBe empty
    }
  }

  "PipelineRunService.onRunSuccess (HEL-570 assert fail-policy)" should {

    "does not update the DataType schema or rows when blocked by an error-severity assertion, preserving the prior snapshot" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId

      // Establish a prior-good snapshot with no assert step at all.
      val firstRun = await(service.submit(pid, isDry = false, dummyUser))
      firstRun shouldBe a[Right[_, _]]
      firstRun.toOption.get.blocked shouldBe false

      val priorDt   = await(dataTypeRepo.findByIdInternal(outputDataTypeId)).get
      val priorRows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      priorRows should not be empty

      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

      val blockedRun = await(service.submit(pid, isDry = false, dummyUser))
      blockedRun shouldBe a[Right[_, _]]
      val response = blockedRun.toOption.get
      response.blocked shouldBe true
      response.blockedReason shouldBe defined

      val afterDt = await(dataTypeRepo.findByIdInternal(outputDataTypeId)).get
      afterDt.fields  shouldBe priorDt.fields
      afterDt.version shouldBe priorDt.version
      await(dataTypeRowRepo.listRows(outputDataTypeId.value)) shouldBe priorRows
    }

    "completes normally and updates the DataType when only a warn-severity assertion fails" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(nonBlockingWarnRule)), dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.blockedReason shouldBe None

      val dt = await(dataTypeRepo.findByIdInternal(outputDataTypeId)).get
      dt.fields should not be empty
      await(dataTypeRowRepo.listRows(outputDataTypeId.value)) should have size 2

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs.head.status shouldBe "succeeded"

      val assertions = await(pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(runs.head.id)))
      assertions should have size 1
      assertions.head.passed   shouldBe false
      assertions.head.severity shouldBe "warn"
    }

    "marks a blocked run's terminal status failed with an errorLog naming the failing rule, not the generic exception placeholder" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status shouldBe "failed"
      runs.head.rowCount shouldBe None
      runs.head.errorLog shouldBe defined
      runs.head.errorLog.get should include("rowCountMax")
      runs.head.errorLog.get should not include "Pipeline execution failed"

      val pipeline = await(pipelineRepo.findByIdInternal(pid)).get
      pipeline.lastRunStatus shouldBe Some("failed")
    }

    "persists ALL evaluated assertion results for a blocked run — passing, warn, and the blocking error alike" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(
        pid, "assert",
        AssertConfig(Vector(passingAssertRule, nonBlockingWarnRule, blockingErrorRule)),
        dummyUser
      ))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val runId = result.toOption.get.runId.get

      val results = await(pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(runId)))
      results should have size 3
      results.map(_.passed) should contain theSameElementsAs Vector(true, false, false)
      results.map(_.severity) should contain theSameElementsAs Vector("error", "warn", "error")
    }

    "a dry run with a failing error-severity assertion still completes with status dry_run, unaffected by the fail policy" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.blockedReason shouldBe None

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status shouldBe "dry_run"

      val results = await(pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(runs.head.id)))
      results should have size 1
      results.head.passed shouldBe false
    }
  }

  // ── HEL-576: history()'s per-run AssertionSummary ─────────────────────────

  "PipelineRunService.history (HEL-576 assertion summary)" should {

    "reports accurate passed/warnFailed/errorFailed counts and only the FAILED results' details" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(
        pid, "assert",
        AssertConfig(Vector(passingAssertRule, nonBlockingWarnRule, blockingErrorRule)),
        dummyUser
      ))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val history = await(service.history(pid, dummyUser))
      history shouldBe a[Right[_, _]]
      val records = history.toOption.get
      records should have size 1
      val summary = records.head.assertions
      summary.passed      shouldBe 1
      summary.warnFailed   shouldBe 1
      summary.errorFailed shouldBe 1
      summary.failures should have size 2
      summary.failures.map(_.severity) should contain theSameElementsAs Vector("warn", "error")
    }

    "reports a zero-valued summary for a run with no assert steps" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val history = await(service.history(pid, dummyUser))
      val records = history.toOption.get
      records should have size 1
      val summary = records.head.assertions
      summary.passed      shouldBe 0
      summary.warnFailed   shouldBe 0
      summary.errorFailed shouldBe 0
      summary.failures shouldBe empty
    }
  }
}
