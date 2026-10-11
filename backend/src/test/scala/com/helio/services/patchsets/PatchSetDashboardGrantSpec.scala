package com.helio.services.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1482 item 7 (editor-grant audit): pins the dashboard-grant branches of the patch-set resolvers
 *  that no spec failed on when weakened: `PatchSetApplyResolvers.resolveDashboardUpdate` (dashboard update)
 *  and `PatchSetResolverSupport.authorizeEditorOnDashboard` (panel update / delete / create). The rule
 *  mirrors the REST paths (`DashboardService.update`, `PanelService`): the owner or an `editor` grantee may
 *  edit, a `viewer` grantee gets 403.
 *
 *  Viewer cases assert the EXACT pre-validation `Left(ServiceError.Forbidden())`: forward apply re-checks
 *  editor access, so a weakened resolver gate alone would end as `Right(... failure ...)` (HTTP 200) with
 *  nothing mutated, which a "nothing mutated" check cannot tell from the correct 403. */
class PatchSetDashboardGrantSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var dashboardRepo: DashboardRepository     = _
  private var panelRepo: PanelRepository             = _
  private var dashboardService: DashboardService     = _
  private var panelService: PanelService             = _
  private var applyService: PatchSetApplyService     = _
  private var previewService: PatchSetPreviewService = _

  private val ownerId   = UUID.randomUUID().toString
  private val granteeId = UUID.randomUUID().toString
  private val owner     = AuthenticatedUser(UserId(ownerId))
  private val grantee   = AuthenticatedUser(UserId(granteeId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dashboardRepo = new DashboardRepository(ctx)
    panelRepo     = new PanelRepository(ctx)
    val dataSourceRepo   = new DataSourceRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val outputRepo       = new OutputRepository(ctx)
    val applicationRepo  = new PatchSetApplicationRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-dashboard-grant-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService     = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    val dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    val outputService     = new OutputService(outputRepo, panelRepo, accessChecker)

    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo,
      outputRepo, outputService
    )
    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, outputRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, ${s"grantee-$granteeId@helio.test"}, now())"""
    )))
  }

  /** A fresh owner-owned dashboard with one panel and `grantee` granted `role` on the dashboard. */
  private def seedGrantedDashboard(role: String): (Dashboard, Panel) = {
    import PostgresProfile.api._
    val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Grant dashboard")), owner))._1
    val panel = await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), Some("Grant panel"), Some("divider"), None), owner)) match {
      case Right((p, _)) => p
      case Left(e)       => fail(s"seed panel failed: $e")
    }
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', ${dashboard.id.value}, ${granteeId}::uuid, $role, now())"""
    ))
    (dashboard, panel)
  }

  private def dashboardUpdate(dashboardId: String): Edit =
    Edit(EditTarget("dashboard", Some(dashboardId)), "update", None,
      Some(UpdateDashboardRequest(Some("Renamed by grantee"), None, None)), None, None, None, None)

  private def panelUpdate(panelId: String): Edit =
    Edit(EditTarget("panel", Some(panelId)), "update",
      Some(UpdatePanelRequest(Some("Edited by grantee"), None, None, None)), None, None, None, None, None)

  private def panelDelete(panelId: String): Edit =
    Edit(EditTarget("panel", Some(panelId)), "delete", None, None, None, None, None, None)

  private def panelCreate(dashboardId: String): Edit =
    Edit(EditTarget("panel", None), "create", None, None, None, None, None,
      Some(JsObject("dashboardId" -> JsString(dashboardId), "title" -> JsString("Created by grantee"), "type" -> JsString("divider"))))

  private def applyAs(edit: Edit) = await(applyService.apply(PatchSet(None, Vector(edit)), grantee))

  private def dashboardName(id: DashboardId): Option[String] = await(dashboardRepo.findByIdInternal(id)).map(_.name)

  "patch-set dashboard update (resolveDashboardUpdate)" should {

    "apply a dashboard update from an editor grantee and rename the dashboard" in {
      val (dashboard, _) = seedGrantedDashboard("editor")
      val resp = applyAs(dashboardUpdate(dashboard.id.value)).getOrElse(fail("expected an editor grantee's dashboard update to be accepted"))
      resp.failure shouldBe None
      resp.edits.head.status shouldBe "applied"
      dashboardName(dashboard.id) shouldBe Some("Renamed by grantee")
    }

    "refuse a dashboard update from a viewer grantee with exactly Forbidden, leaving the name unchanged" in {
      val (dashboard, _) = seedGrantedDashboard("viewer")
      applyAs(dashboardUpdate(dashboard.id.value)) shouldBe Left(ServiceError.Forbidden())
      dashboardName(dashboard.id) shouldBe Some("Grant dashboard")
    }

    "accept a dashboard update from an editor grantee on preview" in {
      val (dashboard, _) = seedGrantedDashboard("editor")
      await(previewService.preview(PatchSet(None, Vector(dashboardUpdate(dashboard.id.value))), grantee)).isRight shouldBe true
      dashboardName(dashboard.id) shouldBe Some("Grant dashboard")
    }

    "refuse a dashboard update from a viewer grantee on preview with exactly Forbidden" in {
      val (dashboard, _) = seedGrantedDashboard("viewer")
      await(previewService.preview(PatchSet(None, Vector(dashboardUpdate(dashboard.id.value))), grantee)) shouldBe Left(ServiceError.Forbidden())
    }
  }

  "patch-set panel edits (authorizeEditorOnDashboard)" should {

    "apply a panel delete from an editor grantee" in {
      val (_, panel) = seedGrantedDashboard("editor")
      val resp = applyAs(panelDelete(panel.id.value)).getOrElse(fail("expected an editor grantee's panel delete to be accepted"))
      resp.failure shouldBe None
      await(panelRepo.findByIdInternal(panel.id)) shouldBe None
    }

    "apply a panel create from an editor grantee" in {
      val (dashboard, _) = seedGrantedDashboard("editor")
      val resp = applyAs(panelCreate(dashboard.id.value)).getOrElse(fail("expected an editor grantee's panel create to be accepted"))
      resp.failure shouldBe None
      resp.edits.head.newId shouldBe defined
    }

    "refuse a panel update from a viewer grantee with exactly Forbidden, leaving the title unchanged" in {
      val (_, panel) = seedGrantedDashboard("viewer")
      applyAs(panelUpdate(panel.id.value)) shouldBe Left(ServiceError.Forbidden())
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Grant panel")
    }

    "refuse a panel delete from a viewer grantee with exactly Forbidden, leaving the panel in place" in {
      val (_, panel) = seedGrantedDashboard("viewer")
      applyAs(panelDelete(panel.id.value)) shouldBe Left(ServiceError.Forbidden())
      await(panelRepo.findByIdInternal(panel.id)) shouldBe defined
    }

    "refuse a panel create from a viewer grantee with exactly Forbidden, creating nothing" in {
      val (dashboard, _) = seedGrantedDashboard("viewer")
      applyAs(panelCreate(dashboard.id.value)) shouldBe Left(ServiceError.Forbidden())
      await(panelRepo.findAllByDashboardId(dashboard.id, Some(owner), Page.Default)).total shouldBe 1
    }
  }
}
