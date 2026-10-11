package com.helio.services.dashboards

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelBatchItem}
import com.helio.api.protocols.pipelines.{CreateOutputRequest, CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.proposals.{ProposalPanel, ReplaceDashboardContentsRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
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

/** HEL-1488 (follow-up of the HEL-1482 editor-grant audit): pins four service-level grant gates that no spec
 *  failed on when weakened: `PanelService.batchUpdate`, `DashboardContentsService.replaceContents`
 *  (`authorizeEditor`), `DashboardService.exportSnapshot` and `OutputService.create`. The rule at each: the
 *  owner or an `editor` grantee may act, a `viewer` grantee gets exactly `Left(ServiceError.Forbidden())`
 *  (the routes map it to 403). Accept cases observe the effect (re-read from the repository), not just
 *  `isRight`. Each test was shown red under a one-line mutation of the gate it guards (see the change's
 *  `mutation-evidence.md`). */
class EditorGrantCoverageSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres               = _
  private var db: JdbcBackend.Database                         = _
  private var dashboardRepo: DashboardRepository               = _
  private var panelRepo: PanelRepository                       = _
  private var outputRepo: OutputRepository                     = _
  private var dashboardService: DashboardService               = _
  private var panelService: PanelService                       = _
  private var contentsService: DashboardContentsService        = _
  private var dataSourceService: DataSourceService             = _
  private var pipelineService: PipelineService                 = _
  private var outputService: OutputService                     = _

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
    outputRepo    = new OutputRepository(ctx)
    val dataSourceRepo   = new DataSourceRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("editor-grant-coverage-spec"))

    dashboardService  = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    contentsService   = new DashboardContentsService(dashboardRepo, panelService, accessChecker, outputRepo = outputRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    outputService     = new OutputService(outputRepo, panelRepo, accessChecker)

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

  private def grant(resourceType: String, resourceId: String, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, ${granteeId}::uuid, $role, now())"""
    ))
  }

  /** A fresh owner-owned dashboard with one panel titled "Seed panel"; `role` (when given) granted to `grantee`. */
  private def seedDashboard(role: Option[String]): (Dashboard, Panel) = {
    val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Grant dashboard")), owner))._1
    val panel = await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), Some("Seed panel"), Some("divider"), None), owner)) match {
      case Right((p, _)) => p
      case Left(e)       => fail(s"seed panel failed: $e")
    }
    role.foreach(grant("dashboard", dashboard.id.value, _))
    (dashboard, panel)
  }

  private def panelTitle(id: PanelId): Option[String] = await(panelRepo.findByIdInternal(id)).map(_.title)

  "PanelService.batchUpdate" should {

    def batch(panel: Panel, title: String) = Vector(PanelBatchItem(panel.id.value, Some(title), None, None, None))

    "refuse a viewer grantee with exactly Forbidden, leaving the panel title unchanged" in {
      val (_, panel) = seedDashboard(Some("viewer"))
      await(panelService.batchUpdate(batch(panel, "Edited by viewer"), grantee)) shouldBe Left(ServiceError.Forbidden())
      panelTitle(panel.id) shouldBe Some("Seed panel")
    }

    "apply an editor grantee's batch update and change the panel title" in {
      val (_, panel) = seedDashboard(Some("editor"))
      val updated = await(panelService.batchUpdate(batch(panel, "Edited by editor"), grantee)).getOrElse(fail("expected an editor grantee's batch update to be accepted"))
      updated.map(_.title) shouldBe Vector("Edited by editor")
      panelTitle(panel.id) shouldBe Some("Edited by editor")
    }

    "apply the owner's batch update and change the panel title" in {
      val (_, panel) = seedDashboard(None)
      val updated = await(panelService.batchUpdate(batch(panel, "Edited by owner"), owner)).getOrElse(fail("expected the owner's batch update to be accepted"))
      updated.map(_.title) shouldBe Vector("Edited by owner")
      panelTitle(panel.id) shouldBe Some("Edited by owner")
    }
  }

  "DashboardContentsService.replaceContents" should {

    def replacement(title: String) = ReplaceDashboardContentsRequest(Vector(
      ProposalPanel(title, "markdown", None, None, None, Some("hello"), None, None, None, None, None, None, None, None, None, None, None)
    ))

    "refuse a viewer grantee with exactly Forbidden, leaving the dashboard's panels untouched" in {
      val (dashboard, panel) = seedDashboard(Some("viewer"))
      await(contentsService.replaceContents(dashboard.id, replacement("Replaced by viewer"), grantee)) shouldBe Left(ServiceError.Forbidden())
      panelTitle(panel.id) shouldBe Some("Seed panel")
    }

    "replace the contents for an editor grantee" in {
      val (dashboard, panel) = seedDashboard(Some("editor"))
      val (_, panels) = await(contentsService.replaceContents(dashboard.id, replacement("Replaced by editor"), grantee))
        .getOrElse(fail("expected an editor grantee's contents replace to be accepted"))
      panels.map(_.title) shouldBe Vector("Replaced by editor")
      panelTitle(panel.id) shouldBe None
    }

    "replace the contents for the owner" in {
      val (dashboard, panel) = seedDashboard(None)
      val (_, panels) = await(contentsService.replaceContents(dashboard.id, replacement("Replaced by owner"), owner))
        .getOrElse(fail("expected the owner's contents replace to be accepted"))
      panels.map(_.title) shouldBe Vector("Replaced by owner")
      panelTitle(panel.id) shouldBe None
    }
  }

  "DashboardService.exportSnapshot" should {

    "refuse a viewer grantee with exactly Forbidden" in {
      val (dashboard, _) = seedDashboard(Some("viewer"))
      await(dashboardService.exportSnapshot(dashboard.id, grantee)) shouldBe Left(ServiceError.Forbidden())
    }

    "export the dashboard and its panel for an editor grantee" in {
      val (dashboard, _) = seedDashboard(Some("editor"))
      val payload = await(dashboardService.exportSnapshot(dashboard.id, grantee)).getOrElse(fail("expected an editor grantee's export to be accepted"))
      payload.dashboard.name shouldBe "Grant dashboard"
      payload.panels should have size 1
    }

    "export the dashboard and its panel for the owner" in {
      val (dashboard, _) = seedDashboard(None)
      val payload = await(dashboardService.exportSnapshot(dashboard.id, owner)).getOrElse(fail("expected the owner's export to be accepted"))
      payload.dashboard.name shouldBe "Grant dashboard"
      payload.panels should have size 1
    }
  }

  "OutputService.create" should {

    def seedPipeline(role: Option[String]): PipelineId = {
      val source = await(dataSourceService.createStatic(
        StaticDataSourceRequest("Grant source", "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
        owner
      )).getOrElse(fail("seed source failed"))
      val pipeline = await(pipelineService.create(CreatePipelineRequest("Grant pipeline", Vector(CreatePipelineRootRequest(Some(source.id.value)))), owner))
        .getOrElse(fail("seed pipeline failed"))
      role.foreach(grant("pipeline", pipeline.id, _))
      PipelineId(pipeline.id)
    }

    val request = CreateOutputRequest(None, "table", "Granted output", None)

    "refuse a viewer grantee with exactly Forbidden, inserting no Output" in {
      val pid = seedPipeline(Some("viewer"))
      await(outputService.create(pid, request, grantee)) shouldBe Left(ServiceError.Forbidden())
      await(outputRepo.listByPipelineInternal(pid)) shouldBe empty
    }

    "create the Output for an editor grantee" in {
      val pid = seedPipeline(Some("editor"))
      val (output, _) = await(outputService.create(pid, request, grantee)).getOrElse(fail("expected an editor grantee's Output create to be accepted"))
      output.name shouldBe "Granted output"
      await(outputRepo.listByPipelineInternal(pid)).map(_.id) shouldBe Vector(output.id)
    }

    "create the Output for the owner" in {
      val pid = seedPipeline(None)
      val (output, _) = await(outputService.create(pid, request, owner)).getOrElse(fail("expected the owner's Output create to be accepted"))
      output.name shouldBe "Granted output"
      await(outputRepo.listByPipelineInternal(pid)).map(_.id) shouldBe Vector(output.id)
    }
  }
}
