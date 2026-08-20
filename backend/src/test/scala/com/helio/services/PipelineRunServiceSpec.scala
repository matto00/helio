package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.domain._
import com.helio.domain.PipelineAnalyzeService.schemaFieldJsonFormat
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
import spray.json._
import spray.json.DefaultJsonProtocol._

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

  // HEL-758: a minimal, real typed ActorSystem — RestApiConnector needs one to
  // construct (`implicit system: ActorSystem[_]`) but doesn't need pekko-http's
  // ScalatestRouteTest testkit (which would ambiguous-implicit-collide with the
  // `ec` above); this file's `stubConnector` below never issues a real HTTP
  // request (fetchOverride short-circuits it), so an idle guardian is enough.
  private implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "pipeline-run-service-spec")

  // HEL-758 (design.md D7 pattern, copied from PipelineApplyProposalSpecBase):
  // a stub RestApiConnector keyed on `config.url` so the same connector
  // instance exercises both a successful and a failing REST fetch.
  private val RestSuccessUrl = "https://pipeline-run-service.test/ok"
  private val RestFailureUrl = "https://pipeline-run-service.test/fail"
  private val stubConnector = new RestApiConnector(Some { config =>
    if (config.url == RestFailureUrl) Future.successful(Left("connector: endpoint unreachable"))
    else Future.successful(Right(JsArray(JsObject("name" -> JsString("alice"), "score" -> JsNumber(1)))))
  })

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
    // HEL-758: threads stubConnector so rest_api base-source tests below can
    // exercise a real (stubbed) fetch — no existing test above depends on the
    // connector being null (none of them seed a rest_api source).
    service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo, dataTypeRowRepo,
      cache, registry = null, fileSystem, connector = stubConnector
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); typedSystem.terminate()
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

  /** HEL-758: seeds a `rest_api` DataSource whose config's `url` is one of
   *  `stubConnector`'s two keyed outcomes (`RestSuccessUrl`/`RestFailureUrl`). */
  private def seedRestDs(url: String): String = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = s"""{"url":"$url"}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-rest', 'rest_api', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  /** HEL-758: seeds a `sql` DataSource targeting the file's own embedded
   *  Postgres — `port = embeddedPostgres.getPort` is reachable, `port = 1`
   *  (mirrors `PipelineApplyProposalRollbackSpec`'s existing pattern) fails
   *  fast and deterministically. */
  private def seedSqlDs(port: Int): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dsConfig =
      s"""{"dialect":"postgresql","host":"localhost","port":$port,"database":"postgres",
         |"user":"postgres","password":"postgres","query":"SELECT 1 AS one"}""".stripMargin
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-sql', 'sql', $dsConfig,
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

  /** HEL-462: inserts the companion source DataType (`source_id = dsId`) that
   *  `PipelineAnalyzeService.deriveSourceSchema` reads via `findBySourceId` —
   *  `seedPipeline`/`seedDsWithData` alone leave the source without one.
   *  Returns the new DataType's id (for `updateSourceDataTypeFields` below). */
  private def seedSourceDataType(dsId: String, fieldsJson: String): String = {
    import PostgresProfile.api._
    val dtId = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, $dsId, 'source-dt', $fieldsJson, 1, '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dtId
  }

  /** Simulates a source re-inference (`SourceService.refresh`) changing the
   *  *existing* source DataType's declared fields in place — a source has at
   *  most one companion DataType (per `deriveSourceSchema`'s doc), so drift
   *  scenarios update this row rather than insert a second one. */
  private def updateSourceDataTypeFields(dtId: String, fieldsJson: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE data_types SET fields = $fieldsJson, updated_at = now() WHERE id = $dtId"))
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

  // ── HEL-412: disabled steps are skipped during run/dry-run ────────────────

  "PipelineRunService (HEL-412 disable/enable)" should {

    "skips a disabled step during a real run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      await(stepRepo.insert(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      rows should have size 2
      rows.foreach { row =>
        row.fields.keySet should contain("name")
        row.fields.keySet should not contain "renamed_name"
      }
    }

    "applies an enabled step during a real run (control)" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      await(stepRepo.insert(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = true))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      rows should have size 2
      rows.foreach { row =>
        row.fields.keySet should contain("renamed_name")
        row.fields.keySet should not contain "name"
      }
    }

    "skips a disabled step during a dry run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))

      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rows.foreach { row =>
        row.fields.keySet should contain("name")
        row.fields.keySet should not contain "renamed_name"
      }
    }

    "an all-disabled pipeline behaves as a zero-step source passthrough" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      await(stepRepo.insert(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))
      await(stepRepo.insert(pid, "select", SelectConfig(Vector("name")), dummyUser, enabled = false))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      rows should have size 2
      // A pipeline with only disabled steps behaves like a zero-step
      // pipeline: both original source columns survive (the `select` step,
      // if it had run, would have dropped `score`).
      rows.foreach { row =>
        row.fields.keySet should contain allOf ("name", "score")
      }
    }

    "re-enabling a disabled step restores it, config intact" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      val step = await(stepRepo.insert(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))

      await(stepRepo.updateInternal(step.id, config = None, position = None, enabled = Some(true)))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      rows.foreach(_.fields.keySet should contain("renamed_name"))
    }
  }

  // ── HEL-462: schema-drift baseline persistence ────────────────────────────

  "PipelineRunService onRunSuccess (HEL-462 schema-drift baseline capture)" should {

    "persists last_source_schema (matching the source DataType's declared fields) on a successful real run" in {
      val dsId = seedDsWithData()
      seedSourceDataType(dsId, """[{"name":"name","displayName":"name","dataType":"string","nullable":true},{"name":"score","displayName":"score","dataType":"double","nullable":true}]""")
      val pid  = seedPipeline(dsId)

      await(pipelineRepo.findLastSourceSchema(pid, dummyUser)) shouldBe None

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val baselineJson = await(pipelineRepo.findLastSourceSchema(pid, dummyUser))
      baselineJson shouldBe defined
      val baseline = baselineJson.get.parseJson.convertTo[Vector[SchemaField]]
      baseline should contain theSameElementsAs Vector(SchemaField("name", "string"), SchemaField("score", "double"))
    }

    "does not persist a schema-drift baseline on a successful dry run" in {
      val dsId = seedDsWithData()
      seedSourceDataType(dsId, """[{"name":"name","displayName":"name","dataType":"string","nullable":true}]""")
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Right[_, _]]

      await(pipelineRepo.findLastSourceSchema(pid, dummyUser)) shouldBe None
    }

    "does not persist a schema-drift baseline when the run is blocked by an error-severity assertion" in {
      val dsId = seedDsWithData()
      seedSourceDataType(dsId, """[{"name":"name","displayName":"name","dataType":"string","nullable":true}]""")
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.blocked shouldBe true

      await(pipelineRepo.findLastSourceSchema(pid, dummyUser)) shouldBe None
    }

    "overwrites a stale baseline with the latest source schema on a subsequent successful run" in {
      val dsId = seedDsWithData()
      val sourceDtId = seedSourceDataType(dsId, """[{"name":"name","displayName":"name","dataType":"string","nullable":true}]""")
      val pid  = seedPipeline(dsId)

      await(service.submit(pid, isDry = false, dummyUser)) shouldBe a[Right[_, _]]
      val firstBaseline = await(pipelineRepo.findLastSourceSchema(pid, dummyUser)).get.parseJson.convertTo[Vector[SchemaField]]
      firstBaseline shouldBe Vector(SchemaField("name", "string"))

      // Source schema changes out from under the pipeline (column added).
      updateSourceDataTypeFields(sourceDtId, """[{"name":"name","displayName":"name","dataType":"string","nullable":true},{"name":"region","displayName":"region","dataType":"string","nullable":true}]""")

      await(service.submit(pid, isDry = false, dummyUser)) shouldBe a[Right[_, _]]
      val secondBaseline = await(pipelineRepo.findLastSourceSchema(pid, dummyUser)).get.parseJson.convertTo[Vector[SchemaField]]
      secondBaseline should contain theSameElementsAs Vector(SchemaField("name", "string"), SchemaField("region", "string"))
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

  // ── HEL-755 design.md D3: recordUnrunnable persistence ────────────────────

  "PipelineRunService.recordUnrunnable (HEL-755 design.md D3)" should {

    "persists a failed pipeline_runs row and updates the pipeline's lastRunStatus to failed" in {
      val dsId   = seedDsWithData()
      val pid    = seedPipeline(dsId)
      val reason = "rest_api sources aren't executed automatically yet — this pipeline was created without a run."

      val response = await(service.recordUnrunnable(pid, reason, dummyUser))
      response.blocked shouldBe true
      response.blockedReason shouldBe Some(reason)
      response.rowCount shouldBe 0
      response.rows shouldBe empty
      response.runId shouldBe defined

      // The field PipelineListTable.tsx's StatusBadge and PipelineDetailFooter.tsx
      // already render — proving "visibly needs-attention" without any frontend change.
      val pipeline = await(pipelineRepo.findByIdInternal(pid)).get
      pipeline.lastRunStatus shouldBe Some("failed")

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status   shouldBe "failed"
      runs.head.errorLog shouldBe Some(reason)
      runs.head.rowCount shouldBe None
      runs.head.id       shouldBe response.runId.get
    }
  }

  // ── HEL-758: rest_api/sql base-source execution ────────────────────────────

  "PipelineRunService.submit (HEL-758 rest_api/sql base-source execution)" should {

    "completes a real run for a healthy rest_api base source, populating the output DataType" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.rowCount should be > 0

      await(dataTypeRowRepo.listRows(outputDataTypeId.value)) should not be empty

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs.head.status shouldBe "succeeded"
    }

    "completes a real run for a healthy sql base source, populating the output DataType" in {
      val dsId = seedSqlDs(embeddedPostgres.getPort)
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.rowCount should be > 0

      await(dataTypeRowRepo.listRows(outputDataTypeId.value)) should not be empty

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs.head.status shouldBe "succeeded"
    }

    "fails an ordinary run for an unreachable rest_api source (422, last_run_status failed), not the old categorical-rejection message" in {
      val dsId = seedRestDs(RestFailureUrl)
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status shouldBe "failed"
      runs.head.errorLog.get should not include "Unsupported source type"

      val pipeline = await(pipelineRepo.findByIdInternal(pid)).get
      pipeline.lastRunStatus shouldBe Some("failed")
    }

    "fails an ordinary run for an unreachable sql source (422, last_run_status failed), not the old categorical-rejection message" in {
      val dsId = seedSqlDs(port = 1)
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status shouldBe "failed"
      runs.head.errorLog.get should not include "Unsupported source type"

      val pipeline = await(pipelineRepo.findByIdInternal(pid)).get
      pipeline.lastRunStatus shouldBe Some("failed")
    }
  }

  "PipelineRunService.previewStep (HEL-758 rest_api/sql base-source execution)" should {

    "previews a step for a healthy rest_api base source instead of rejecting the source type" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val step = await(stepRepo.insert(pid, "limit", LimitConfig(10), dummyUser))

      val result = await(service.previewStep(pid, step.id.value, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rows should not be empty
    }

    "previews a step for a healthy sql base source instead of rejecting the source type" in {
      val dsId = seedSqlDs(embeddedPostgres.getPort)
      val pid  = seedPipeline(dsId)
      val step = await(stepRepo.insert(pid, "limit", LimitConfig(10), dummyUser))

      val result = await(service.previewStep(pid, step.id.value, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rows should not be empty
    }
  }
}
