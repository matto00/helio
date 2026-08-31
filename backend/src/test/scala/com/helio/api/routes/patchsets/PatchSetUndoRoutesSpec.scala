package com.helio.api.routes.patchsets

import com.helio.api.routes.patchsets.PatchSetUndoRoutes
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet, PatchSetUndoResponse}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetUndoService}
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.JsonProtocols
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Route-level coverage for `POST /patch-sets/:id/undo` (HEL-413, tasks.md 5.4) -- request/
 *  response shape + 404/409 status mapping. Mirrors `PatchSetRoutesSpec`'s lightweight fixture
 *  shape exactly. Service-level restore/conflict coverage lives in `PatchSetUndoServiceSpec`. */
class PatchSetUndoRoutesSpec
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

  private var dashboardService: DashboardService         = _
  private var panelService: PanelService                 = _
  private var patchSetApplyService: PatchSetApplyService = _
  private var patchSetUndoService: PatchSetUndoService   = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

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
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-undo-routes-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo)
    val dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    val applicationRepo = new PatchSetApplicationRepository(ctx)(routeEc)
    patchSetApplyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker, applicationRepo
    )
    patchSetUndoService = new PatchSetUndoService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      applicationRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  private def routesFor(user: AuthenticatedUser): Route =
    new PatchSetUndoRoutes(patchSetUndoService, user)(typedSystem).routes

  private def applySuccessfully(edits: Vector[Edit], user: AuthenticatedUser): String =
    await(patchSetApplyService.apply(PatchSet(None, edits), user)) match {
      case Right(r) if r.applicationId.isDefined => r.applicationId.get
      case other                                  => fail(s"expected a successful, journaled apply, got $other")
    }

  "POST /patch-sets/:id/undo" should {

    "restore an owned application's edits and return 200 with a restored outcome per edit" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Undo route dashboard v1")), userA))._1
      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
        None, Some(UpdateDashboardRequest(Some("Undo route dashboard v2"), None, None)), None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit), userA)

      Post(s"/patch-sets/$applicationId/undo") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PatchSetUndoResponse]
        body.edits.map(_.status) shouldBe Vector("restored")
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Undo route dashboard v1")
    }

    "reject an unowned applicationId with 404, touching nothing" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Foreign undo dashboard")), userA))._1
      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
        None, Some(UpdateDashboardRequest(Some("Should never revert"), None, None)), None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit), userA)

      Post(s"/patch-sets/$applicationId/undo") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Should never revert")
    }

    "reject a nonexistent applicationId with 404" in {
      Post(s"/patch-sets/${UUID.randomUUID().toString}/undo") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "reject a conflicting application's undo with 409, restoring nothing" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Conflict route dashboard v1")), userA))._1
      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
        None, Some(UpdateDashboardRequest(Some("Conflict route dashboard v2"), None, None)), None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit), userA)

      // Independent change since the apply.
      await(dashboardService.update(dashboard.id, UpdateDashboardRequest(Some("Changed independently"), None, None), userA)) match {
        case Right(_)  => ()
        case Left(err) => fail(s"setup failed: $err")
      }

      Post(s"/patch-sets/$applicationId/undo") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Changed independently")
    }
  }
}
