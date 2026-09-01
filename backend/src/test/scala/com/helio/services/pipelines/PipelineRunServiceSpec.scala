package com.helio.services.pipelines


import com.helio.services.ServiceError
import com.helio.services.pipelines.PipelineRunService
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.steps.{FilterCondition, FilterConfig, LookupConfig, UnionConfig}
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
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
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var outputRepo: OutputRepository           = _
  private var service: PipelineRunService            = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx             = new DbContext(db, db)
    dataSourceRepo  = new DataSourceRepository(ctx)
    stepRepo        = new PipelineStepRepository(ctx)
    pipelineRepo    = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRunRepo = new PipelineRunRepository(ctx)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    outputRepo      = new OutputRepository(ctx)
    val cache       = new PipelineRunCache()
    val fileSystem  = new LocalFileSystem(Paths.get("/"))
    // HEL-758: threads stubConnector so rest_api base-source tests below can
    // exercise a real (stubbed) fetch — no existing test above depends on the
    // connector being null (none of them seed a rest_api source).
    // HEL-904 task 4.1: `dataTypeRepo`/`dataTypeRowRepo` removed outright --
    // `nodeSnapshotRepo` is the sole row-materialization write now.
    service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo,
      cache, registry = null, fileSystem, connector = stubConnector,
      outputRepo = outputRepo,
      nodeSnapshotRepo = nodeSnapshotRepo
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); typedSystem.terminate()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** HEL-905: chains onto the pipeline's CURRENT trunk-last node (mirrors what production
   *  step-creation always does via `spliceInsertAtInternal`, e.g. `PipelineService.addStep`) --
   *  a drop-in replacement for this file's prior use of the owner-scoped `PipelineStepRepository
   *  .insert`, which (per its own doc comment) has "zero live callers today (test-only)" and
   *  appends every step as a ROOT-level SIBLING at an incrementing `position`. Under the flat
   *  pre-tree-walk engine that coincidentally still ran in position order; under the tree-walk
   *  engine, a second such sibling (`position = 1`) is a `position >= 1` edge off the root --
   *  i.e. a DISCONNECTED TAIL evaluated from the source frame, not a trunk continuation. Same
   *  signature as `PipelineStepRepository.insert` so every existing `insertStep(...)` call
   *  site becomes `insertStep(...)` with no other change. */
  private def insertStep(pipelineId: PipelineId, kind: String, config: Any, user: AuthenticatedUser, enabled: Boolean = true): Future[PipelineStep] = {
    val existing = await(stepRepo.listByPipelineInternal(pipelineId))
    val parent   = stepRepo.trunkOf(existing).lastOption.map(_.id)
    stepRepo.insertInternal(pipelineId, kind, config, enabled, parent)
  }

  /** HEL-905: seeds an Output at the pipeline's CURRENT trunk-last node (or root, if no steps
   *  exist yet) so that node becomes "materialized" (design.md Decision 3/4) -- required for
   *  `node_snapshots`/`outputs.schema` writes to fire at all under the tree walk's new
   *  materialized-node-only persistence gate. Call AFTER every step for the test has been added
   *  (mirrors `snapshotRows`'s own "resolve the CURRENT trunk-last step at call time"
   *  discipline). */
  private def seedOutputAtTrunkLast(pipelineId: PipelineId): OutputId = {
    val existing = await(stepRepo.listByPipelineInternal(pipelineId))
    val nodeId   = stepRepo.trunkOf(existing).lastOption.map(_.id)
    await(outputRepo.insertInternal(pipelineId, nodeId, dummyUser.id, "test-output", OutputKind.Table)).id
  }

  /** HEL-904 task 4.1: the surviving row-materialization read -- `node_snapshots`
   *  keyed by `(pipelineId, trunkLastStepId)` -- replacing the retired
   *  `dataTypeRowRepo.listRows(outputDataTypeId)`. Resolves the CURRENT
   *  trunk-last step at call time (mirrors `PipelineRunService.
   *  onUnblockedRunSuccess`'s own `trunkLastStepIdFut` derivation), since a
   *  test may add a step between two `service.submit` calls. */
  private def snapshotRows(pid: PipelineId): Vector[JsObject] = {
    val steps = await(stepRepo.listByPipelineInternal(pid))
    val trunkLastStepId = stepRepo.trunkOf(steps).lastOption.map(_.id.value)
    await(nodeSnapshotRepo.listRows(pid.value, trunkLastStepId))
  }

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
      
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, now(), now())"""
    )))
    PipelineId(pid)
  }

  /** HEL-462/HEL-904 task 4.1: writes the source's OWN `inferred_schema` column directly (the
   *  baseline-capture read path `PipelineRunService.onUnblockedRunSuccess` uses now,
   *  `dataSourceRepo.findByIdOwned(...).inferredSchema` — no companion DataType exists anymore)
   *  — `seedPipeline`/`seedDsWithData` alone leave the source's `inferred_schema` empty.
   *  `schemaJson` is a `Vector[SchemaField]`-shaped JSON array (`{"name", "dataType"}` per entry,
   *  NOT the old `DataField` 4-field shape). Returns `dsId` (for `updateSourceInferredSchema`
   *  below, so both helpers share one "the id to re-target" convention). */
  private def seedSourceDataType(dsId: String, schemaJson: String): String = {
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE data_sources SET inferred_schema = $schemaJson::jsonb WHERE id = $dsId"))
    dsId
  }

  /** Simulates a source re-inference (`SourceService.refresh`) changing the source's OWN
   *  `inferred_schema` column in place — drift scenarios update this row, matching
   *  `upsertInferredSchema`'s own overwrite (not append) semantics. */
  private def updateSourceDataTypeFields(dsId: String, schemaJson: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE data_sources SET inferred_schema = $schemaJson::jsonb WHERE id = $dsId"))
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
      await(insertStep(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))

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
      await(insertStep(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      await(insertStep(pid, "stringops", failingStepConfig, dummyUser))

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
      await(insertStep(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))

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
      await(insertStep(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      await(insertStep(pid, "stringops", failingStepConfig, dummyUser))

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
      await(insertStep(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
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
      await(insertStep(pid, "assert", AssertConfig(Vector(passingAssertRule)), dummyUser))
      val grantee = seedGrantee(pid, "editor")

      val result = await(service.submit(pid, isDry = true, grantee))
      result shouldBe a[Right[_, _]]

      await(pipelineRunRepo.listByPipeline(pid, dummyUser)) shouldBe empty
    }
  }

  "PipelineRunService.onRunSuccess (HEL-570 assert fail-policy)" should {

    "does not update the node_snapshots rows when blocked by an error-severity assertion, preserving the prior snapshot" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      // HEL-905: materialize the root node (None) BEFORE any step exists -- the assert step
      // added below chains onto the trunk but the Output stays attached to the root, so this
      // node key is exactly the one the assertions below read from.
      seedOutputAtTrunkLast(pid)

      // Establish a prior-good snapshot with no assert step at all -- capture the
      // trunk-last key (None, no steps yet) BEFORE the assert step below changes it.
      val firstRun = await(service.submit(pid, isDry = false, dummyUser))
      firstRun shouldBe a[Right[_, _]]
      firstRun.toOption.get.blocked shouldBe false

      val priorRows = await(nodeSnapshotRepo.listRows(pid.value, None))
      priorRows should not be empty

      await(insertStep(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

      val blockedRun = await(service.submit(pid, isDry = false, dummyUser))
      blockedRun shouldBe a[Right[_, _]]
      val response = blockedRun.toOption.get
      response.blocked shouldBe true
      response.blockedReason shouldBe defined

      // Blocked runs never call the node_snapshots write -- the pre-assert-step
      // key (None) is untouched.
      await(nodeSnapshotRepo.listRows(pid.value, None)) shouldBe priorRows
    }

    "completes normally and updates node_snapshots when only a warn-severity assertion fails" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(insertStep(pid, "assert", AssertConfig(Vector(nonBlockingWarnRule)), dummyUser))
      seedOutputAtTrunkLast(pid) // HEL-905: materialize the assert step's own node.

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.blockedReason shouldBe None

      snapshotRows(pid) should have size 2

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
      await(insertStep(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

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
      await(insertStep(
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
      await(insertStep(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

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
      await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = snapshotRows(pid)
      rows should have size 2
      rows.foreach { row =>
        row.fields.keySet should contain("name")
        row.fields.keySet should not contain "renamed_name"
      }
    }

    "applies an enabled step during a real run (control)" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = true))
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = snapshotRows(pid)
      rows should have size 2
      rows.foreach { row =>
        row.fields.keySet should contain("renamed_name")
        row.fields.keySet should not contain "name"
      }
    }

    "skips a disabled step during a dry run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))

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
      await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))
      await(insertStep(pid, "select", SelectConfig(Vector("name")), dummyUser, enabled = false))
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = snapshotRows(pid)
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
      val step = await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed_name")), dummyUser, enabled = false))
      seedOutputAtTrunkLast(pid)

      await(stepRepo.updateInternal(step.id, config = None, position = None, enabled = Some(true)))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = snapshotRows(pid)
      rows.foreach(_.fields.keySet should contain("renamed_name"))
    }
  }


  "PipelineRunService onRunSuccess (HEL-462 schema-drift baseline capture)" should {

    "persists last_source_schema (matching the source DataType's declared fields) on a successful real run" in {
      val dsId = seedDsWithData()
      seedSourceDataType(dsId, """[{"name":"name","type":"string"},{"name":"score","type":"double"}]""")
      val pid  = seedPipeline(dsId)

      await(pipelineRepo.findLastSourceSchema(pid, dummyUser)) shouldBe None

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val baselineJson = await(pipelineRepo.findLastSourceSchema(pid, dummyUser))
      baselineJson shouldBe defined
      val baseline = baselineJson.get.parseJson.convertTo[Vector[SchemaField]]
      baseline should contain theSameElementsAs Vector(SchemaField("name", "string"), SchemaField("score", "float"))
    }

    "does not persist a schema-drift baseline on a successful dry run" in {
      val dsId = seedDsWithData()
      seedSourceDataType(dsId, """[{"name":"name","type":"string"}]""")
      val pid  = seedPipeline(dsId)

      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Right[_, _]]

      await(pipelineRepo.findLastSourceSchema(pid, dummyUser)) shouldBe None
    }

    "does not persist a schema-drift baseline when the run is blocked by an error-severity assertion" in {
      val dsId = seedDsWithData()
      seedSourceDataType(dsId, """[{"name":"name","type":"string"}]""")
      val pid  = seedPipeline(dsId)
      await(insertStep(pid, "assert", AssertConfig(Vector(blockingErrorRule)), dummyUser))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.blocked shouldBe true

      await(pipelineRepo.findLastSourceSchema(pid, dummyUser)) shouldBe None
    }

    "overwrites a stale baseline with the latest source schema on a subsequent successful run" in {
      val dsId = seedDsWithData()
      val sourceDtId = seedSourceDataType(dsId, """[{"name":"name","type":"string"}]""")
      val pid  = seedPipeline(dsId)

      await(service.submit(pid, isDry = false, dummyUser)) shouldBe a[Right[_, _]]
      val firstBaseline = await(pipelineRepo.findLastSourceSchema(pid, dummyUser)).get.parseJson.convertTo[Vector[SchemaField]]
      firstBaseline shouldBe Vector(SchemaField("name", "string"))

      // Source schema changes out from under the pipeline (column added).
      updateSourceDataTypeFields(sourceDtId, """[{"name":"name","type":"string"},{"name":"region","type":"string"}]""")

      await(service.submit(pid, isDry = false, dummyUser)) shouldBe a[Right[_, _]]
      val secondBaseline = await(pipelineRepo.findLastSourceSchema(pid, dummyUser)).get.parseJson.convertTo[Vector[SchemaField]]
      secondBaseline should contain theSameElementsAs Vector(SchemaField("name", "string"), SchemaField("region", "string"))
    }
  }


  "PipelineRunService.history (HEL-576 assertion summary)" should {

    "reports accurate passed/warnFailed/errorFailed counts and only the FAILED results' details" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(insertStep(
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
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.rowCount should be > 0

      snapshotRows(pid) should not be empty

      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs.head.status shouldBe "succeeded"
    }

    "completes a real run for a healthy sql base source, populating the output DataType" in {
      val dsId = seedSqlDs(embeddedPostgres.getPort)
      val pid  = seedPipeline(dsId)
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      response.blocked shouldBe false
      response.rowCount should be > 0

      snapshotRows(pid) should not be empty

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
      val step = await(insertStep(pid, "limit", LimitConfig(10), dummyUser))

      val result = await(service.previewStep(pid, step.id.value, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rows should not be empty
    }

    "previews a step for a healthy sql base source instead of rejecting the source type" in {
      val dsId = seedSqlDs(embeddedPostgres.getPort)
      val pid  = seedPipeline(dsId)
      val step = await(insertStep(pid, "limit", LimitConfig(10), dummyUser))

      val result = await(service.previewStep(pid, step.id.value, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rows should not be empty
    }

    // HEL-904 follow-on ruling (2026-08-31): previewStep resolves the target
    // step's index against `listByPipelineInternal`'s ALREADY-CORRECT
    // executionOrder result -- it must NOT re-sort by `.position` (a
    // regression that would re-break trunk order, since every trunk step's
    // `position` is now constantly `0`).
    //
    // Seeds a -> b -> c (a 3-level pure trunk chain, all `position = 0`)
    // plus a's tail `t` (`position = 1`), but INSERTS the rows in the order
    // a, t, c, b -- deliberately NOT trunk order. A naive `.sortBy(_.position)`
    // ties every `position = 0` row (a, b, c) together and Postgres breaks
    // that tie by row/insertion order (a, c, b, since c was inserted before
    // b), landing `c` BEFORE its own parent `b` -- a materially wrong
    // ordering, not merely coincidentally-still-correct. The true
    // `executionOrder` is `[a, t, b, c]` regardless of insertion order.
    // Preview `c` (real index 3) and confirm its actual prefix execution
    // (limit values compose to the deepest cap, 2) proves the CORRECT
    // 4-step prefix ran, not the naive sort's corrupted 2-step ([a, c])
    // prefix that would also (wrongly) succeed but with different rows.
    // HEL-905 (design.md Decision 5, AC5.5): superseded by the tree-aware root-to-target-step
    // path. Previously (pre-P1.2) `previewStep` sliced `executionOrder`'s FLAT vector
    // positionally, which meant a target step downstream of a tailed node had an unrelated
    // tail's steps folded into its "prefix" (the very bug this ticket's AC5.5 names and fixes).
    // This test now asserts the CORRECTED behavior: previewing `c` executes only its own
    // ancestor chain [a, b, c] -- `t` (a's TAIL, not an ancestor of `c`) is correctly excluded.
    "resolves the target step's prefix from its parentStepId ancestor chain, excluding an unrelated tail (AC5.5)" in {
      import PostgresProfile.api._
      val dsId = seedRestDs(RestBigUrl) // RestBigTotalRows rows, well above every limit below
      val pid  = seedPipeline(dsId)
      val aId = UUID.randomUUID().toString
      val bId = UUID.randomUUID().toString
      val cId = UUID.randomUUID().toString
      val tId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($aId, ${pid.value}, 0, 'limit', '{"count":10}', true, now(), now(), NULL)""",
        // `t` inserted BEFORE `b`/`c` -- deliberately out of executionOrder,
        // though still satisfying the parent_step_id FK (which requires
        // each row's parent to already exist).
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($tId, ${pid.value}, 1, 'limit', '{"count":1}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($bId, ${pid.value}, 0, 'limit', '{"count":5}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($cId, ${pid.value}, 0, 'limit', '{"count":2}', true, now(), now(), $bId)"""
      )))

      // Sanity: the real executionOrder is [a, t, b, c] -- c at index 3.
      val steps = await(stepRepo.listByPipelineInternal(pid))
      steps.map(_.id.value) shouldBe Vector(aId, tId, bId, cId)

      // `previewStep` now walks `c`'s `parentStepId` chain back to the root -- [a, b, c] -- and
      // evaluates exactly that chain, regardless of `t`'s presence or its own `executionOrder`
      // position. Composing those limits sequentially caps the result to 2 rows (10 -> 5 -> 2).
      // If `t` (a's tail, limit 1) were wrongly folded into the prefix (the pre-P1.2 bug), the
      // result would be capped to 1 row instead -- this assertion (2, not 1) is what
      // discriminates the fix.
      val result = await(service.previewStep(pid, cId, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rows.size shouldBe 2
    }
  }

  "PipelineRunService.previewOutputs (HEL-906 cycle 10, P1.4's preview_outputs(pipelineId, outputId?) dependency)" should {

    "previews a step-bound Output's own node, scoped by outputId rather than stepId" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val step = await(insertStep(pid, "limit", LimitConfig(10), dummyUser))
      val output = await(outputRepo.insertInternal(pid, Some(step.id), dummyUser.id, "preview-out", OutputKind.Table))

      val result = await(service.previewOutputs(pid, Some(output.id), dummyUser))
      result shouldBe a[Right[_, _]]
      val envelope = result.toOption.get
      envelope.outputs should have size 1
      envelope.outputs.head.outputId shouldBe output.id.value
      envelope.outputs.head.preview.rows should not be empty
    }

    "previews a SOURCE-bound Output (node.stepId = None) as the raw source rows" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val output = await(outputRepo.insertInternal(pid, None, dummyUser.id, "source-preview-out", OutputKind.Table))

      val result = await(service.previewOutputs(pid, Some(output.id), dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.outputs.head.preview.rows should not be empty
    }

    "404s for an Output that does not exist" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val result = await(service.previewOutputs(pid, Some(OutputId(UUID.randomUUID().toString)), dummyUser))
      result shouldBe a[Left[_, _]]
    }

    "404s when the outputId belongs to a DIFFERENT pipeline than the one in the path" in {
      val dsId1 = seedRestDs(RestSuccessUrl)
      val pid1  = seedPipeline(dsId1)
      val dsId2 = seedRestDs(RestSuccessUrl)
      val pid2  = seedPipeline(dsId2)
      val outputOnPid2 = await(outputRepo.insertInternal(pid2, None, dummyUser.id, "wrong-pipeline-out", OutputKind.Table))

      val result = await(service.previewOutputs(pid1, Some(outputOnPid2.id), dummyUser))
      result shouldBe a[Left[_, _]]
    }

    // AC requirement (evaluation-6.md item 2): the run-state-unchanged assertion must be a
    // REAL test that would fail if a preview call accidentally mutated run state -- not
    // assumed. Captures the pipeline's `lastRunStatus`/`lastRunAt` BEFORE the preview call,
    // asserts they are still None immediately after a real submit populated NON-None values
    // on a DIFFERENT pipeline (sanity that the assertion mechanism itself can detect a
    // mutation), then confirms THIS pipeline's own run state is untouched by its preview call.
    "does not mutate last_run_status/last_run_at (single-Output arm) -- a REAL run on a different pipeline in between proves the assertion mechanism can detect a mutation" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val output = await(outputRepo.insertInternal(pid, None, dummyUser.id, "unchanged-out", OutputKind.Table))

      val before = await(pipelineRepo.findByIdInternal(pid)).get
      before.lastRunStatus shouldBe None
      before.lastRunAt shouldBe None

      // Sanity check the assertion mechanism itself: a REAL run on a SEPARATE pipeline DOES
      // populate lastRunStatus/lastRunAt -- proving this test would catch a preview that
      // accidentally called the same mutation path.
      val otherDsId = seedRestDs(RestSuccessUrl)
      val otherPid  = seedPipeline(otherDsId)
      await(service.submit(otherPid, isDry = false, dummyUser))
      val otherAfterRealRun = await(pipelineRepo.findByIdInternal(otherPid)).get
      otherAfterRealRun.lastRunStatus shouldBe defined
      otherAfterRealRun.lastRunAt shouldBe defined

      val result = await(service.previewOutputs(pid, Some(output.id), dummyUser))
      result shouldBe a[Right[_, _]]

      val after = await(pipelineRepo.findByIdInternal(pid)).get
      after.lastRunStatus shouldBe None
      after.lastRunAt shouldBe None
    }

    // ── outputId ABSENT: the all-Outputs arm (HEL-906 cycle 10) ──────────────────────────────

    "with outputId absent, previews EVERY Output on the pipeline in the SAME envelope shape" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val step = await(insertStep(pid, "limit", LimitConfig(10), dummyUser))
      val sourceOutput = await(outputRepo.insertInternal(pid, None, dummyUser.id, "src-out", OutputKind.Table))
      val stepOutput   = await(outputRepo.insertInternal(pid, Some(step.id), dummyUser.id, "step-out", OutputKind.Table))

      val result = await(service.previewOutputs(pid, None, dummyUser))
      result shouldBe a[Right[_, _]]
      val envelope = result.toOption.get
      envelope.outputs.map(_.outputId).toSet shouldBe Set(sourceOutput.id.value, stepOutput.id.value)
      envelope.outputs.foreach(_.preview.rows should not be empty)
    }

    "with outputId absent, computes each DISTINCT node's preview only ONCE even when multiple Outputs share it" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val step = await(insertStep(pid, "limit", LimitConfig(10), dummyUser))
      val outputA = await(outputRepo.insertInternal(pid, Some(step.id), dummyUser.id, "shared-out-a", OutputKind.Table))
      val outputB = await(outputRepo.insertInternal(pid, Some(step.id), dummyUser.id, "shared-out-b", OutputKind.Table))

      val result = await(service.previewOutputs(pid, None, dummyUser))
      result shouldBe a[Right[_, _]]
      val envelope = result.toOption.get
      envelope.outputs should have size 2
      val byId = envelope.outputs.map(o => o.outputId -> o.preview).toMap
      // Both Outputs share the SAME node -- their previews must be identical (proves both were
      // resolved from the one computed-once result, not two independent, possibly-diverging runs).
      byId(outputA.id.value).rows shouldBe byId(outputB.id.value).rows
    }

    "with outputId absent, an empty envelope for a pipeline with no Outputs" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)

      val result = await(service.previewOutputs(pid, None, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.outputs shouldBe empty
    }

    // Same AC requirement as the single-Output arm above, but for the all-Outputs path -- the
    // evaluation-explicitly-named risk: "that's exactly where a mutation would be most likely
    // to slip in given more work happens per call."
    "does not mutate last_run_status/last_run_at (all-Outputs arm) -- a REAL run on a different pipeline in between proves the assertion mechanism can detect a mutation" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val step = await(insertStep(pid, "limit", LimitConfig(10), dummyUser))
      await(outputRepo.insertInternal(pid, None, dummyUser.id, "unchanged-out-1", OutputKind.Table))
      await(outputRepo.insertInternal(pid, Some(step.id), dummyUser.id, "unchanged-out-2", OutputKind.Table))

      val before = await(pipelineRepo.findByIdInternal(pid)).get
      before.lastRunStatus shouldBe None
      before.lastRunAt shouldBe None

      val otherDsId = seedRestDs(RestSuccessUrl)
      val otherPid  = seedPipeline(otherDsId)
      await(service.submit(otherPid, isDry = false, dummyUser))
      val otherAfterRealRun = await(pipelineRepo.findByIdInternal(otherPid)).get
      otherAfterRealRun.lastRunStatus shouldBe defined
      otherAfterRealRun.lastRunAt shouldBe defined

      val result = await(service.previewOutputs(pid, None, dummyUser))
      result shouldBe a[Right[_, _]]
      result.toOption.get.outputs should have size 2

      val after = await(pipelineRepo.findByIdInternal(pid)).get
      after.lastRunStatus shouldBe None
      after.lastRunAt shouldBe None
    }

    "with outputId absent, 404s for a pipeline the caller cannot see" in {
      val dsId = seedRestDs(RestSuccessUrl)
      val pid  = seedPipeline(dsId)
      val result = await(service.previewOutputs(PipelineId(UUID.randomUUID().toString), None, dummyUser))
      result shouldBe a[Left[_, _]]
      val _ = pid
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
      val step = await(insertStep(
        pid, "compute", ComputeConfig("value_vs_adp", "stats.adp_ppr - stats.pts_ppr", None), dummyUser
      ))
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      val err = result.swap.toOption.get
      err.message should include(step.id.value)
      err.message should include("compute")
      err.message should include("Invalid number literal")

      // The materialised-row assertion: no output row was ever persisted
      // carrying `value_vs_adp` at all — let alone one set to `null` for
      // every row, which is exactly what `main` does today.
      val rows = snapshotRows(pid)
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
      val step = await(insertStep(
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
      await(insertStep(
        pid, "compute", ComputeConfig("ratio", "$score / ($score - 42)", None), dummyUser
      ))
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = snapshotRows(pid)
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
      await(insertStep(pid, "limit", LimitConfig(2000), dummyUser))

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
      val step = await(insertStep(
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
      await(insertStep(
        pid, "union", UnionConfig(otherDataSourceId = unionSecondaryDsId, mode = "byPosition"), dummyUser
      ))
      await(insertStep(
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
  "PipelineRunService (HEL-905 P1.2: tree-walk materialized-node persistence)" should {

    "materializes a tail's own node into node_snapshots/outputs.schema, distinct from the trunk-last node" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val trunkStep = await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed")), dummyUser))
      // Tail rooted off the ROOT (position 1) -- a filter keeping only "alice".
      val tail = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("AND", Vector(FilterCondition("name", "=", Some("alice")))),
        enabled = true, parentStepId = None
      ))
      seedOutputAtTrunkLast(pid) // materializes the trunk-last node (the rename step)
      val tailOutput = await(outputRepo.insertInternal(pid, Some(tail.id), dummyUser.id, "tail-output", OutputKind.Table))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      // Trunk node: both rows, renamed.
      val trunkRows = await(nodeSnapshotRepo.listRows(pid.value, Some(trunkStep.id.value)))
      trunkRows should have size 2
      trunkRows.foreach(_.fields.keySet should contain("renamed"))

      // Tail node: only "alice", evaluated from the ROOT's frame (never renamed -- the tail
      // seeded from the root, not from the trunk's rename output).
      val tailRows = await(nodeSnapshotRepo.listRows(pid.value, Some(tail.id.value)))
      tailRows should have size 1
      tailRows.head.fields.keySet should contain("name")
      tailRows.head.fields.keySet should not contain "renamed"

      val updatedTailOutput = await(outputRepo.findByIdInternal(tailOutput.id)).get
      updatedTailOutput.schema.map(_.name) should contain("name")
    }

    // HEL-905 (evaluation-1.md CR2): a two-step tail -- the MID-tail node (not the terminal one)
    // must ALSO get its own node_snapshots/outputs.schema, not just the tail's last step.
    "materializes a MID-tail node, not only the tail's terminal node" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val trunkStep = await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed")), dummyUser))
      // Tail off the root: midTail (filter to alice) -> terminalTail (rename name->finalName).
      val midTail = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("AND", Vector(FilterCondition("name", "=", Some("alice")))),
        enabled = true, parentStepId = None
      ))
      val terminalTail = await(stepRepo.insertInternal(
        pid, "rename", RenameConfig(Map("score" -> "finalScore")),
        enabled = true, parentStepId = Some(midTail.id)
      ))
      seedOutputAtTrunkLast(pid)
      val midOutput = await(outputRepo.insertInternal(pid, Some(midTail.id), dummyUser.id, "mid-output", OutputKind.Table))
      val terminalOutput = await(outputRepo.insertInternal(pid, Some(terminalTail.id), dummyUser.id, "terminal-output", OutputKind.Table))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val midRows = await(nodeSnapshotRepo.listRows(pid.value, Some(midTail.id.value)))
      midRows should have size 1
      midRows.head.fields.keySet should contain("score")
      midRows.head.fields.keySet should not contain "finalScore"

      val terminalRows = await(nodeSnapshotRepo.listRows(pid.value, Some(terminalTail.id.value)))
      terminalRows should have size 1
      terminalRows.head.fields.keySet should contain("finalScore")

      await(outputRepo.findByIdInternal(midOutput.id)).get.schema.map(_.name) should contain("score")
      await(outputRepo.findByIdInternal(terminalOutput.id)).get.schema.map(_.name) should contain("finalScore")
    }

    // HEL-905 (skeptic-final-2.md CR1 / tasks.md 4.3, ticket.md AC, specs/pipeline-execution
    // /spec.md:33-39): two Outputs attached to the SAME node must share exactly one snapshot
    // row set -- the fold is keyed by node, `overwriteRows` is called once per node key, and
    // BOTH Outputs derive their schema from that one row set, never doubled or diverging.
    "two Outputs on one node share one snapshot row set" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val trunkStep = await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed")), dummyUser))
      val outputA = await(outputRepo.insertInternal(pid, Some(trunkStep.id), dummyUser.id, "output-a", OutputKind.Table))
      val outputB = await(outputRepo.insertInternal(pid, Some(trunkStep.id), dummyUser.id, "output-b", OutputKind.Table))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      // One row set for the node -- not doubled by having two Outputs attached to it.
      val nodeRows = await(nodeSnapshotRepo.listRows(pid.value, Some(trunkStep.id.value)))
      nodeRows should have size 2
      nodeRows.foreach(_.fields.keySet should contain("renamed"))

      // Both Outputs derive their schema from that SAME row set -- non-empty and equal.
      val schemaA = await(outputRepo.findByIdInternal(outputA.id)).get.schema
      val schemaB = await(outputRepo.findByIdInternal(outputB.id)).get.schema
      schemaA should not be empty
      schemaA shouldBe schemaB
    }

    // HEL-905 (skeptic-final-2.md CR2 / tasks.md 4.4, ticket.md AC, specs/pipeline-execution
    // /spec.md:41-45): only nodes with an attached Output are materialized -- a node with NO
    // Output must have zero node_snapshots rows after a successful run, even though the tree
    // walk evaluates and produces a NodeOutcome for it.
    "only materialized nodes appear in node_snapshots after a run" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      // Intermediate trunk step: NO Output attached -- must stay unmaterialized.
      val unmaterializedStep = await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed")), dummyUser))
      // Trunk-last step: the ONLY materialized node (has an Output).
      val materializedStep = await(insertStep(pid, "rename", RenameConfig(Map("score" -> "finalScore")), dummyUser))
      await(outputRepo.insertInternal(pid, Some(materializedStep.id), dummyUser.id, "final-output", OutputKind.Table))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      // The materialized node has rows.
      await(nodeSnapshotRepo.listRows(pid.value, Some(materializedStep.id.value))) should have size 2
      // The root (no Output) and the intermediate trunk step (no Output) both have NONE --
      // even though the tree walk evaluated them and produced a NodeOutcome for each.
      await(nodeSnapshotRepo.listRows(pid.value, None)) shouldBe empty
      await(nodeSnapshotRepo.listRows(pid.value, Some(unmaterializedStep.id.value))) shouldBe empty
    }

    // HEL-905 (evaluation-1.md CR1): previewing a step ON A TAIL must return the TAIL's own
    // rows, not the trunk's terminal frame -- the pre-fix regression the evaluator caught.
    "previewStep on a tail step returns the tail's own rows, not the trunk's terminal frame" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val trunkStep = await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed")), dummyUser))
      val tailStep = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("AND", Vector(FilterCondition("name", "=", Some("alice")))),
        enabled = true, parentStepId = None
      ))

      val result = await(service.previewStep(pid, tailStep.id.value, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get
      // The tail's own row (filtered to "alice", never renamed) -- NOT the trunk's 2-row,
      // renamed frame that `outcome.rows` alone would incorrectly return.
      response.rowCount shouldBe 1
      response.rows.head.fields.keySet should contain("name")
      response.rows.head.fields.keySet should not contain "renamed"
    }

    // HEL-905 (evaluation-1.md CR7, ticket.md:24 AC, tasks.md 5.2): a dry run's response rows for
    // the trunk-last node equal exactly what a subsequent live run persists to node_snapshots for
    // that same node, over the same input -- both calls walk the identical tree.
    "dry-run response rows equal the live-run's persisted node_snapshots for the same input (AC, tasks.md 5.2)" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      await(insertStep(pid, "rename", RenameConfig(Map("name" -> "renamed")), dummyUser))
      seedOutputAtTrunkLast(pid)

      val dryResult = await(service.submit(pid, isDry = true, dummyUser))
      dryResult shouldBe a[Right[_, _]]
      val dryRows = dryResult.toOption.get.rows

      val liveResult = await(service.submit(pid, isDry = false, dummyUser))
      liveResult shouldBe a[Right[_, _]]

      val persistedRows = snapshotRows(pid)
      persistedRows shouldBe dryRows
    }

    "a dry run persists nothing to node_snapshots even for a materialized node" in {
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      seedOutputAtTrunkLast(pid)

      val result = await(service.submit(pid, isDry = true, dummyUser))
      result shouldBe a[Right[_, _]]

      await(nodeSnapshotRepo.listRows(pid.value, None)) shouldBe empty
    }

    // NOTE (HEL-905 finding, not this ticket's regression): a genuinely violating graph (two
    // position-0 children of one node) is unit-tested directly against `executeTree`
    // (`InProcessPipelineEngineTreeWalkSpec`) -- that is the layer this ticket's AC/task 2.7
    // actually targets. An end-to-end `service.submit` test is NOT included here: this
    // violating shape can only be produced via direct SQL (no production write path can create
    // it -- `spliceInsertAtInternal`/`insertInternal`/`reorderInternal` all preserve the
    // invariant by construction, per their own doc comments), AND
    // `PipelineStepRepository.listByPipelineInternal`'s pre-existing (HEL-904)
    // `executionOrder`/`walk` helper already silently drops the second position-0 child before
    // the engine ever sees it (`children.find(_.position == 0)` picks the first match; the
    // duplicate satisfies neither the trunk-child nor the tail-root filter, so it is dropped
    // from the returned Vector rather than surfaced). This pre-dates and is independent of this
    // ticket's tree-walk/InvalidGraph work -- flagged as a spinoff candidate (`executionOrder`
    // should itself detect and surface a violating duplicate), not fixed inline here.
  }

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
  // HEL-904 task 4.5: "PipelineRunService.onUnblockedRunSuccess (HEL-891 schema union)" describe
  // block removed outright -- upsertFieldsFromRows/DataType.fields no longer exist; the schema-
  // union inference engine itself (SchemaInferenceEngine.inferShallowFromJsObjects) survives for
  // a future Output-schema caller (design.md line 89), just not exercised via this deleted path.

}
