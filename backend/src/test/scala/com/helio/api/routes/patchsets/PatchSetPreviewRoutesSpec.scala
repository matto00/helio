package com.helio.api.routes.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.api.routes.patchsets.PatchSetRoutes
import com.helio.api.protocols.dashboards.DashboardResponse
import com.helio.api.protocols.panels.PanelResponse
import com.helio.api.protocols.patchsets.PatchSetPreviewResponse
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService}
import com.helio.services.pipelines.PipelineService
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, OutputResponse, UpdateOutputRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.JsonProtocols
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Route-level coverage for `POST /patch-sets/preview` (HEL-408, tasks.md
 *  6.6) — mirrors `PatchSetRoutesSpec`'s lightweight fixture shape: a
 *  single (non-RLS-split) `DbContext`, hand-wired repos/services, and
 *  `PatchSetRoutes` constructed directly with an injected
 *  `AuthenticatedUser`. Service-level coverage (6.1-6.5, including the
 *  RLS-dependent impact-hint assertions) lives in
 *  `PatchSetPreviewServiceSpec`. */
class PatchSetPreviewRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var outputRepo: OutputRepository                 = _
  private var dataSourceService: DataSourceService         = _
  private var pipelineService: PipelineService             = _

  private var dashboardService: DashboardService     = _
  private var panelService: PanelService             = _
  private var patchSetApplyService: PatchSetApplyService     = _
  private var patchSetPreviewService: PatchSetPreviewService = _

  private val userAId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)

    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo         = new PanelRepository(ctx)(routeEc)
    dataSourceRepo    = new DataSourceRepository(ctx)(routeEc)
    permissionRepo     = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(routeEc)
    outputRepo         = new OutputRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-preview-routes-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)

    val applicationRepo = new PatchSetApplicationRepository(ctx)(routeEc)
    patchSetApplyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo, outputRepo
    )
    patchSetPreviewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, outputRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())"""
    ))
  }

  private def routesFor(user: AuthenticatedUser): Route =
    new PatchSetRoutes(patchSetApplyService, patchSetPreviewService, user)(typedSystem).routes

  private def seedOutput(name: String): Output = {
    val ds = await(dataSourceService.createStatic(
      StaticDataSourceRequest("Src " + UUID.randomUUID(), "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      userA
    )) match {
      case Right(d) => d
      case Left(e)  => fail(s"source seed failed: $e")
    }
    val pipeline = await(pipelineService.create(CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(ds.id.value)))), userA)) match {
      case Right(p) => p
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }
    await(outputRepo.insertInternal(PipelineId(pipeline.id), None, userA.id, name, OutputKind.Table, explicitRootId = None))
  }

  "POST /patch-sets/preview" should {

    // HEL-1239: an `output` update/delete used to 500 here (NPE on the unwired `outputRepo`,
    // then a MatchError in the projection). Asserts 200 + an Output-level diff.
    "return 200 and an Output-level diff for an output update, writing nothing (HEL-1239)" in {
      val output = seedOutput("Original name")
      val body = PatchSet(None, Vector(Edit(
        EditTarget("output", Some(output.id.value)), "update", None, None, None, None, None, None,
        Some(UpdateOutputRequest(name = Some("Previewed name"), config = None))
      )))
      Post("/patch-sets/preview", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val edit = responseAs[PatchSetPreviewResponse].edits.head
        edit.kind shouldBe "output"
        edit.op shouldBe "update"
        edit.before.getOrElse(fail("expected before")).convertTo[OutputResponse].name shouldBe "Original name"
        edit.after.getOrElse(fail("expected after")).convertTo[OutputResponse].name shouldBe "Previewed name"
      }
      await(outputRepo.findById(output.id, userA)).map(_.name) shouldBe Some("Original name")
    }

    "return 200 and an Output-level diff (after = null) for an output delete, deleting nothing (HEL-1239)" in {
      val output = seedOutput("To delete")
      val body = PatchSet(None, Vector(Edit(
        EditTarget("output", Some(output.id.value)), "delete", None, None, None, None, None, None
      )))
      Post("/patch-sets/preview", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val edit = responseAs[PatchSetPreviewResponse].edits.head
        edit.kind shouldBe "output"
        edit.op shouldBe "delete"
        edit.before.getOrElse(fail("expected before")).convertTo[OutputResponse].name shouldBe "To delete"
        edit.after shouldBe None
      }
      await(outputRepo.findById(output.id, userA)).map(_.name) shouldBe Some("To delete")
    }

    "return the computed diff, and a subsequent read of every named resource shows it unchanged (6.6)" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Preview dashboard")), userA))._1
      val panel = await(panelService.create(
        CreatePanelRequest(Some(dashboard.id.value), Some("Preview panel"), Some("divider"), None), userA
      )) match {
        case Right((p, _)) => p
        case Left(e)  => fail(s"panel seed failed: $e")
      }

      val body = PatchSet(None, Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Previewed title"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Previewed dashboard"), None, None)), None, None, None, None)
      ))

      Post("/patch-sets/preview", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PatchSetPreviewResponse]
        response.edits should have size 2
        response.edits(0).after.getOrElse(fail("expected after")).convertTo[PanelResponse].title shouldBe "Previewed title"
        response.edits(1).after.getOrElse(fail("expected after")).convertTo[DashboardResponse].name shouldBe "Previewed dashboard"
      }

      // Nothing was actually written by the preview call.
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Preview panel")
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Preview dashboard")
    }

    "reject a cross-owner edit identically to the target dashboard's own existing PATCH route -- 404, no mutation" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Owner-only dashboard")), userA))._1
      val otherUser = AuthenticatedUser(UserId(UUID.randomUUID().toString))
      import PostgresProfile.api._
      await(db.run(
        sqlu"""INSERT INTO users (id, email, created_at) VALUES (${otherUser.id.value}::uuid, ${s"b-${otherUser.id.value}@helio.test"}, now())"""
      ))

      val body = PatchSet(None, Vector(Edit(
        EditTarget("dashboard", Some(dashboard.id.value)), "update",
        None, Some(UpdateDashboardRequest(Some("Hijacked"), None, None)),
        None, None, None, None
      )))

      Post("/patch-sets/preview", body) ~> routesFor(otherUser) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Owner-only dashboard")
    }
  }
}
