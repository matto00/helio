package com.helio.services.panels

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1295: an `"output"` panel whose `outputId` is nonexistent or owned by someone else is
 *  rejected on BOTH create and update, and nothing is written. Before the repository became a
 *  required `PanelService` parameter, a service built without one silently skipped this check
 *  (the sharpest of the `outputRepo = null` defaults); this spec pins the check with a REAL
 *  `OutputRepository` and real ownership (EmbeddedPostgres), and pins the construction-time
 *  `require` that replaces the old silent skip. */
class PanelServiceOutputBindingSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dashboardRepo: DashboardRepository   = _
  private var panelRepo: PanelRepository           = _
  private var outputRepo: OutputRepository         = _
  private var accessChecker: AccessChecker         = _
  private var panelService: PanelService           = _
  private var dashboardService: DashboardService   = _
  private var dataSourceService: DataSourceService = _
  private var pipelineService: PipelineService     = _

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
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",     id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value)))
    )
    accessChecker     = new AccessCheckerImpl(permissionRepo, registry)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dashboardService  = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("panel-output-binding-spec")))
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)

    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedDashboard(owner: AuthenticatedUser): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash")), owner))._1

  private def seedOutput(owner: AuthenticatedUser): Output = {
    val ds = await(dataSourceService.createStatic(
      StaticDataSourceRequest("Src", "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      owner
    )).fold(e => fail(s"seed source failed: $e"), identity)
    val pipeline = await(pipelineService.create(CreatePipelineRequest("P", Vector(CreatePipelineRootRequest(Some(ds.id.value)))), owner))
      .fold(e => fail(s"seed pipeline failed: $e"), identity)
    await(outputRepo.insertInternal(PipelineId(pipeline.id), None, owner.id, "Out", OutputKind.Table, explicitRootId = None))
  }

  private def outputPanelRequest(dashboardId: DashboardId, outputId: String): CreatePanelRequest =
    CreatePanelRequest(Some(dashboardId.value), None, Some("output"), Some(JsObject("outputId" -> JsString(outputId))))

  private def panelCount(dashboardId: DashboardId): Int =
    await(panelRepo.findAllByDashboardId(dashboardId, Some(userA), Page.Default)).items.size

  private val missingOutputId = () => UUID.randomUUID().toString

  "PanelService.create with an output panel" should {
    "reject a nonexistent outputId and write no panel" in {
      val dash   = seedDashboard(userA)
      val result = await(panelService.create(outputPanelRequest(dash.id, missingOutputId()), userA))
      result shouldBe Left(ServiceError.NotFound("Output not found"))
      panelCount(dash.id) shouldBe 0
    }

    "reject an Output owned by another user and write no panel" in {
      val dash     = seedDashboard(userA)
      val foreign  = seedOutput(userB)
      val result   = await(panelService.create(outputPanelRequest(dash.id, foreign.id.value), userA))
      result shouldBe Left(ServiceError.NotFound("Output not found"))
      panelCount(dash.id) shouldBe 0
    }

    "accept an Output the caller owns (control: the check is not just rejecting everything)" in {
      val dash = seedDashboard(userA)
      val own  = seedOutput(userA)
      val result = await(panelService.create(outputPanelRequest(dash.id, own.id.value), userA))
      result.isRight shouldBe true
      panelCount(dash.id) shouldBe 1
    }
  }

  "PanelService.update with an output panel" should {
    def boundPanel(): (Panel, Output) = {
      val dash = seedDashboard(userA)
      val own  = seedOutput(userA)
      val (panel, _) = await(panelService.create(outputPanelRequest(dash.id, own.id.value), userA))
        .fold(e => fail(s"seed panel failed: $e"), identity)
      (panel, own)
    }

    def rebind(panel: Panel, outputId: String): Either[ServiceError, Panel] =
      await(panelService.update(panel.id, UpdatePanelRequest(None, None, Some("output"), Some(JsObject("outputId" -> JsString(outputId)))), userA))

    def storedOutputId(panel: Panel): Option[OutputId] =
      await(panelRepo.findByIdInternal(panel.id)).collect { case p: OutputPanel => p.outputId }.flatten

    "reject rebinding to a nonexistent outputId and leave the binding untouched" in {
      val (panel, own) = boundPanel()
      rebind(panel, missingOutputId()) shouldBe Left(ServiceError.NotFound("Output not found"))
      storedOutputId(panel) shouldBe Some(own.id)
    }

    "reject rebinding to another user's Output and leave the binding untouched" in {
      val (panel, own) = boundPanel()
      val foreign      = seedOutput(userB)
      rebind(panel, foreign.id.value) shouldBe Left(ServiceError.NotFound("Output not found"))
      storedOutputId(panel) shouldBe Some(own.id)
    }
  }

  "A required OutputRepository (D2)" should {
    "make an explicit null fail at construction, not mid-request" in {
      val ex = intercept[IllegalArgumentException] {
        new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = null)
      }
      ex.getMessage should include("PanelService requires an OutputRepository")
    }

    "do the same for DashboardService" in {
      val ex = intercept[IllegalArgumentException] {
        new DashboardService(dashboardRepo, accessChecker, outputRepo = null)
      }
      ex.getMessage should include("DashboardService requires an OutputRepository")
    }
  }
}
