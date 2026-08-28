package com.helio.services.workspace

import com.helio.services.dashboards.DashboardService
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.{WorkspaceContextBudget, WorkspaceContextService}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.api.protocols.workspace.{WorkspaceContextCounts, WorkspaceContextResponse}
import com.helio.api.routes.workspace.WorkspaceRoutes
import com.helio.domain._
import com.helio.domain.model._
import com.helio.testsupport.JsonSchemaValidation
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsBoolean, JsNull, JsNumber, JsObject, JsString}

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-371 tasks.md section 4 — `WorkspaceContextService.assemble` coverage.
 *
 *  Uses the same simplified `DbContext(db, db)` pattern `PipelineAnalyzeRoutesSpec`
 *  / `ResourceTaggingSpec` use (not the real-RLS dual-pool harness
 *  `WorkspaceTeardownServiceSpec` uses) — every read this service composes
 *  (`DataSourceService.findAll`, `DataTypeRepository.findAll`,
 *  `DashboardService.findAll`, `PipelineService.listSummaries`/`analyze`)
 *  already filters explicitly by `owner_id` in its own Slick query (not via
 *  RLS), so the simpler single-pool harness is the right tool here (design.md
 *  D1 — this service performs no direct DB access of its own). */
class WorkspaceContextServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private var dataSourceRepo: DataSourceRepository     = _
  private var dataTypeRepo: DataTypeRepository         = _
  private var dataTypeRowRepo: DataTypeRowRepository   = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var dashboardRepo: DashboardRepository       = _

  private var dataSourceService: DataSourceService = _
  private var dataTypeService: DataTypeService     = _
  private var pipelineService: PipelineService     = _
  private var service: WorkspaceContextService     = _
  private var connectorRepo: ConnectorRepository   = _
  // HEL-828: a second service instance WITH connectorRepoOpt wired -- `service` above stays
  // connectorRepoOpt = None (default), matching every pre-existing test's expectation of
  // connectors = Vector.empty; this instance is used only by the new "connectors" test group.
  private var serviceWithConnectors: WorkspaceContextService = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userEmptyId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))
  // Dedicated to the 4.1 "empty workspace" scenario so that test's exact-zero
  // assertions never depend on running before every other test in this file
  // that creates resources for userA/userB.
  private val userEmpty = AuthenticatedUser(UserId(userEmptyId))

  override def beforeAll(): Unit = {
    // Local (method-scoped), not a class-level field — shadows RouteTest's
    // inherited `executor` cleanly instead of competing with it (a
    // class-level `implicit val ec` is ambiguous with a trait member at the
    // same scope depth; mirrors BoundPanelRoutesSpec's identical local-scope
    // pattern).
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dataSourceRepo   = new DataSourceRepository(ctx)
    dataTypeRepo     = new DataTypeRepository(ctx)
    dataTypeRowRepo  = new DataTypeRowRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-workspace-context-spec")
    val fs     = new LocalFileSystem(tmpDir)
    dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    // Only "dashboard" is exercised by DashboardService's own AccessChecker
    // call in this fixture (mirrors BoundPanelRoutesSpec's identical carve-out).
    val registry        = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val accessChecker    = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    // HEL-372 design.md D7: WorkspaceContextService takes dataTypeService
    // (its listRows is the owner-scoping choke point sample rows use), not
    // the bare dataTypeRepo.
    service = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)
    connectorRepo = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    serviceWithConnectors = new WorkspaceContextService(
      dashboardService, dataSourceService, dataTypeService, pipelineService,
      connectorRepoOpt = Some(connectorRepo)
    )

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userEmptyId::uuid, ${s"empty-$userEmptyId@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── HEL-371 cycle-2: real JSON Schema validation (design.md/evaluation-1.md
  // change request 1/2) ───────────────────────────────────────────────────
  //
  // HEL-372 tasks.md 4.1: the schema-file-location + ajv-equivalent-validation
  // harness itself now lives in `JsonSchemaValidation` (shared test support) —
  // this spec was already past CONTRIBUTING's ~400-line guidance before this
  // ticket's new cases, so the mechanics were extracted rather than grown
  // further; only the response-specific `schemaValidationErrors` wrapper stays
  // local to this spec.

  private val workspaceContextJsonSchema = JsonSchemaValidation.compile("workspace/workspace-context.schema.json")

  /** Real ajv-equivalent validation (networknt/json-schema-validator, JSON
   *  Schema 2020-12) of an assembled response against
   *  `schemas/workspace/workspace-context.schema.json` — not just a Scala-side
   *  round-trip deserialization, which cannot catch a schema `required` list
   *  disagreeing with spray-json's omit-`None`-fields wire behavior (the
   *  exact bug this closes; see evaluation-1.md change request 1). */
  private def schemaValidationErrors(body: WorkspaceContextResponse): Vector[String] =
    JsonSchemaValidation.validationErrors(workspaceContextJsonSchema, workspaceContextResponseFormat.write(body).compactPrint)

  // ── Fixtures ────────────────────────────────────────────────────────────

  /** A `static` DataSource (+ its auto-created companion DataType, `sourceId`
   *  set — the source-companion / non-pipeline-output case). `tag` defaults
   *  to `None` (the common case exercised by most tests below); pass
   *  `Some(...)` to cover the tag-present wire case (schema validity 4.6b). */
  private def createSource(
      user: AuthenticatedUser,
      name: String = s"src-${UUID.randomUUID()}",
      tag: Option[String] = None
  ): DataSource = {
    val req = StaticDataSourceRequest(
      name    = name,
      `type`  = "static",
      columns = Vector(StaticColumnPayload("value", "string")),
      rows    = Vector(Vector(JsString("x"))),
      tag     = tag
    )
    await(dataSourceService.createStatic(req, user)) match {
      case Right(ds) => ds
      case Left(err) => fail(s"createStatic failed: $err")
    }
  }

  /** A Pipeline over `sourceId` (+ its freshly-inserted output DataType,
   *  `sourceId` absent — the pipeline-output / panel-bindable case). */
  private def createPipeline(
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      name: String = s"pipe-${UUID.randomUUID()}",
      outputName: String = s"out-${UUID.randomUUID()}"
  ): PipelineRepository.PipelineSummary =
    await(pipelineRepo.create(name, sourceId, outputName, user)) match {
      case Right(summary) => summary
      case Left(err)       => fail(s"pipeline create failed: $err")
    }

  private def createDashboard(user: AuthenticatedUser, name: String = s"dash-${UUID.randomUUID()}"): Dashboard = {
    val now = Instant.now()
    val dash = Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = name,
      meta       = ResourceMeta(user.id.value, now, now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id
    )
    await(dashboardRepo.insert(dash))
  }

  /** A freshly-created pipeline's output DataType starts with `fields =
   *  Vector.empty` (`PipelineRepository.create`) — real fields only land
   *  after a run. Sample-row tests (4.3/4.4/4.5) need a declared schema to
   *  sample against without running a real Spark job, so this sets it
   *  directly via the owner-scoped repo update, the same op `DataTypeService.update`
   *  itself performs. */
  private def setDataTypeFields(id: DataTypeId, user: AuthenticatedUser, fields: Vector[DataField]): Unit = {
    val existing = await(dataTypeRepo.findByIdOwned(id, user)).getOrElse(fail("DataType not found"))
    await(dataTypeRepo.update(existing.copy(fields = fields), user)).getOrElse(fail("DataType update failed"))
  }

  // ── 4.1 Empty workspace ─────────────────────────────────────────────────

  "assemble (4.1 empty workspace)" should {
    "return all-zero counts and empty collections for a user with nothing" in {
      val resp = await(service.assemble(userEmpty))
      resp.counts shouldBe WorkspaceContextCounts(0, 0, 0, 0)
      resp.dataSources shouldBe empty
      resp.dataTypes shouldBe empty
      resp.pipelines shouldBe empty
      resp.dashboards shouldBe empty
    }
  }

  // ── 4.2 Owner-scoping ───────────────────────────────────────────────────

  "assemble (4.2 owner-scoping)" should {
    "never surface another user's resources, and counts reflect only the caller's own" in {
      val bSource = createSource(userB, "b-source")
      createPipeline(userB, bSource.id, "b-pipeline")
      createDashboard(userB, "b-dash")

      createSource(userA, "a-source")
      createDashboard(userA, "a-dash")

      val resp = await(service.assemble(userA))

      resp.dataSources.map(_.name) shouldBe Vector("a-source")
      resp.dashboards.map(_.name) shouldBe Vector("a-dash")
      resp.pipelines shouldBe empty
      resp.dataTypes.map(_.name) should contain("a-source") // companion DataType
      resp.dataTypes.map(_.name) should not contain "b-source"

      resp.counts.dataSources shouldBe 1
      resp.counts.dashboards shouldBe 1
      resp.counts.pipelines shouldBe 0

      // Independently confirm B's response is unaffected (not just that A's is right).
      val respB = await(service.assemble(userB))
      respB.dataSources.map(_.name) shouldBe Vector("b-source")
      respB.pipelines.map(_.name) shouldBe Vector("b-pipeline")
      respB.dashboards.map(_.name) shouldBe Vector("b-dash")
    }
  }

  // ── 4.3 pipelineOutput classification ──────────────────────────────────

  "assemble (4.3 pipelineOutput classification)" should {
    "flag a source-companion DataType false and a pipeline-output DataType true" in {
      val source   = createSource(userA, "classify-source")
      val pipeline = createPipeline(userA, source.id, "classify-pipeline", "classify-output")

      val resp = await(service.assemble(userA))

      val companion = resp.dataTypes.find(_.name == "classify-source").getOrElse(fail("companion DataType missing"))
      companion.pipelineOutput shouldBe false
      companion.sourceId shouldBe Some(source.id.value)

      val output = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      output.pipelineOutput shouldBe true
      output.sourceId shouldBe None
    }
  }

  // ── 4.4 Per-step output columns, in order ──────────────────────────────

  "assemble (4.4 per-step output columns)" should {
    "report each step's outputColumns in step order, from the analyze path" in {
      val source   = createSource(userA, "steps-source")
      val pipeline = createPipeline(userA, source.id, "steps-pipeline", "steps-output")

      // Companion source schema is [value] (from createSource's static payload).
      // A select then a rename step give distinct, order-verifiable outputs.
      await(pipelineStepRepo.insert(PipelineId(pipeline.id), "select", SelectConfig(Vector("value")), userA))
      await(pipelineStepRepo.insert(PipelineId(pipeline.id), "rename", RenameConfig(Map("value" -> "renamed")), userA))

      val resp  = await(service.assemble(userA))
      val entry = resp.pipelines.find(_.id == pipeline.id).getOrElse(fail("pipeline missing"))

      entry.stepsError shouldBe None
      entry.steps.map(_.position) shouldBe Vector(0, 1)
      entry.steps(0).outputColumns shouldBe Vector("value")
      entry.steps(1).outputColumns shouldBe Vector("renamed")
    }
  }

  // ── 4.5 One pipeline's analyze failure degrades gracefully ─────────────

  "buildPipeline (4.5 analyze-failure degrade)" should {
    "degrade to steps: [] + stepsError for a summary whose pipeline no longer exists, " +
      "without affecting a sibling pipeline's own successful entry" in {
      implicit val ec: ExecutionContext = routeEc
      val goodSource    = createSource(userA, "degrade-good-source")
      val goodPipeline  = createPipeline(userA, goodSource.id, "degrade-good-pipeline", "degrade-good-output")
      val goodSummaries = await(pipelineService.listSummaries(userA)).filter(_.id == goodPipeline.id)
      goodSummaries should have size 1

      val brokenSource    = createSource(userA, "degrade-broken-source")
      val brokenPipeline  = createPipeline(userA, brokenSource.id, "degrade-broken-pipeline", "degrade-broken-output")
      val brokenSummaries = await(pipelineService.listSummaries(userA)).filter(_.id == brokenPipeline.id)
      brokenSummaries should have size 1

      // Delete the "broken" pipeline out from under its already-fetched summary —
      // reproduces the real race `analyze` degrades against (design.md D5):
      // listSummaries succeeded, but by the time analyze runs the pipeline is gone.
      await(pipelineRepo.delete(PipelineId(brokenPipeline.id), userA))

      val results = await(Future.traverse(goodSummaries ++ brokenSummaries)(service.buildPipeline(_, userA)))

      val goodEntry   = results.find(_.id == goodPipeline.id).getOrElse(fail("good pipeline entry missing"))
      val brokenEntry = results.find(_.id == brokenPipeline.id).getOrElse(fail("broken pipeline entry missing"))

      goodEntry.steps shouldBe empty // no steps added in this fixture
      goodEntry.stepsError shouldBe None

      brokenEntry.steps shouldBe empty
      brokenEntry.stepsError shouldBe defined
      brokenEntry.stepsError.get should not be empty
    }
  }

  // ── HEL-372 4.3 Sample rows per pipeline-output DataType ────────────────

  "assemble (HEL-372 4.3 sample rows)" should {
    "report up to 5 sampleRows, drawn in row order, for a pipeline-output DataType " +
      "whose snapshot has more than 5 rows" in {
      val source   = createSource(userA, "samplerows-source")
      val pipeline = createPipeline(userA, source.id, "samplerows-pipeline", "samplerows-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(DataField("name", "Name", "string", nullable = false)))
      val rows = (0 until 7).map(i => JsObject("name" -> JsString(s"row-$i")))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, rows))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      entry.sampleRows should have size 5
      entry.sampleRows.map(_.fields("name")) shouldBe (0 to 4).map(i => JsString(s"row-$i")).toVector
    }

    "report [] for a pipeline-output DataType whose pipeline has never run" in {
      val source   = createSource(userA, "norun-source")
      val pipeline = createPipeline(userA, source.id, "norun-pipeline", "norun-output")

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      entry.sampleRows shouldBe empty
    }

    "report [] for a source-companion DataType, without issuing a row query" in {
      createSource(userA, "companion-samplerows-source")

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.name == "companion-samplerows-source").getOrElse(fail("companion DataType missing"))

      entry.sampleRows shouldBe empty
    }

    "never include a string-body content field's value in sampleRows" in {
      val source   = createSource(userA, "content-source")
      val pipeline = createPipeline(userA, source.id, "content-pipeline", "content-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(
        DataField("title", "Title", "string", nullable = false),
        DataField("body", "Body", "string-body", nullable = true)
      ))
      val bigBody = "y" * 500
      await(dataTypeRowRepo.overwriteRows(
        pipeline.outputDataTypeId,
        Seq(JsObject("title" -> JsString("doc"), "body" -> JsString(bigBody)))
      ))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      entry.sampleRows should have size 1
      entry.sampleRows.head.fields.keySet should not contain "body"
      entry.sampleRows.head.fields("title") shouldBe JsString("doc")
    }
  }

  // ── HEL-372 4.4 Owner-scoping (extends 4.2) ─────────────────────────────

  "assemble (HEL-372 4.4 owner-scoping — sample rows)" should {
    "never surface another user's sampleRows" in {
      val aSource   = createSource(userA, "scoped-a-source")
      val aPipeline = createPipeline(userA, aSource.id, "scoped-a-pipeline", "scoped-a-output")
      setDataTypeFields(DataTypeId(aPipeline.outputDataTypeId), userA, Vector(DataField("name", "Name", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(aPipeline.outputDataTypeId, Seq(JsObject("name" -> JsString("secret-a")))))

      val bSource   = createSource(userB, "scoped-b-source")
      val bPipeline = createPipeline(userB, bSource.id, "scoped-b-pipeline", "scoped-b-output")
      setDataTypeFields(DataTypeId(bPipeline.outputDataTypeId), userB, Vector(DataField("name", "Name", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(bPipeline.outputDataTypeId, Seq(JsObject("name" -> JsString("secret-b")))))

      val respB  = await(service.assemble(userB))
      val entryB = respB.dataTypes.find(_.id == bPipeline.outputDataTypeId).getOrElse(fail("b output DataType missing"))
      entryB.sampleRows.map(_.fields("name")) shouldBe Vector(JsString("secret-b"))

      // B's response doesn't even carry A's DataType entry — and even if it
      // did, no sampleRows cell anywhere in B's response may equal A's value.
      respB.dataTypes.exists(_.id == aPipeline.outputDataTypeId) shouldBe false
      respB.dataTypes.flatMap(_.sampleRows).flatMap(_.fields.values) should not contain JsString("secret-a")
    }
  }

  // ── HEL-373 5.1 Column statistics via assemble (DB-backed integration) ──

  "assemble (HEL-373 5.1 columnStats)" should {
    "report min/max/mean for a numeric column, distinctCount/exampleValues for a string column" in {
      val source   = createSource(userA, "colstats-source")
      val pipeline = createPipeline(userA, source.id, "colstats-pipeline", "colstats-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(
        DataField("status", "Status", "string", nullable = true),
        DataField("amount", "Amount", "float", nullable = false)
      ))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("status" -> JsString("active"), "amount" -> JsNumber(10)),
        JsObject("status" -> JsString("inactive"), "amount" -> JsNumber(20)),
        JsObject("status" -> JsNull, "amount" -> JsNumber(30))
      )))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      val status = entry.columnStats("status")
      status.distinctCount shouldBe 2
      status.distinctCountCapped shouldBe false
      status.exampleValues should contain theSameElementsAs Vector(JsString("active"), JsString("inactive"))
      status.min shouldBe None
      status.max shouldBe None
      status.mean shouldBe None

      val amount = entry.columnStats("amount")
      amount.min shouldBe Some(10.0)
      amount.max shouldBe Some(30.0)
      amount.mean shouldBe Some(20.0)
    }

    "report no min/max/mean for a numeric-declared column whose values are unparseable strings" in {
      val source   = createSource(userA, "colstats-garbage-source")
      val pipeline = createPipeline(userA, source.id, "colstats-garbage-pipeline", "colstats-garbage-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(DataField("amount", "Amount", "float", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("amount" -> JsString("n/a")),
        JsObject("amount" -> JsString("n/a"))
      )))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      val amount = entry.columnStats("amount")
      amount.min shouldBe None
      amount.max shouldBe None
      amount.mean shouldBe None
    }

    "report min/max/mean for a numeric-declared column whose values are string-encoded numbers (CSV case)" in {
      val source   = createSource(userA, "colstats-csv-source")
      val pipeline = createPipeline(userA, source.id, "colstats-csv-pipeline", "colstats-csv-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(DataField("amount", "Amount", "integer", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("amount" -> JsString("10")),
        JsObject("amount" -> JsString("20"))
      )))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      val amount = entry.columnStats("amount")
      amount.min shouldBe Some(10.0)
      amount.max shouldBe Some(20.0)
      amount.mean shouldBe Some(15.0)
    }

    "report nullRate 1, distinctCount 0, and no min/max for an all-null column" in {
      val source   = createSource(userA, "colstats-allnull-source")
      val pipeline = createPipeline(userA, source.id, "colstats-allnull-pipeline", "colstats-allnull-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(DataField("notes", "Notes", "string", nullable = true)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("notes" -> JsNull),
        JsObject("notes" -> JsNull)
      )))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      val notes = entry.columnStats("notes")
      notes.nullRate shouldBe 1.0
      notes.distinctCount shouldBe 0
      notes.min shouldBe None
    }

    "report columnStats entries with nullRate 0/distinctCount 0 for a DataType with no run snapshot, " +
      "not omitted (5.1 branch precision)" in {
      val source   = createSource(userA, "colstats-norun-source")
      val pipeline = createPipeline(userA, source.id, "colstats-norun-pipeline", "colstats-norun-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(DataField("id", "Id", "string", nullable = false)))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      entry.columnStats.keySet shouldBe Set("id")
      entry.columnStats("id").nullRate shouldBe 0.0
      entry.columnStats("id").distinctCount shouldBe 0
    }

    "report no columnStats entry for a wide DataType's overflow columns, both empty-snapshot and non-empty" in {
      val source   = createSource(userA, "colstats-wide-source")
      val pipeline = createPipeline(userA, source.id, "colstats-wide-pipeline", "colstats-wide-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      val wideFields = (0 until 45).map(i => DataField(s"col$i", s"col$i", "string", nullable = false)).toVector
      setDataTypeFields(outputId, userA, wideFields)

      val emptyResp  = await(service.assemble(userA))
      val emptyEntry = emptyResp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      emptyEntry.columnStats.keySet should have size 40
      emptyEntry.columnStats.keySet should contain("col39")
      emptyEntry.columnStats.keySet should not contain "col40"

      val wideRow = JsObject(wideFields.map(f => f.name -> JsString(f.name)).toMap)
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(wideRow)))
      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      entry.columnStats.keySet should have size 40
      entry.columnStats.keySet should contain("col39")
      entry.columnStats.keySet should not contain "col40"
    }

    "report distinctCountCapped true for a high-cardinality column" in {
      val source   = createSource(userA, "colstats-highcard-source")
      val pipeline = createPipeline(userA, source.id, "colstats-highcard-pipeline", "colstats-highcard-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(DataField("id", "Id", "string", nullable = false)))
      val rows = (0 until 150).map(i => JsObject("id" -> JsString(s"id-$i")))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, rows))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      entry.columnStats("id").distinctCountCapped shouldBe true
      entry.columnStats("id").distinctCount shouldBe 100
    }

    "have no columnStats entry for a Content-category column" in {
      val source   = createSource(userA, "colstats-content-source")
      val pipeline = createPipeline(userA, source.id, "colstats-content-pipeline", "colstats-content-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(
        DataField("title", "Title", "string", nullable = false),
        DataField("body", "Body", "string-body", nullable = true)
      ))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("title" -> JsString("doc"), "body" -> JsString("y" * 500))
      )))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))

      entry.columnStats.keySet should not contain "body"
      entry.columnStats.keySet should contain("title")
    }

    "produce identical columnStats across two calls over an unchanged snapshot (determinism)" in {
      val source   = createSource(userA, "colstats-determinism-source")
      val pipeline = createPipeline(userA, source.id, "colstats-determinism-pipeline", "colstats-determinism-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(
        DataField("status", "Status", "string", nullable = false),
        DataField("amount", "Amount", "float", nullable = false)
      ))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("status" -> JsString("b"), "amount" -> JsNumber(3)),
        JsObject("status" -> JsString("a"), "amount" -> JsNumber(1)),
        JsObject("status" -> JsString("a"), "amount" -> JsNumber(2))
      )))

      val first  = await(service.assemble(userA)).dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("missing"))
      val second = await(service.assemble(userA)).dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("missing"))

      first.columnStats shouldBe second.columnStats
    }
  }

  "assemble (HEL-373 5.1 columnStats owner-scoping)" should {
    "never surface another user's columnStats" in {
      val aSource   = createSource(userA, "colstats-scoped-a-source")
      val aPipeline = createPipeline(userA, aSource.id, "colstats-scoped-a-pipeline", "colstats-scoped-a-output")
      setDataTypeFields(DataTypeId(aPipeline.outputDataTypeId), userA, Vector(DataField("name", "Name", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(aPipeline.outputDataTypeId, Seq(JsObject("name" -> JsString("secret-a")))))

      val bSource   = createSource(userB, "colstats-scoped-b-source")
      val bPipeline = createPipeline(userB, bSource.id, "colstats-scoped-b-pipeline", "colstats-scoped-b-output")
      setDataTypeFields(DataTypeId(bPipeline.outputDataTypeId), userB, Vector(DataField("name", "Name", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(bPipeline.outputDataTypeId, Seq(JsObject("name" -> JsString("secret-b")))))

      val respB  = await(service.assemble(userB))
      val entryB = respB.dataTypes.find(_.id == bPipeline.outputDataTypeId).getOrElse(fail("b output DataType missing"))
      entryB.columnStats("name").exampleValues shouldBe Vector(JsString("secret-b"))

      respB.dataTypes.exists(_.id == aPipeline.outputDataTypeId) shouldBe false
      respB.dataTypes.flatMap(_.columnStats.values).flatMap(_.exampleValues) should not contain JsString("secret-a")
    }
  }

  // ── HEL-372 4.5 Route-level schema validity with non-empty sampleRows ───

  "GET /workspace/context (HEL-372 4.5 sampleRows schema validity)" should {
    "validate against the schema when at least one DataType entry has non-empty sampleRows" in {
      implicit val ec: ExecutionContext = routeEc
      val source   = createSource(userA, "schema-samplerows-source")
      val pipeline = createPipeline(userA, source.id, "schema-samplerows-pipeline", "schema-samplerows-output")
      setDataTypeFields(DataTypeId(pipeline.outputDataTypeId), userA, Vector(DataField("name", "Name", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(JsObject("name" -> JsString("x")))))

      val routes = new WorkspaceRoutes(None, service, userA).routes

      Get("/workspace/context") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body  = responseAs[WorkspaceContextResponse]
        val entry = body.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
        entry.sampleRows should not be empty

        schemaValidationErrors(body) shouldBe empty
      }
    }
  }

  // ── 4.6 Route-level: 200 with a schema-valid body ───────────────────────

  "GET /workspace/context (4.6 route-level)" should {
    "return 200 with a body that is BOTH a valid WorkspaceContextResponse round-trip " +
      "AND validates against schemas/workspace/workspace-context.schema.json" in {
      implicit val ec: ExecutionContext = routeEc
      createSource(userA, "route-source") // untagged — every Optional field on this
      createDashboard(userA, "route-dash") // entry is absent-from-wire, not null

      val routes = new WorkspaceRoutes(None, service, userA).routes

      Get("/workspace/context") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[WorkspaceContextResponse]
        body.dataSources.map(_.name) should contain("route-source")
        body.dashboards.map(_.name) should contain("route-dash")
        body.generatedAt should not be empty

        // Real JSON Schema validation, not just the Scala-side deserialization
        // above — this is what actually caught evaluation-1.md's finding
        // (schema `required` listing fields spray-json omits when `None`).
        schemaValidationErrors(body) shouldBe empty
      }
    }
  }

  // ── 4.6b Schema validity — explicit present-field coverage ─────────────
  //
  // 4.6/4.1-4.5's fixtures are mostly untagged/never-run, so every Optional
  // field on those responses is absent (not present-with-a-value) — the
  // schema validator trivially can't distinguish "field correctly omitted"
  // from "field wrongly required but happens to always be absent in tests".
  // This test forces the PRESENT branch for the exact fields
  // evaluation-1.md demonstrated broken live: DataSourceEntry.tag,
  // DataTypeEntry.sourceId/tag, PipelineEntry.stepsError.

  "assemble (4.6b schema validity — present-field coverage)" should {
    "validate against the schema when tag/sourceId are present" in {
      implicit val ec: ExecutionContext = routeEc
      val taggedSource = createSource(userA, "schema-tagged-source", tag = Some("prod"))

      val resp = await(service.assemble(userA))
      val sourceEntry = resp.dataSources.find(_.name == "schema-tagged-source").getOrElse(fail("tagged source missing"))
      sourceEntry.tag shouldBe Some("prod")
      val companionEntry = resp.dataTypes.find(_.name == "schema-tagged-source").getOrElse(fail("companion DataType missing"))
      companionEntry.tag shouldBe Some("prod")
      companionEntry.sourceId shouldBe Some(taggedSource.id.value)

      schemaValidationErrors(resp) shouldBe empty
    }

    "validate against the schema when stepsError is present (the degraded-pipeline case)" in {
      implicit val ec: ExecutionContext = routeEc
      val baseline = await(service.assemble(userA))

      val brokenSource   = createSource(userA, "schema-broken-source")
      val brokenPipeline = createPipeline(userA, brokenSource.id, "schema-broken-pipeline", "schema-broken-output")
      val brokenSummary = await(pipelineService.listSummaries(userA))
        .find(_.id == brokenPipeline.id).getOrElse(fail("broken pipeline summary missing"))
      await(pipelineRepo.delete(PipelineId(brokenPipeline.id), userA))
      val brokenEntry = await(service.buildPipeline(brokenSummary, userA))
      brokenEntry.stepsError shouldBe defined

      schemaValidationErrors(baseline.copy(pipelines = baseline.pipelines :+ brokenEntry)) shouldBe empty
    }
  }

  // ── HEL-373 5.4 Schema validity — columnStats present/absent min/max/mean ─
  //
  // design.md D7's explicit lesson (HEL-371 cost a full eval cycle on this
  // exact mistake): test BOTH the field-present (numeric column) and
  // field-absent (non-numeric column) branches of min/max/mean, not
  // absent-only — absent-only coverage is exactly the gap that let the
  // original bug through.

  "assemble (HEL-373 5.4 columnStats schema validity)" should {
    "validate against the schema when min/max/mean ARE present (numeric column)" in {
      implicit val ec: ExecutionContext = routeEc
      val source   = createSource(userA, "schema-colstats-numeric-source")
      val pipeline = createPipeline(userA, source.id, "schema-colstats-numeric-pipeline", "schema-colstats-numeric-output")
      setDataTypeFields(DataTypeId(pipeline.outputDataTypeId), userA, Vector(DataField("amount", "Amount", "float", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(JsObject("amount" -> JsNumber(42)))))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      entry.columnStats("amount").min shouldBe defined

      schemaValidationErrors(resp) shouldBe empty
    }

    "validate against the schema when min/max/mean are ABSENT (non-numeric column)" in {
      implicit val ec: ExecutionContext = routeEc
      val source   = createSource(userA, "schema-colstats-nonnumeric-source")
      val pipeline = createPipeline(userA, source.id, "schema-colstats-nonnumeric-pipeline", "schema-colstats-nonnumeric-output")
      setDataTypeFields(DataTypeId(pipeline.outputDataTypeId), userA, Vector(DataField("status", "Status", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(JsObject("status" -> JsString("active")))))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      entry.columnStats("status").min shouldBe None

      schemaValidationErrors(resp) shouldBe empty
    }
  }

  // ── HEL-374 6.1 semanticRole via assemble (DB-backed integration, task 5.4) ─
  //
  // Pure-unit precedence coverage lives in WorkspaceContextServiceClassifySemanticRoleSpec
  // (tasks.md 5.1) — this confirms the real assemble() round trip wires
  // classifySemanticRole correctly and the resulting response still validates
  // against the schema with semanticRole present on every column.

  "assemble (HEL-374 6.1 semanticRole)" should {
    "report the correct semanticRole for representative columns, and validate against the schema" in {
      implicit val ec: ExecutionContext = routeEc
      val source   = createSource(userA, "semrole-source")
      val pipeline = createPipeline(userA, source.id, "semrole-pipeline", "semrole-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(
        DataField("user_id", "User Id", "integer", nullable = false),
        DataField("created_at", "Created At", "timestamp", nullable = false),
        DataField("status", "Status", "string", nullable = true),
        DataField("amount", "Amount", "float", nullable = false)
      ))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("user_id" -> JsNumber(1), "created_at" -> JsString("2024-01-01T00:00:00Z"), "status" -> JsString("active"), "amount" -> JsNumber(10)),
        JsObject("user_id" -> JsNumber(2), "created_at" -> JsString("2024-01-02T00:00:00Z"), "status" -> JsString("inactive"), "amount" -> JsNumber(20))
      )))

      val resp  = await(service.assemble(userA))
      val entry = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      def role(name: String): String = entry.columns.find(_.name == name).getOrElse(fail(s"$name column missing")).semanticRole

      role("user_id") shouldBe "identifier"
      role("created_at") shouldBe "temporal"
      role("status") shouldBe "dimension"
      role("amount") shouldBe "measure"

      schemaValidationErrors(resp) shouldBe empty
    }
  }

  // ── HEL-374 6.2 joinHints via assemble (DB-backed integration) ───────────

  "assemble (HEL-374 6.2 joinHints)" should {
    "report a join hint for two of the caller's own pipeline-output DataTypes sharing an overlapping " +
      "identifier column, and validate against the schema" in {
      implicit val ec: ExecutionContext = routeEc
      val sourceOne   = createSource(userA, "joinhint-source-one")
      val pipelineOne = createPipeline(userA, sourceOne.id, "joinhint-pipeline-one", "joinhint-output-one")
      setDataTypeFields(DataTypeId(pipelineOne.outputDataTypeId), userA, Vector(DataField("customer_id", "Customer Id", "integer", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipelineOne.outputDataTypeId, Seq(
        JsObject("customer_id" -> JsNumber(1)),
        JsObject("customer_id" -> JsNumber(2)),
        JsObject("customer_id" -> JsNumber(3))
      )))

      val sourceTwo   = createSource(userA, "joinhint-source-two")
      val pipelineTwo = createPipeline(userA, sourceTwo.id, "joinhint-pipeline-two", "joinhint-output-two")
      setDataTypeFields(DataTypeId(pipelineTwo.outputDataTypeId), userA, Vector(DataField("customer_id", "Customer Id", "integer", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipelineTwo.outputDataTypeId, Seq(
        JsObject("customer_id" -> JsNumber(2)),
        JsObject("customer_id" -> JsNumber(3)),
        JsObject("customer_id" -> JsNumber(4))
      )))

      val resp = await(service.assemble(userA))
      val hint = resp.joinHints.find(h =>
        Set(h.leftDataTypeId, h.rightDataTypeId) == Set(pipelineOne.outputDataTypeId, pipelineTwo.outputDataTypeId)
      )

      hint shouldBe defined
      hint.get.leftColumn shouldBe "customer_id"
      hint.get.rightColumn shouldBe "customer_id"
      hint.get.confidence should be > 0.5

      schemaValidationErrors(resp) shouldBe empty
    }
  }

  // ── HEL-374 6.3 joinHints owner-scoping (DB-backed integration) ──────────
  //
  // computeJoinHints itself is DB-free and pure-unit-tested directly
  // (WorkspaceContextServiceComputeJoinHintsSpec) — design.md D3's argument is
  // that assemble() never holds more than one caller's dataTypes in scope, so
  // cross-tenant comparison is structurally impossible. This test verifies
  // that argument empirically against the real assemble() path (ticket.md's
  // "Design-gate attention" explicitly flags RLS/ownership tracing as a
  // required final-gate verification item, not something to accept on
  // documentation alone once code exists) — userB's own single order_id
  // DataType has no sibling of userB's own to pair against, so if a bug ever
  // let computeJoinHints see userA's DataTypes too, this would catch the
  // resulting spurious cross-tenant hint.

  "assemble (HEL-374 6.3 joinHints owner-scoping)" should {
    "never surface a join hint referencing another caller's DataType" in {
      implicit val ec: ExecutionContext = routeEc
      val aSource   = createSource(userA, "joinhint-scoped-a-source")
      val aPipeline = createPipeline(userA, aSource.id, "joinhint-scoped-a-pipeline", "joinhint-scoped-a-output")
      setDataTypeFields(DataTypeId(aPipeline.outputDataTypeId), userA, Vector(DataField("order_id", "Order Id", "integer", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(aPipeline.outputDataTypeId, Seq(JsObject("order_id" -> JsNumber(1)), JsObject("order_id" -> JsNumber(2)))))

      val bSource   = createSource(userB, "joinhint-scoped-b-source")
      val bPipeline = createPipeline(userB, bSource.id, "joinhint-scoped-b-pipeline", "joinhint-scoped-b-output")
      setDataTypeFields(DataTypeId(bPipeline.outputDataTypeId), userB, Vector(DataField("order_id", "Order Id", "integer", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(bPipeline.outputDataTypeId, Seq(JsObject("order_id" -> JsNumber(1)), JsObject("order_id" -> JsNumber(2)))))

      val respB = await(service.assemble(userB))

      respB.joinHints.exists(h => h.leftDataTypeId == aPipeline.outputDataTypeId || h.rightDataTypeId == aPipeline.outputDataTypeId) shouldBe false
      // B alone has no second order_id-named pipeline-output DataType to pair
      // against — an empty joinHints here (rather than a hint against A's
      // DataType) is the whole point of the assertion above; this line just
      // pins the exact shape so the test isn't vacuously true.
      respB.joinHints shouldBe empty
    }
  }

  // ── HEL-828: Connectors surfaced in workspace context ────────────────────

  "assemble (HEL-828 connectors)" should {

    "degrade to an empty connectors list when connectorRepoOpt is not wired" in {
      val resp = await(service.assemble(userEmpty))
      resp.connectors shouldBe empty
    }

    "include exactly id/name/kind/host per Connector, dropping a credential-shaped defaultHeaders value by construction" in {
      implicit val ec: ExecutionContext = routeEc
      // A Connector whose config carries a custom-header auth scheme — defaultHeaders can hold
      // an Authorization-shaped value (design.md Decision 6).
      val configWithAuthHeader = JsObject(
        "authType"       -> JsString("none"),
        "defaultHeaders" -> JsObject("Authorization" -> JsString("Bearer sk-super-secret"))
      ).compactPrint
      val created = await(
        connectorRepo.create(
          ownerId             = userA.id,
          name                = "connectors-conn",
          kind                = "rest_api",
          baseUrl             = "https://api.example.com",
          config              = configWithAuthHeader,
          credentialPlaintext = "",
          credentialName      = "cred"
        )
      )

      val resp = await(serviceWithConnectors.assemble(userA))

      resp.connectors should have length 1
      val entry = resp.connectors.head
      entry.id   shouldBe created.id.value
      entry.name shouldBe "connectors-conn"
      entry.kind shouldBe "rest_api"
      entry.host shouldBe "https://api.example.com"

      // Exact serialized key set — not merely "no key literally named credential"
      // (design.md Decision 6 / spec "A Connector with credential-shaped defaultHeaders is
      // still projected safely").
      val serialized = connectorSummaryFormat.write(entry).asJsObject
      serialized.fields.keySet shouldBe Set("id", "name", "kind", "host")
      serialized.compactPrint should not include "sk-super-secret"
      serialized.compactPrint should not include "defaultHeaders"
      serialized.compactPrint should not include "Authorization"
    }

    "omit another user's Connectors" in {
      implicit val ec: ExecutionContext = routeEc
      await(
        connectorRepo.create(
          ownerId             = userB.id,
          name                = "b-only-conn",
          kind                = "rest_api",
          baseUrl             = "https://b.example.com",
          config              = """{"authType":"none"}""",
          credentialPlaintext = "",
          credentialName      = "cred"
        )
      )

      val resp = await(serviceWithConnectors.assemble(userEmpty))
      resp.connectors shouldBe empty
    }
  }

  // ── Non-blocking suggestion (evaluation-1.md) ───────────────────────────
  // Pins the exact rejection behavior of `.../teardown` now that
  // `WorkspaceRoutes` mounts unconditionally and gates `workspaceTeardownServiceOpt`
  // internally (design.md D2) rather than at the `ApiRoutes` call site. Pekko's
  // default rejection handling (no custom `RejectionHandler` in `ApiRoutes`,
  // confirmed by the evaluator via grep) resolves a bare `reject()` to 404 —
  // this test locks that down so a future refactor can't silently change it.

  "POST /workspace/teardown when workspaceTeardownServiceOpt is None" should {
    "reject with 404 (Pekko's default handling of an unmatched reject()), " +
      "while GET /workspace/context on the same routes instance still succeeds" in {
      implicit val ec: ExecutionContext = routeEc

      val routes = new WorkspaceRoutes(None, service, userA).routes
      val body = HttpEntity(
        ContentTypes.`application/json`,
        JsObject("tag" -> JsString("t"), "dryRun" -> JsBoolean(false)).compactPrint
      )

      // Route.seal applies Pekko's default RejectionHandler so the raw
      // reject() the fold produces resolves to an actual HTTP response
      // instead of leaving `check` with an unrealized rejection.
      Post("/workspace/teardown", body) ~> Route.seal(routes) ~> check {
        status shouldBe StatusCodes.NotFound
      }

      // The Option split is per-branch, not a whole-router outage: `.../context`
      // on this exact same (teardown-less) routes instance is unaffected.
      Get("/workspace/context") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  // ── HEL-377 5.3 Route-level: budgetBytes query param ─────────────────────

  "GET /workspace/context (HEL-377 budgetBytes query param)" should {
    "trim the response to the structural floor via budgetBytes=0 and report truncation accordingly" in {
      implicit val ec: ExecutionContext = routeEc
      val source   = createSource(userA, "budget-source")
      val pipeline = createPipeline(userA, source.id, "budget-pipeline", "budget-output")
      setDataTypeFields(DataTypeId(pipeline.outputDataTypeId), userA, Vector(DataField("name", "Name", "string", nullable = false)))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(JsObject("name" -> JsString("x")))))

      val routes = new WorkspaceRoutes(None, service, userA).routes

      Get("/workspace/context?budgetBytes=0") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[WorkspaceContextResponse]
        body.truncation.applied shouldBe true
        body.truncation.budgetBytes shouldBe 0
        body.truncation.structuralFloorExceedsBudget shouldBe true
        body.dataTypes.foreach(_.sampleRows shouldBe empty)
        body.dataTypes.foreach(_.columnStats.values.foreach(_.exampleValues shouldBe empty))
        body.joinHints shouldBe empty
        // Structural identity of resources is preserved even at the
        // tightest budget — the DataType itself is never dropped.
        body.dataTypes.exists(_.id == pipeline.outputDataTypeId) shouldBe true

        schemaValidationErrors(body) shouldBe empty
      }
    }

    "reject a negative budgetBytes with 400" in {
      implicit val ec: ExecutionContext = routeEc
      val routes = new WorkspaceRoutes(None, service, userA).routes

      Get("/workspace/context?budgetBytes=-1") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("budgetBytes")
      }
    }

    "use the configured default budget when budgetBytes is omitted" in {
      implicit val ec: ExecutionContext = routeEc
      createSource(userA, "budget-default-source")

      val routes = new WorkspaceRoutes(None, service, userA).routes

      Get("/workspace/context") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[WorkspaceContextResponse]
        body.truncation.budgetBytes shouldBe WorkspaceContextBudget.DefaultBudgetBytes
        // This fixture is far smaller than the (200000-byte) default budget.
        body.truncation.applied shouldBe false

        schemaValidationErrors(body) shouldBe empty
      }
    }
  }
}
