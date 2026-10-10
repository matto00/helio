package com.helio.api.routes.patchsets

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, UpdatePipelineRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService}
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1417: a patch-set `pipelineStep` create edit whose config `validateRawConfig` rejects fails at
 *  resolve time through the REAL `POST /patch-sets/apply` and `/patch-sets/preview` routes: 422
 *  `edit N: <msg>` (the shape a `pipelineStep` update edit returns), no earlier edit applied, no step created. */
class PatchSetStepCreateConfigRoutesSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceService: DataSourceService = _
  private var pipelineRepo: PipelineRepository     = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineService: PipelineService     = _
  private var applyService: PatchSetApplyService   = _
  private var previewService: PatchSetPreviewService = _

  private val userId = UUID.randomUUID().toString
  private val user   = AuthenticatedUser(UserId(userId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)

    val dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    val panelRepo      = new PanelRepository(ctx)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(routeEc)
    val outputRepo     = new OutputRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)

    dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-step-create-config-routes")))
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    applyService = new PatchSetApplyService(
      new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo),
      new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo),
      dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx)(routeEc), outputRepo
    )
    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo
    )

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"a-$userId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def routes: Route = new PatchSetRoutes(applyService, previewService, user)(typedSystem).routes

  private def seedPipeline(name: String): PipelineId = {
    val src = await(dataSourceService.createStatic(
      StaticDataSourceRequest("Source", "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))), user
    )).fold(e => fail(s"seed source failed: $e"), _.id)
    val created = await(pipelineService.create(CreatePipelineRequest(name, Vector(CreatePipelineRootRequest(Some(src.value)))), user))
      .fold(e => fail(s"seed pipeline failed: $e"), identity)
    PipelineId(created.id)
  }

  private def rename(id: PipelineId, to: String): Edit =
    Edit(EditTarget("pipeline", Some(id.value)), "update", None, None, None, Some(UpdatePipelineRequest(to)), None, None)

  private def stepCreate(id: PipelineId, kind: String, config: JsObject): Edit =
    Edit(EditTarget("pipelineStep", None, Some(id.value)), "create", None, None, None, None, None,
      Some(JsObject("type" -> JsString(kind), "config" -> config)))

  private def computeCfg(expr: String) = JsObject("column" -> JsString("c"), "expression" -> JsString(expr), "type" -> JsString("number"))

  private def pipelineName(id: PipelineId): String = await(pipelineRepo.findByIdInternal(id)).map(_.name).getOrElse("<gone>")
  private def stepCount(id: PipelineId): Int       = await(pipelineStepRepo.listByPipelineInternal(id)).size

  "a patch-set pipelineStep create edit with a rejected config" should {

    "be rejected on apply with 422 `edit 1: ...`, applying no earlier edit and creating no step" in {
      val id  = seedPipeline("Before")
      val bad = stepCreate(id, "compute", computeCfg("$a + nosuchfn($b)"))
      Post("/patch-sets/apply", PatchSet(None, Vector(rename(id, "After"), bad))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[String]
        msg should include("edit 1: ")
        msg should include("nosuchfn")
      }
      pipelineName(id) shouldBe "Before"
      stepCount(id) shouldBe 0
    }

    "be rejected on preview with 422 `edit 1: ...`" in {
      val id  = seedPipeline("PreviewBefore")
      val bad = stepCreate(id, "compute", computeCfg("$a + nosuchfn($b)"))
      Post("/patch-sets/preview", PatchSet(None, Vector(rename(id, "PreviewAfter"), bad))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[String]
        msg should include("edit 1: ")
        msg should include("nosuchfn")
      }
    }

    "still apply and preview when the config is valid" in {
      val id = seedPipeline("Valid")
      val ok = stepCreate(id, "compute", computeCfg("1 + 1"))
      Post("/patch-sets/preview", PatchSet(None, Vector(ok))) ~> routes ~> check { status shouldBe StatusCodes.OK }
      Post("/patch-sets/apply", PatchSet(None, Vector(ok))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should not include "\"failure\""
      }
      stepCount(id) shouldBe 1
    }
  }
}
