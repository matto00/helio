package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.RequestValidation
import com.helio.api.{ResourceType => AclResourceType}
import com.helio.api.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Service-level coverage for `PatchSetPreviewService.preview` (HEL-408,
 *  tasks.md 6.1-6.5) — embedded-Postgres integration tests.
 *
 *  **Real RLS, not the simplified `DbContext(db, db)` pattern most ordinary
 *  service specs use.** `PanelRepository.existsBoundToType` (design.md D4's
 *  detection mechanism) is raw SQL with NO `owner_id` predicate — its entire
 *  cross-owner-narrowing correctness depends on Postgres RLS actually being
 *  evaluated under `withUserContext` (tasks.md 6.5, round-3 REFUTE finding).
 *  Mirrors `WorkspaceTeardownServiceSpec`'s dual-pool harness (a real,
 *  non-superuser `helio_app_test` app-pool role + a `helio_privileged`
 *  pool) for the WHOLE spec, not just the RLS-dependent assertions — every
 *  OTHER assertion here (before/after diff correctness, content-check
 *  rejections) is unaffected by RLS actually being enforced (the app-layer
 *  ACL these edits go through already agrees with the RLS policies), so
 *  there is no need to juggle two different `DbContext`s in one file; this
 *  also satisfies tasks.md 6.5's "isolated ... rather than mixed into a
 *  superuser-harness spec" requirement by construction — there IS no
 *  superuser-harness portion of this spec to accidentally mix into. */
class PatchSetPreviewServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll
    with JsonProtocols {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _

  private var dashboardRepo: DashboardRepository             = _
  private var panelRepo: PanelRepository                     = _
  private var dataSourceRepo: DataSourceRepository           = _
  private var dataTypeRepo: DataTypeRepository               = _
  private var dataTypeRowRepo: DataTypeRowRepository         = _
  private var metricRepo: MetricRepository                   = _
  private var permissionRepo: ResourcePermissionRepository   = _
  private var pipelineRepo: PipelineRepository               = _
  private var pipelineStepRepo: PipelineStepRepository       = _

  private var dashboardService: DashboardService     = _
  private var panelService: PanelService             = _
  private var dataSourceService: DataSourceService   = _
  private var dataTypeService: DataTypeService        = _
  private var pipelineService: PipelineService        = _
  private var service: PatchSetPreviewService         = _
  private var applyService: PatchSetApplyService      = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)(routeEc)

    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo         = new PanelRepository(ctx)(routeEc)
    dataSourceRepo    = new DataSourceRepository(ctx)(routeEc)
    dataTypeRepo      = new DataTypeRepository(ctx)(routeEc)
    dataTypeRowRepo   = new DataTypeRowRepository(ctx)(routeEc)
    metricRepo        = new MetricRepository(ctx)(routeEc)
    permissionRepo    = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo      = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineStepRepo  = new PipelineStepRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-type",   id => dataTypeRepo.findByIdInternal(DataTypeId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-preview-service-spec"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker)
    panelService        = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
    dataTypeService     = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    service = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker
    )
    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, dataTypeService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── DB / seed helpers ────────────────────────────────────────────────────

  private def seedUsers(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  private def grantRole(resourceType: String, resourceId: String, granteeId: String, role: String): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, ${granteeId}::uuid, $role, now())"""
    ))
  }

  private def seedDashboard(owner: AuthenticatedUser, name: String = "Dashboard"): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some(name)), owner))._1

  private def seedPanel(dashboardId: DashboardId, owner: AuthenticatedUser, title: String = "Panel"): Panel =
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("metric"), None), owner)) match {
      case Right(p) => p
      case Left(e)  => fail(s"seedPanel failed: $e")
    }

  private def seedMetricPanelBoundTo(
      dashboardId: DashboardId,
      owner: AuthenticatedUser,
      dataTypeId: DataTypeId,
      title: String = "Bound panel"
  ): Panel = {
    val config = JsObject("dataTypeId" -> JsString(dataTypeId.value))
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("metric"), Some(config)), owner)) match {
      case Right(p) => p
      case Left(e)  => fail(s"seedMetricPanelBoundTo failed: $e")
    }
  }

  private def seedChartPanel(
      dashboardId: DashboardId,
      owner: AuthenticatedUser,
      chartType: String,
      aggregation: Option[JsObject],
      title: String = "Chart panel"
  ): Panel = {
    val config = aggregation.map(a => JsObject("aggregation" -> a))
    val appearance = PanelAppearancePayload(None, None, None, Some(ChartAppearance.Default.copy(chartType = Some(chartType))))
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("chart"), config, Some(appearance)), owner)) match {
      case Right(p) => p
      case Left(e)  => fail(s"seedChartPanel failed: $e")
    }
  }

  private def seedStaticSource(owner: AuthenticatedUser, name: String = "Source"): (DataSourceId, DataTypeId) = {
    val ds = await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      owner
    )) match {
      case Right(d) => d
      case Left(e)  => fail(s"seedStaticSource failed: $e")
    }
    val companion = await(dataTypeRepo.findBySourceId(ds.id, owner.id)).headOption.getOrElse(fail("companion type missing"))
    (ds.id, companion.id)
  }

  private def seedPipelineOutputType(owner: AuthenticatedUser, name: String): DataType = {
    val now = Instant.now()
    val dt = DataType(DataTypeId(UUID.randomUUID().toString), None, name, Vector(DataField("value", "value", "integer", nullable = true)), Vector.empty, 1, now, now, owner.id)
    await(dataTypeRepo.insert(dt, owner))
  }

  private def seedPipeline(owner: AuthenticatedUser, sourceId: DataSourceId, name: String = "Pipeline"): PipelineSummaryResponse =
    await(pipelineService.create(CreatePipelineRequest(name, sourceId.value, "Output"), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipeline failed: $e")
    }

  private def seedPipelineStep(pipelineId: PipelineId, owner: AuthenticatedUser, kind: String, config: JsObject): PipelineStepResponse =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest(kind, config), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipelineStep failed: $e")
    }

  // See `PatchSetApplyServiceSpec`'s identical helper/comment — Postgres
  // TIMESTAMPTZ microsecond rounding makes a freshly-minted domain object's
  // timestamps unreliable to compare bit-exact against a DB round-trip.
  // These assertions care about CONTENT fidelity, not clock precision.
  private def panelResponseNormalized(json: JsValue): PanelResponse = {
    val r = json.convertTo[PanelResponse]
    r.copy(meta = r.meta.copy(createdAt = "", lastUpdated = ""))
  }

  private def dashboardResponseNormalized(json: JsValue): DashboardResponse = {
    val r = json.convertTo[DashboardResponse]
    r.copy(meta = r.meta.copy(createdAt = "", lastUpdated = ""))
  }

  private def dataTypeResponseNormalized(json: JsValue): DataTypeResponse = {
    val r = json.convertTo[DataTypeResponse]
    r.copy(createdAt = "", updatedAt = "")
  }

  private def preview(edits: Vector[Edit], user: AuthenticatedUser): Either[ServiceError, PatchSetPreviewResponse] =
    await(service.preview(PatchSet(None, edits), user))

  // ── 6.1: mixed patch set computes correct before/after, writes nothing ──

  "PatchSetPreviewService.preview" should {

    "compute correct before/after for a mixed patch set (panel update + panel delete + dashboard update) and write nothing (6.1)" in {
      val dashboard      = seedDashboard(userA, "Original dashboard")
      val panelToUpdate  = seedPanel(dashboard.id, userA, "Original title")
      val panelToDelete  = seedPanel(dashboard.id, userA, "Delete me")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToUpdate.id.value)), "update",
          Some(UpdatePanelRequest(Some("Updated title"), None, None, None)), None, None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete",
          None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Renamed dashboard"), None, None)), None, None, None, None, None)
      )

      preview(edits, userA) match {
        case Right(response) =>
          response.edits should have size 3

          val panelUpdatePreview = response.edits(0)
          panelUpdatePreview.kind shouldBe "panel"
          panelUpdatePreview.op shouldBe "update"
          panelResponseNormalized(panelUpdatePreview.before.getOrElse(fail("expected before"))) shouldBe
            panelResponseNormalized(PanelResponse.fromDomain(panelToUpdate).toJson)
          panelUpdatePreview.after.getOrElse(fail("expected after")).convertTo[PanelResponse].title shouldBe "Updated title"

          val panelDeletePreview = response.edits(1)
          panelDeletePreview.op shouldBe "delete"
          panelDeletePreview.before shouldBe defined
          panelDeletePreview.after shouldBe None

          val dashboardUpdatePreview = response.edits(2)
          dashboardUpdatePreview.kind shouldBe "dashboard"
          dashboardUpdatePreview.after.getOrElse(fail("expected after")).convertTo[DashboardResponse].name shouldBe "Renamed dashboard"
        case Left(err) => fail(s"expected success, got $err")
      }

      // Nothing was ever written.
      await(panelRepo.findByIdInternal(panelToUpdate.id)).map(_.title) shouldBe Some("Original title")
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe defined
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Original dashboard")
    }

    "leave an update edit's after.meta.lastUpdated at prior's value, not a guessed write-time (design.md D3 timestamp exclusion)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Timestamp check")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Changed"), None, None, None)), None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) =>
          val before = response.edits.head.before.getOrElse(fail("expected before")).convertTo[PanelResponse]
          val after  = response.edits.head.after.getOrElse(fail("expected after")).convertTo[PanelResponse]
          after.title shouldBe "Changed"
          after.meta.lastUpdated shouldBe before.meta.lastUpdated
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    // ── 6.2: create sentinel / delete None ─────────────────────────────────

    "give a create edit's after the '(pending)' id sentinel, and a delete edit's after is None (6.2)" in {
      val dashboard = seedDashboard(userA)
      val panelToDelete = seedPanel(dashboard.id, userA)
      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("New panel"),
        "type"        -> JsString("metric")
      )
      val edits = Vector(
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, None, Some(createPatch)),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None, None)
      )

      preview(edits, userA) match {
        case Right(response) =>
          response.edits(0).before shouldBe None
          response.edits(0).after.getOrElse(fail("expected after")).asJsObject.fields("id") shouldBe JsString("(pending)")
          response.edits(1).after shouldBe None
        case Left(err) => fail(s"expected success, got $err")
      }

      // Nothing created or deleted -- only the one pre-existing panel remains.
      await(panelRepo.findAllByDashboardId(dashboard.id, Some(userA), Page(0, 10))).total shouldBe 1
    }

    // ── 6.3: resolveAll-level rejection ─────────────────────────────────────

    "reject an edit targeting a nonexistent resource, changing nothing, identically to apply (6.3a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Untouched")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Should never preview"), None, None, None)), None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(UUID.randomUUID().toString)), "update",
          None, Some(UpdateDashboardRequest(Some("Nonexistent"), None, None)), None, None, None, None, None)
      )

      val previewResult = preview(edits, userA)
      val applyResult    = await(applyService.apply(PatchSet(None, edits), userA))

      previewResult match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound, got $other")
      }
      applyResult match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected apply's NotFound too, got $other")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Untouched")
    }

    "reject a dashboard-delete edit from an editor (non-owner) grantee, identically to apply (6.3b)" in {
      val dashboard = seedDashboard(userA)
      grantRole("dashboard", dashboard.id.value, userBId, "editor")

      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "delete",
        None, None, None, None, None, None, None)

      preview(Vector(edit), userB) match {
        case Left(ServiceError.Forbidden(_)) => succeed
        case other                             => fail(s"expected Forbidden, got $other")
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)) shouldBe defined
    }

    // ── 6.4: content-check parity (design.md D1/D1a) ────────────────────────

    "reject a panel-update edit with a blank title, matching PATCH /api/panels/:id (6.4a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA)
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("  "), None, None, None)), None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("title must not be blank")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a panel-update edit combining chartType scatter with a set aggregation, matching PanelService.validateScatterAggregationConflict (6.4b)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedChartPanel(dashboard.id, userA, "bar", aggregation = Some(JsObject("op" -> JsString("sum"))))
      val patch = JsObject("chart" -> JsObject("chartType" -> JsString("scatter")))
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(None, Some(patch), None, None)), None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("aggregation is not supported for scatter charts")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a pipeline-rename edit with a blank name, matching PipelineService.updateName (6.4c)" in {
      val (sourceId, _) = seedStaticSource(userA, "Pipeline source")
      val pipeline        = seedPipeline(userA, sourceId, "My pipeline")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
        None, None, None, None, Some(UpdatePipelineRequest(name = "  ")), None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("name must not be empty")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a dataType-update edit with a computed-field expression exceeding MaxExpressionLength (6.4d)" in {
      val dt = seedPipelineOutputType(userA, "ExprTooLong")
      val tooLong = "1" * (RequestValidation.MaxExpressionLength + 1)
      val patch = UpdateDataTypeRequest(None, None, Some(Vector(ComputedFieldPayload("computed", "Computed", tooLong, "number"))))
      val edit = Edit(EditTarget("dataType", Some(dt.id.value)), "update",
        None, None, None, Some(patch), None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("exceeds maximum length")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a dataType-update edit with an invalid computed-field expression, matching ExpressionEvaluator.validateTolerant (6.4e)" in {
      val dt = seedPipelineOutputType(userA, "ExprInvalid")
      val patch = UpdateDataTypeRequest(None, None, Some(Vector(ComputedFieldPayload("computed", "Computed", "$unknownField + 1", "number"))))
      val edit = Edit(EditTarget("dataType", Some(dt.id.value)), "update",
        None, None, None, Some(patch), None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("Invalid expression for computed field")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a dataType-delete edit targeting a DataType with a panel OWNED by the deleting user bound to it, matching DataTypeService.delete's Conflict (6.4f)" in {
      val dt = seedPipelineOutputType(userA, "OwnedBoundType")
      seedMetricPanelBoundTo(seedDashboard(userA).id, userA, dt.id)
      val edit = Edit(EditTarget("dataType", Some(dt.id.value)), "delete", None, None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.Conflict(msg)) => msg should include("one or more panels are bound to it")
        case other                              => fail(s"expected Conflict, got $other")
      }
    }

    "reject a dataType-delete edit targeting a source-companion DataType, matching DataTypeService.checkSourceLink's Conflict (6.4g)" in {
      val (_, companionTypeId) = seedStaticSource(userA, "CompanionSource")
      val edit = Edit(EditTarget("dataType", Some(companionTypeId.value)), "delete", None, None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.Conflict(msg)) => msg should include("auto-inferred schema")
        case other                              => fail(s"expected Conflict, got $other")
      }
    }

    // ── 6.5: impact hints ────────────────────────────────────────────────────

    "hint that pipeline output rows will be stale on a pipeline-update edit (6.5a)" in {
      val (sourceId, _) = seedStaticSource(userA, "PipelineUpdateSrc")
      val pipeline        = seedPipeline(userA, sourceId, "Original name")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
        None, None, None, None, Some(UpdatePipelineRequest(name = "Renamed")), None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "hint stale rows + cascade on a pipeline-delete edit (6.5b)" in {
      val (sourceId, _) = seedStaticSource(userA, "PipelineDeleteSrc")
      val pipeline        = seedPipeline(userA, sourceId, "To delete")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "delete", None, None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) =>
          response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
          response.edits.head.impact should contain("Cascades to this pipeline's steps and run history.")
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    "hint that pipeline output rows will be stale on a pipelineStep update/delete edit (6.5c)" in {
      val (sourceId, _) = seedStaticSource(userA, "StepSrc")
      val pipeline        = seedPipeline(userA, sourceId, "Step pipeline")
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(5)))

      val updateEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(10))), None)), None)
      preview(Vector(updateEdit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
        case Left(err)         => fail(s"expected success, got $err")
      }

      val deleteEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "delete", None, None, None, None, None, None, None)
      preview(Vector(deleteEdit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "hint that a dataSource delete cascades to dependent pipelines (6.5d)" in {
      val (sourceId, _) = seedStaticSource(userA, "CascadeSrc")
      val edit = Edit(EditTarget("dataSource", Some(sourceId.value)), "delete", None, None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Cascades to any pipeline built on this source.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "hint the exact panel count on a dashboard-delete edit (6.5e)" in {
      val dashboard = seedDashboard(userA, "Three panels")
      seedPanel(dashboard.id, userA, "P1")
      seedPanel(dashboard.id, userA, "P2")
      seedPanel(dashboard.id, userA, "P3")
      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "delete", None, None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Cascades to 3 panel(s).")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "hint a rebind when a panel-update edit changes config.dataTypeId (6.5f)" in {
      val typeA = seedPipelineOutputType(userA, "RebindTypeA")
      val typeB = seedPipelineOutputType(userA, "RebindTypeB")
      val dashboard = seedDashboard(userA)
      val panel = seedMetricPanelBoundTo(dashboard.id, userA, typeA.id)

      val patch = JsObject("dataTypeId" -> JsString(typeB.id.value))
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(None, None, None, Some(patch))), None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Panel will be bound to a different DataType.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "surface no impact hint for an ordinary rename (6.5g)" in {
      val (sourceId, _) = seedStaticSource(userA, "PlainRenameSrc")
      val edit = Edit(EditTarget("dataSource", Some(sourceId.value)), "update",
        None, None, Some(UpdateDataSourceRequest(Some("Renamed source"))), None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact shouldBe empty
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "surface no dataType-delete unbind hint when no panel is bound at all (6.5h)" in {
      val dt = seedPipelineOutputType(userA, "UnboundType")
      val edit = Edit(EditTarget("dataType", Some(dt.id.value)), "delete", None, None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact shouldBe empty
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    // ── 6.5 (RLS-dependent): the corrected dataType-delete cross-owner hint ─
    //
    // design.md D4's detection mechanism: userA owns the DataType being
    // deleted; userB owns a panel bound to it, on userB's OWN dashboard.
    // userA can see that panel ONLY when userB has granted userA access to
    // that dashboard — the RLS policy `existsBoundToType` relies on is the
    // ONLY thing that can distinguish these two fixtures, so both cases
    // MUST run under the real (non-superuser) `helio_app_test` role this
    // whole spec already uses (tasks.md 6.5 / round-3 REFUTE finding).

    "surface the cross-owner-shared-panel unbind hint when the bound panel's dashboard IS visible to the deleting user via a sharing grant (6.5i)" in {
      val dt = seedPipelineOutputType(userA, "SharedVisibleType")
      val bDashboard = seedDashboard(userB, "B's dashboard")
      grantRole("dashboard", bDashboard.id.value, userAId, "viewer")
      seedMetricPanelBoundTo(bDashboard.id, userB, dt.id)

      val edit = Edit(EditTarget("dataType", Some(dt.id.value)), "delete", None, None, None, None, None, None, None)
      preview(Vector(edit), userA) match {
        case Right(response) =>
          response.edits.head.impact.exists(_.contains("may be unbound")) shouldBe true
        case Left(err) => fail(s"expected success (not a rejection -- the bound panel is NOT owned by the deleter), got $err")
      }
    }

    "surface NO unbind hint when the bound panel's dashboard is NOT visible to the deleting user at all (6.5j)" in {
      val dt = seedPipelineOutputType(userA, "SharedInvisibleType")
      val bDashboard = seedDashboard(userB, "B's private dashboard")
      // No grant from userB to userA this time.
      seedMetricPanelBoundTo(bDashboard.id, userB, dt.id)

      val edit = Edit(EditTarget("dataType", Some(dt.id.value)), "delete", None, None, None, None, None, None, None)
      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact shouldBe empty
        case Left(err)         => fail(s"expected success, got $err")
      }
    }
  }

  // ── 6.5 (direct): PanelRepository.existsBoundToType RLS-narrowing ────────

  "PanelRepository.existsBoundToType (2.3a)" should {

    "return true for a panel bound to the type on a dashboard the caller can access (owner or shared) (6.5k)" in {
      val dt = seedPipelineOutputType(userA, "DirectVisibleType")
      val bDashboard = seedDashboard(userB, "B's shared dashboard")
      grantRole("dashboard", bDashboard.id.value, userAId, "editor")
      seedMetricPanelBoundTo(bDashboard.id, userB, dt.id)

      await(panelRepo.existsBoundToType(dt.id, userA)) shouldBe true
    }

    "return false when no panel is bound to the type at all (6.5l)" in {
      val dt = seedPipelineOutputType(userA, "DirectUnboundType")
      await(panelRepo.existsBoundToType(dt.id, userA)) shouldBe false
    }

    "return false when the only bound panel's dashboard is NOT visible to the caller, proving RLS actually narrows results (6.5m)" in {
      val dt = seedPipelineOutputType(userA, "DirectInvisibleType")
      val bDashboard = seedDashboard(userB, "B's unshared dashboard")
      seedMetricPanelBoundTo(bDashboard.id, userB, dt.id)

      await(panelRepo.existsBoundToType(dt.id, userA)) shouldBe false
    }
  }
}
