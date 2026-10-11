package com.helio.api.routes.patchsets

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, UpdatePipelineStepRequest}
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
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import com.helio.testkit.WindowRollingRejectionCases.{invalid, valid}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
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

/** HEL-1489: an invalid rolling-frame `window` config is rejected 422 at resolve time through the REAL
 *  `POST /patch-sets/apply` route, for each step-bearing edit kind (pipelineStep create, pipelineStep update,
 *  pipeline create), with the exact frame message, the route's own `edit N: ` prefix, and nothing stored or
 *  changed. A valid rolling config is accepted on each (no `failure`: a failed edit still answers 200). */
class PatchSetWindowRollingRejectionRoutesSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceService: DataSourceService     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineService: PipelineService         = _
  private var applyService: PatchSetApplyService       = _
  private var previewService: PatchSetPreviewService   = _

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

    dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-window-rolling-routes")))
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

  private def seedSource(): DataSourceId =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest("Source", "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))), user
    )).fold(e => fail(s"seed source failed: $e"), _.id)

  private def seedPipeline(name: String): PipelineId = {
    val created = await(pipelineService.create(CreatePipelineRequest(name, Vector(CreatePipelineRootRequest(Some(seedSource().value)))), user))
      .fold(e => fail(s"seed pipeline failed: $e"), identity)
    PipelineId(created.id)
  }

  private def seedWindowStep(id: PipelineId): String =
    await(pipelineService.addStep(id, CreatePipelineStepRequest("window", valid), user))
      .fold(e => fail(s"seed window step failed: $e"), _.id)

  private def stepCreate(id: PipelineId, config: JsObject): Edit =
    Edit(EditTarget("pipelineStep", None, Some(id.value)), "create", None, None, None, None, None,
      Some(JsObject("type" -> JsString("window"), "config" -> config)))

  private def stepUpdate(id: PipelineId, stepId: String, config: JsObject): Edit =
    Edit(EditTarget("pipelineStep", Some(stepId)), "update", None, None, None, None,
      Some(UpdatePipelineStepRequest(None, Some(config), None)), None)

  private def pipelineCreate(name: String, source: DataSourceId, config: JsObject): Edit =
    Edit(EditTarget("pipeline", None), "create", None, None, None, None, None,
      Some(JsObject(
        "name"  -> JsString(name),
        "roots" -> JsArray(JsObject("sourceId" -> JsString(source.value))),
        "steps" -> JsArray(JsObject("clientId" -> JsString("w1"), "type" -> JsString("window"), "config" -> config))
      )))

  private def stepState(id: PipelineId): Vector[String] = await(pipelineStepRepo.listByPipelineInternal(id)).map(_.toString)
  private def pipelineNamed(name: String): Boolean =
    await(pipelineRepo.listSummaries(user)).exists(_.name == name)

  "POST /patch-sets/apply with a pipelineStep create edit" should {
    invalid.foreach { c =>
      s"reject ${c.label} with 422 `edit 0: <frame message>` and create no step" in {
        val id = seedPipeline(s"Create-${UUID.randomUUID()}")
        Post("/patch-sets/apply", PatchSet(None, Vector(stepCreate(id, c.config)))) ~> routes ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val msg = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]
          msg should startWith("edit 0: ")
          msg should include(c.message)
        }
        stepState(id) shouldBe empty
      }
    }

    "accept a valid rolling config and store the step" in {
      val id = seedPipeline(s"CreateOk-${UUID.randomUUID()}")
      Post("/patch-sets/apply", PatchSet(None, Vector(stepCreate(id, valid)))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should not include "\"failure\""
      }
      stepState(id) should have size 1
    }
  }

  "POST /patch-sets/apply with a pipelineStep update edit" should {
    invalid.foreach { c =>
      s"reject ${c.label} with 422 `edit 0: <frame message>` and leave the step unchanged" in {
        val id     = seedPipeline(s"Update-${UUID.randomUUID()}")
        val stepId = seedWindowStep(id)
        val before = stepState(id)
        Post("/patch-sets/apply", PatchSet(None, Vector(stepUpdate(id, stepId, c.config)))) ~> routes ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val msg = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]
          msg should startWith("edit 0: ")
          msg should include(c.message)
        }
        stepState(id) shouldBe before
      }
    }

    "accept a valid rolling config" in {
      val id     = seedPipeline(s"UpdateOk-${UUID.randomUUID()}")
      val stepId = seedWindowStep(id)
      val next   = JsObject(valid.fields + ("frameSize" -> JsNumber(5)))
      Post("/patch-sets/apply", PatchSet(None, Vector(stepUpdate(id, stepId, next)))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should not include "\"failure\""
      }
    }
  }

  "POST /patch-sets/apply with a pipeline create edit carrying a window step" should {
    invalid.foreach { c =>
      s"reject ${c.label} with 422 `edit 0: Step 'w1': <frame message>` and create no pipeline" in {
        val source = seedSource()
        val name   = s"PipelineCreate-${UUID.randomUUID()}"
        Post("/patch-sets/apply", PatchSet(None, Vector(pipelineCreate(name, source, c.config)))) ~> routes ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val msg = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]
          msg should startWith("edit 0: Step 'w1': ")
          msg should include(c.message)
        }
        pipelineNamed(name) shouldBe false
      }
    }

    "accept a valid rolling config and create the pipeline" in {
      val name = s"PipelineCreateOk-${UUID.randomUUID()}"
      Post("/patch-sets/apply", PatchSet(None, Vector(pipelineCreate(name, seedSource(), valid)))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should not include "\"failure\""
      }
      pipelineNamed(name) shouldBe true
    }
  }
}
