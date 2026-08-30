package com.helio.services.pipelines


import com.helio.services.ServiceError
import com.helio.services.pipelines.PipelineRunService
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.steps.{LookupConfig, UnionConfig}
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.panels.PanelCapabilityService
import com.helio.api.protocols.panels.PanelCapabilitiesResponse
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

  // HEL-758: a minimal, real typed ActorSystem — RestApiConnectorDriver needs one to
  // construct (`implicit system: ActorSystem[_]`) but doesn't need pekko-http's
  // ScalatestRouteTest testkit (which would ambiguous-implicit-collide with the
  // `ec` above); this file's `stubConnector` below never issues a real HTTP
  // request (fetchOverride short-circuits it), so an idle guardian is enough.
  private implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "pipeline-run-service-spec")

  // HEL-758 (design.md D7 pattern, copied from PipelineApplyProposalSpecBase):
  // a stub RestApiConnectorDriver keyed on `config.url` so the same connector
  // instance exercises both a successful and a failing REST fetch.
  private val RestSuccessUrl = "https://pipeline-run-service.test/ok"
  private val RestFailureUrl = "https://pipeline-run-service.test/fail"
  // HEL-861 (task 7.1): a third keyed outcome — 3303 rows, the ticket's own repro shape —
  // exercising the real REST-truncation path end to end through PipelineRunService.
  private val RestBigUrl        = "https://pipeline-run-service.test/big"
  private val RestBigTotalRows  = 3303
  // HEL-891 (task 1.1, fixture (i)): a heterogeneous JSON source exercising every shape the
  // pipeline-output schema-union fix must handle in one run. Row 0 deliberately lacks `rec`
  // (shape a). See design.md D2a: a `static` source can't express sparseness, so this is a
  // `rest_api` URL, keyed like the others.
  private val RestHeterogeneousUrl = "https://pipeline-run-service.test/heterogeneous"
  private val heterogeneousRow0 = JsObject(
    "id"          -> JsNumber(1),
    "rec_yd"      -> JsNumber(5),          // (c) integral in row 0, fractional later
    "frac_col"    -> JsNumber(BigDecimal("12.5")), // (b) fractional in row 0 -- the "double" defect
    "mixed_col"   -> JsNumber(10),          // (e) numeric in row 0, non-numeric later
    "date_col"    -> JsString("2024-01-01"), // (f) ISO date on every row
    "null_num"    -> JsNumber(1),           // (g) integral, null lands on a LATER row
    "all_null"    -> JsNull                 // (h) null on every row
  )
  private val heterogeneousRow1 = JsObject(
    "id"          -> JsNumber(2),
    "rec"         -> JsNumber(166),         // (a) absent from row 0, present here
    "rec_yd"      -> JsNumber(BigDecimal("5.5")),
    "frac_col"    -> JsNumber(BigDecimal("7.5")),
    "mixed_col"   -> JsString("N/A"),
    "date_col"    -> JsString("2024-02-01"),
    "null_num"    -> JsNull,
    "all_null"    -> JsNull
  )
  // HEL-891 (task 1.6): a second keyed URL returning the SAME rows in reverse order, to prove
  // the derived schema is order-independent.
  private val RestHeterogeneousReversedUrl = "https://pipeline-run-service.test/heterogeneous-reversed"
  private val stubConnector = new RestApiConnectorDriver(Some { config =>
    if (config.connectorId == RestFailureUrl) Future.successful(Left("connector: endpoint unreachable"))
    else if (config.connectorId == RestBigUrl)
      Future.successful(Right(JsArray(
        (1 to RestBigTotalRows).map(i => JsObject("id" -> JsNumber(i))).toVector
      )))
    else if (config.connectorId == RestHeterogeneousUrl)
      Future.successful(Right(JsArray(Vector(heterogeneousRow0, heterogeneousRow1))))
    else if (config.connectorId == RestHeterogeneousReversedUrl)
      Future.successful(Right(JsArray(Vector(heterogeneousRow1, heterogeneousRow0))))
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

  // HEL-888 (task 4.1's materialised-rows half): a third row with a NULL `score`,
  // covering the null-operand case AC3 names alongside divide-by-zero.
  // `seedDsWithData` above is used by dozens of tests expecting exactly 2 rows
  // (`alice`/`bob`), so this is a separate seed rather than a mutation of it.
  private def seedDsWithDataIncludingNullScore(): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0],["carol",null]]}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-with-null-score', 'static', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  /** HEL-758: seeds a `rest_api` DataSource whose config's `url` is one of
   *  `stubConnector`'s two keyed outcomes (`RestSuccessUrl`/`RestFailureUrl`). */
  private def seedRestDs(url: String): String = seedRestDsNamed(url, "ds-rest")

  // HEL-861 (evaluation-1 item 3): a distinctly-named variant — `seedRestDs` above always names
  // its source `'ds-rest'`, which would collapse multiple sources into one dedupe key and hide
  // an order regression. Needed only by the multi-source order-pinning test.
  private def seedRestDsNamed(url: String, name: String): String = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = s"""{"connectorId":"$url"}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, $name, 'rest_api', $dsConfig,
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

  /** HEL-862: seeds a `csv` DataSource carrying `sourceUrl`, exercising the
   *  same encode shape `DataSourceConfigCodec.encodeCsv` produces for a
   *  URL-backed CSV source. */
  private def seedCsvUrlDs(url: String): String = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = s"""{"path":"csv/$dsId.csv","sourceUrl":"$url"}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-csv-url', 'csv', $dsConfig,
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

  /** HEL-891 (task 1.1, fixture (ii)): an `ImageSource` data source backed by a real on-disk PNG
   *  -- `InProcessPipelineEngine.loadImageRowFromBytes` is the sole producer of a nested
   *  `Map[String, Any]` row value (design D2a), and this is the only source kind that reaches
   *  it. Mirrors `PipelineRunRoutesSpec.seedDsImage`. */
  private def seedDsImage(): String = {
    import PostgresProfile.api._
    val tmp = java.io.File.createTempFile("helio-pipeline-run-service-image-", ".png")
    tmp.deleteOnExit()
    val image = new java.awt.image.BufferedImage(3, 2, java.awt.image.BufferedImage.TYPE_INT_RGB)
    javax.imageio.ImageIO.write(image, "png", tmp)

    val dsId     = UUID.randomUUID().toString
    val dsConfig = s"""{"path":"${tmp.getAbsolutePath}"}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-image', 'image', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
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

  "PipelineRunService (HEL-862 URL-backed CSV, no ActorSystem threaded)" should {

    // `service` (this spec's shared fixture) is constructed with no `system`
    // argument (see beforeAll above) — mirrors every other fixture across the
    // codebase that omits it. Constructing it at all must not throw (design.md
    // Decision 3/task 6.7 — the csvUrlFetch seam closes over `system` LAZILY).
    //
    // That lazy-construction property is NOT what this test discriminates —
    // any non-`StepExecutionException` genericizes to the same
    // "Pipeline execution failed" errorLog constant (`PipelineRunService`'s
    // `transformWith` at the run-failure branch), so a real NPE would satisfy
    // this test's assertion just as well. The lazy-construction property is
    // proven elsewhere: by the fixture's own construction with no `system`
    // succeeding at all (`beforeAll` above, not aborting the suite), and
    // explicitly by `InProcessPipelineEngineSpec`'s
    // `noException should be thrownBy new InProcessPipelineEngine(fileSystem)`
    // test. What THIS test actually discriminates: a URL-backed CSV run under
    // a service constructed without an ActorSystem fails as an ordinary,
    // handled run failure — reaching the same ServiceResponse/errorLog shape
    // every other primary-source-load failure reaches — rather than
    // propagating an unhandled exception out of `submit`.
    "a URL-backed CSV run under a service constructed with no ActorSystem fails as a normal handled run failure, not an unhandled exception" in {
      val dsId = seedCsvUrlDs("https://example.com/data.csv")
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.status shouldBe "failed"
      // A primary-source-load failure (any IllegalArgumentException raised by
      // `engine.loadRowsWithStats`, including the engine's own "not configured"
      // Left from an unwired csvUrlFetch seam) is NOT wrapped in a
      // `StepExecutionException` — that wrapper only covers step-evaluation
      // failures inside `executeWithStepCounts`'s fold (HEL-311's genericizing
      // `errMsg` match in `PipelineRunService.submit`) — so the persisted
      // `errorLog` is the SAME pre-existing generic constant every other
      // primary-source-load failure (e.g. a missing-path CSV) already
      // produces, not the engine's own "not configured" text. Asserting its
      // EXACT content — not merely that some message is present — is what
      // proves this ran the ordinary curated-failure path rather than an
      // unhandled `NullPointerException` (which would propagate a
      // "java.lang.NullPointerException" cause into server-side logs, and,
      // absent the `recover`/`transformWith` handling this path exercises,
      // could plausibly surface a null/NPE-shaped string here instead).
      runs.head.errorLog shouldBe Some("Pipeline execution failed")
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

  "PipelineRunService and a compute step with a statically unparseable expression (HEL-888)" should {

    // PROOF (tasks 3.1/3.2), on MATERIALISED ROWS — the ticket's own
    // measurement requirement. `stepRepo.insert` bypasses the new write-path
    // gate (design.md Decision 3), exactly as a step stored before this
    // change would already be sitting in the database. Run on unmodified
    // `main`: the run SUCCEEDED and `dataTypeRowRepo.listRows` held 2 rows
    // each carrying `value_vs_adp: null` — the production defect, measured
    // through the real Postgres-backed row snapshot, not a function return
    // or the stored step config.
    "fails the real run naming the step id, kind, and parse error, and writes no output rows with a null-filled compute column" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      val step = await(stepRepo.insert(
        pid, "compute", ComputeConfig("value_vs_adp", "stats.adp_ppr - stats.pts_ppr", None), dummyUser
      ))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      val err = result.swap.toOption.get
      err.message should include(step.id.value)
      err.message should include("compute")
      err.message should include("Invalid number literal")

      // The materialised-row assertion: no output row was ever persisted
      // carrying `value_vs_adp` at all — let alone one set to `null` for
      // every row, which is exactly what `main` does today.
      val rows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      rows.foreach { row =>
        row.fields.get("value_vs_adp") should not be Some(JsNull)
      }
      rows.exists(_.fields.contains("value_vs_adp")) shouldBe false
    }

    // PROOF, on MATERIALISED ROWS. Run on unmodified `main`: 200ed with rows
    // carrying `value_vs_adp: null` — the same defect as run, reached through
    // design.md Decision 4's preview path (`previewStep` -> the same engine
    // fold `submit` uses).
    "preview fails with the attributed parse error rather than returning rows with a null-filled compute column" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val step = await(stepRepo.insert(
        pid, "compute", ComputeConfig("value_vs_adp", "stats.adp_ppr - stats.pts_ppr", None), dummyUser
      ))

      val result = await(service.previewStep(pid, step.id.value, dummyUser))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.message should include("Invalid number literal")
    }

    // GUARD (task 4.1), on MATERIALISED ROWS, addressing evaluation-1.md
    // Change Request 1: a PARSEABLE compute expression run through the real
    // `service.submit` -> `dataTypeRowRepo.listRows`, not an in-memory
    // `engine.execute` return value. Covers AC3's own two named cases in one
    // real run: divide-by-zero (`alice`'s score of 42 makes the denominator
    // `$score - 42` zero) and a null operand (`carol`'s `score` is stored
    // NULL). Confirmed GREEN on unmodified `main` (the per-row `null`
    // behaviour this asserts was never broken — only the STATIC parse case
    // above was), so this is a guard against Decision 6's row-loop hoist
    // accidentally collapsing the row-dependent case into the
    // row-independent one, not proof of this ticket's defect.
    "GUARD: a parseable expression over divide-by-zero and null-operand rows persists null for those rows only, and the run succeeds" in {
      val dsId = seedDsWithDataIncludingNullScore()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId
      await(stepRepo.insert(
        pid, "compute", ComputeConfig("ratio", "$score / ($score - 42)", None), dummyUser
      ))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      val byName = rows.map(r => r.fields("name").convertTo[String] -> r.fields("ratio")).toMap
      byName("alice") shouldBe JsNull   // divide-by-zero: 42 / (42 - 42)
      byName("carol") shouldBe JsNull   // null operand: score is NULL
      byName("bob")   shouldBe JsNumber(-7.4)   // 37 / (37 - 42)
    }
  }

  "PipelineRunService truncation reporting (HEL-861)" should {

    // Task 7.1: the ticket's own 3303-row repro shape, end to end through a real run.
    "a real run over a REST source with more rows than the cap reports truncation, naming both 1000 and 3303" in {
      val dsId = seedRestDs(RestBigUrl)
      val pid  = seedPipeline(dsId)
      await(stepRepo.insert(pid, "limit", LimitConfig(2000), dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get

      response.sourceRowCount shouldBe 1000L
      response.sourceTruncated shouldBe true
      response.sourceAvailableRowCount shouldBe Some(3303L)
      response.truncationNotice shouldBe defined
      response.truncationNotice.get should include("read the first 1000 rows")
      response.truncationNotice.get should include("3303")
      response.truncatedReads should have size 1
      response.truncatedReads.head.availableRowCount shouldBe Some(3303L)
    }

    // Task 7.2: no false positives — a source under the cap reports no truncation.
    "a real run over a source under the cap reports no truncation" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get

      response.sourceTruncated shouldBe false
      response.truncationNotice shouldBe None
      response.truncatedReads shouldBe empty
    }

    // Task 7.6c: the step-preview path over a truncated SECONDARY source — a separate code path
    // from the real-run test above (2.2c), which today passes no truncationSink at all. This test
    // must fail if that sink is dropped from the preview site.
    "previewStep over a union step reading a truncated secondary source reports sourceTruncated: true" in {
      val primaryDsId = seedRestDs(RestSuccessUrl) // primary is UNDER the cap
      val pid          = seedPipeline(primaryDsId)
      val secondaryDsId = seedRestDs(RestBigUrl) // secondary is OVER the cap
      val step = await(stepRepo.insert(
        pid, "union", UnionConfig(otherDataSourceId = secondaryDsId, mode = "byPosition"), dummyUser
      ))

      val result = await(service.previewStep(pid, step.id.value, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get

      response.sourceTruncated shouldBe true
      response.truncatedReads.map(_.dataSourceName) should contain("ds-rest")
    }

    // HEL-861 (evaluation-1 item 3): `truncationFields`'s dedupe used to be
    // `groupBy(...).values` (hash-ordered) — a multi-source notice could name its sources in a
    // different order between two identical runs, and the primary source was not guaranteed to
    // come first. Pins BOTH: primary first, secondaries in first-seen (step-execution) order.
    "a real run with the primary AND two distinct secondary sources truncated reports them in a stable order — primary first, then step-execution order" in {
      val primaryDsId = seedRestDsNamed(RestBigUrl, "primary-source")
      val pid          = seedPipeline(primaryDsId)
      val unionSecondaryDsId  = seedRestDsNamed(RestBigUrl, "union-secondary")
      val lookupSecondaryDsId = seedRestDsNamed(RestBigUrl, "lookup-secondary")
      await(stepRepo.insert(
        pid, "union", UnionConfig(otherDataSourceId = unionSecondaryDsId, mode = "byPosition"), dummyUser
      ))
      await(stepRepo.insert(
        pid, "lookup",
        LookupConfig(referenceDataSourceId = lookupSecondaryDsId, sourceKey = "id", lookupKey = "id", columns = Vector.empty),
        dummyUser
      ))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get

      response.truncatedReads.map(_.dataSourceName) shouldBe Vector(
        "primary-source", "union-secondary", "lookup-secondary"
      )
    }
  }

  // HEL-861 (evaluation-1 item 2): direct unit coverage of `composeTruncationNotice`'s
  // unknown-total (SQL) branch — the driver-level SQL truncation test (task 7.3) only asserted
  // `SourceReadStats`; the wording for this branch, the one most at risk of implying a number
  // nobody measured, was asserted nowhere until now. No DB / no PipelineRunService instance
  // needed — this is a pure function of the composer.
  "PipelineRunService.composeTruncationNotice (HEL-861)" should {

    "the unknown-total branch says the total is not known and names no total figure" in {
      val notice = PipelineRunService.composeTruncationNotice(
        Vector(TruncatedRead("db", 1000L, None)), cap = 1000
      )
      notice shouldBe defined
      notice.get should include("not known")
      notice.get should not include "3303"
      // No digit sequence other than the cap itself (1000) may appear — a total figure of any
      // other size would mean the composer is implying a number nobody measured.
      val digitGroups = """\d+""".r.findAllIn(notice.get).toVector
      digitGroups.distinct shouldBe Vector("1000")
    }

    "the known-total branch names both the read count and the available total" in {
      val notice = PipelineRunService.composeTruncationNotice(
        Vector(TruncatedRead("db", 1000L, Some(3303L))), cap = 1000
      )
      notice shouldBe defined
      notice.get should include("1000")
      notice.get should include("3303")
      notice.get should not include "not known"
    }

    "returns None when nothing was truncated" in {
      PipelineRunService.composeTruncationNotice(Vector.empty, cap = 1000) shouldBe None
    }
  }

  // HEL-891: pipeline-output DataType schema union across all output rows, not row 0 alone.
  // Fixture (i) (`RestHeterogeneousUrl`) carries all seven shapes task 1.1 enumerates.
  "PipelineRunService.onUnblockedRunSuccess (HEL-891 schema union)" should {

    def capabilitySvc = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)

    def runHeterogeneous(url: String = RestHeterogeneousUrl): (DataType, PanelCapabilitiesResponse) = {
      val dsId = seedRestDsNamed(url, "ds-heterogeneous-" + UUID.randomUUID())
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.blocked shouldBe false

      val dt = await(dataTypeRepo.findByIdInternal(outputDataTypeId)).get
      val caps = await(capabilitySvc.getCapabilities(outputDataTypeId, dummyUser)).toOption.get
      (dt, caps)
    }

    // 1.2 -- genuinely RED before the change: row 0 lacks `rec`.
    "includes a column absent from row 0 but present on a later row in the persisted fields" in {
      val (dt, _) = runHeterogeneous()
      dt.fields.map(_.name) should contain("rec")
    }

    // 1.3 -- genuinely RED before the change: the criterion that matters.
    "reports a column absent from row 0 but present on a later row in the capability report" in {
      val (_, caps) = runHeterogeneous()
      caps.columns.map(_.name) should contain("rec")
    }

    // 1.4 -- genuinely RED before the change: "double" fails DataFieldType.fromString and is
    // dropped by wireType.
    "types a fractional row-0 column as float and includes it in the capability report" in {
      val (dt, caps) = runHeterogeneous()
      dt.fields.find(_.name == "frac_col").map(_.dataType) shouldBe Some("float")
      caps.columns.map(_.name) should contain("frac_col")
    }

    // 1.5 -- genuinely RED before the change: row 0 is integral, so today's row-0-only inference
    // types this "integer".
    "types a column integral in row 0 but fractional later as float, not integer" in {
      val (dt, _) = runHeterogeneous()
      dt.fields.find(_.name == "rec_yd").map(_.dataType) shouldBe Some("float")
    }

    // 1.6 -- genuinely RED before the change: row-0-only inference is order-dependent by
    // construction (whichever row lands first determines both key set and types).
    "derives the same field names and types regardless of row order" in {
      val (forward, _)  = runHeterogeneous(RestHeterogeneousUrl)
      val (reversed, _) = runHeterogeneous(RestHeterogeneousReversedUrl)
      val forwardSorted  = forward.fields.map(f => f.name -> f.dataType).sortBy(_._1)
      val reversedSorted = reversed.fields.map(f => f.name -> f.dataType).sortBy(_._1)
      reversedSorted shouldBe forwardSorted
    }

    // 1.7 (D3) -- GREEN before AND after: regression guard against adopting the shared engine's
    // absence-never-contributes nullability.
    "marks every derived field nullable, including a column present and non-null on every row" in {
      val (dt, _) = runHeterogeneous()
      dt.fields.find(_.name == "id").map(_.nullable) shouldBe Some(true)
      dt.fields should not be empty
      all(dt.fields.map(_.nullable)) shouldBe true
    }

    // 1.9 (D6/CR2) -- genuinely RED before the change: row 0's numeric value pre-change types
    // this column "integer", so pre-change it WOULD be offered for the metric `value` slot;
    // post-change it must be "string" and excluded.
    "types a column numeric in row 0 but non-numeric later as string and excludes it from a Numeric slot" in {
      val (dt, caps) = runHeterogeneous()
      dt.fields.find(_.name == "mixed_col").map(_.dataType) shouldBe Some("string")
      val metricEligibleForValue = caps.capabilities("metric").eligibleColumns.getOrElse("value", Vector.empty)
      metricEligibleForValue should not contain "mixed_col"
    }

    // 1.10 (D7/CR4) -- GREEN before AND after: regression guard against adopting the shared
    // engine's title-cased displayName.
    "keeps displayName equal to the raw column name" in {
      val (dt, _) = runHeterogeneous()
      dt.fields.find(_.name == "rec_yd").map(_.displayName) shouldBe Some("rec_yd")
    }

    // 1.11 (D5 transition C) -- genuinely RED before the change: `inferFieldType` never emitted
    // "timestamp".
    "types an ISO-date-like string column as timestamp and offers it for an Orderable slot" in {
      val (dt, caps) = runHeterogeneous()
      dt.fields.find(_.name == "date_col").map(_.dataType) shouldBe Some("timestamp")
      val timelineEligibleForTime = caps.capabilities("timeline").eligibleColumns.getOrElse("time", Vector.empty)
      timelineEligibleForTime should contain("date_col")
    }

    // 1.11a (D8) -- GREEN before AND after: regression guard against a null poisoning the type
    // join. Uses integral values with the null off row 0 (see task 1.1(g)).
    "keeps a numeric column with an explicit null on a later row typed integer and Numeric-eligible" in {
      val (dt, caps) = runHeterogeneous()
      dt.fields.find(_.name == "null_num").map(_.dataType) shouldBe Some("integer")
      val metricEligibleForValue = caps.capabilities("metric").eligibleColumns.getOrElse("value", Vector.empty)
      metricEligibleForValue should contain("null_num")
    }

    // 1.11b (D8 fallback) -- GREEN before AND after: regression guard against an all-null key
    // being dropped or crashing the fold.
    "includes an all-null column in the persisted fields, typed string, and in the capability report" in {
      val (dt, caps) = runHeterogeneous()
      dt.fields.map(_.name) should contain("all_null")
      dt.fields.find(_.name == "all_null").map(_.dataType) shouldBe Some("string")
      caps.columns.map(_.name) should contain("all_null")
    }

    // 1.8 (D2/CR1) -- GREEN before AND after: regression guard against adopting flattening.
    // Fixture (ii): the image loader is the sole producer of a nested row value.
    "types the image loader's nested content value as a single string field, not flattened, matching the persisted row key" in {
      val dsId = seedDsImage()
      val pid  = seedPipeline(dsId)
      val outputDataTypeId = await(pipelineRepo.findByIdInternal(pid)).get.outputDataTypeId

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.blocked shouldBe false

      val dt = await(dataTypeRepo.findByIdInternal(outputDataTypeId)).get
      dt.fields.map(_.name) should contain("content")
      dt.fields.find(_.name == "content").map(_.dataType) shouldBe Some("string")
      dt.fields.map(_.name) should not contain "content.storageKey"

      val storedRows = await(dataTypeRowRepo.listRows(outputDataTypeId.value))
      storedRows should have size 1
      storedRows.head.fields.keySet should contain("content")
    }
  }
}
