package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AccessCheckerImpl, JsonProtocols, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.infrastructure._
import com.helio.services._
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
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var dataTypeRepo: DataTypeRepository             = _
  private var dataTypeRowRepo: DataTypeRowRepository       = _
  private var metricRepo: MetricRepository                 = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineStepRepo: PipelineStepRepository     = _

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
    dataTypeRepo      = new DataTypeRepository(ctx)(routeEc)
    dataTypeRowRepo   = new DataTypeRowRepository(ctx)(routeEc)
    metricRepo        = new MetricRepository(ctx)(routeEc)
    permissionRepo     = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-type",   id => dataTypeRepo.findByIdInternal(DataTypeId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-preview-routes-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker)
    panelService      = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
    val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    patchSetApplyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, dataTypeService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker
    )
    patchSetPreviewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker
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

  "POST /patch-sets/preview" should {

    "return the computed diff, and a subsequent read of every named resource shows it unchanged (6.6)" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Preview dashboard")), userA))._1
      val panel = await(panelService.create(
        CreatePanelRequest(Some(dashboard.id.value), Some("Preview panel"), Some("metric"), None), userA
      )) match {
        case Right(p) => p
        case Left(e)  => fail(s"panel seed failed: $e")
      }

      val body = PatchSet(None, Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Previewed title"), None, None, None)), None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Previewed dashboard"), None, None)), None, None, None, None, None)
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
        None, None, None, None, None
      )))

      Post("/patch-sets/preview", body) ~> routesFor(otherUser) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Owner-only dashboard")
    }
  }
}
