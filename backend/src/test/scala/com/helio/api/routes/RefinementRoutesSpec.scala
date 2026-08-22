package com.helio.api.routes

import com.helio.api.routes.patchsets.RefinementRoutes
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.ai.{ClaudeApiContentBlock, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeStreamEvent, ClaudeTransport}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.JsonProtocols
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.domain.model._
import com.helio.services.dashboards.DashboardService
import com.helio.services.sources.DataSourceService
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.panels.{PanelCapabilityService, PanelService}
import com.helio.services.patchsets.{PatchSetPreviewService, RefinementGrounding, RefinementService}
import com.helio.services.workspace.WorkspaceContextService
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.scaladsl.Source
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}
import scala.jdk.CollectionConverters._

/** HTTP-shell coverage for `POST /api/refinements` (HEL-411 tasks.md 5.3) — a `None` service
 *  (missing `ANTHROPIC_API_KEY`/`DbContext`) degrades to a clean `503`, not a route-registration
 *  failure (mirrors `DashboardAuthoringRoutesSpec`'s identical precedent). Business-logic depth
 *  (grounding, repair round-trips, D3a cross-flow rejection) is `RefinementServiceSpec`'s job; this
 *  spec only exercises the HTTP layer. */
class RefinementRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private var refinementGrounding: RefinementGrounding             = _
  private var patchSetPreviewService: PatchSetPreviewService       = _
  private var conversationRepo: AuthoringConversationRepository    = _

  private val userId = UUID.randomUUID().toString
  private val user   = AuthenticatedUser(UserId(userId))
  private var dashboardId: String = _
  private var panelId: String     = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dashboardRepo    = new DashboardRepository(ctx)
    val panelRepo         = new PanelRepository(ctx)
    val dataSourceRepo    = new DataSourceRepository(ctx)
    val dataTypeRepo      = new DataTypeRepository(ctx)
    val dataTypeRowRepo   = new DataTypeRowRepository(ctx)
    val pipelineRepo      = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    val pipelineStepRepo  = new PipelineStepRepository(ctx)
    val metricRepo        = new MetricRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",     id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo = new ResourcePermissionRepository(ctx)
    val accessChecker   = new AccessCheckerImpl(permissionRepo, registry)
    val tmpDir = Files.createTempDirectory("helio-refinement-routes-spec")
    val fs     = new LocalFileSystem(tmpDir)

    val dashboardService = new DashboardService(dashboardRepo, accessChecker)
    val panelService      = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
    val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val pipelineService    = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    val workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)
    val panelCapabilityService  = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
    patchSetPreviewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo, metricRepo, accessChecker
    )
    refinementGrounding = new RefinementGrounding(dashboardRepo, panelRepo, pipelineService, workspaceContextService, panelCapabilityService)
    conversationRepo    = new AuthoringConversationRepository(ctx)

    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"$userId@test.local"}, now())"""))
    val dash  = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash")), user))._1
    val panel = await(panelService.create(CreatePanelRequest(Some(dash.id.value), Some("Panel"), Some("metric"), None), user)) match {
      case Right(p) => p
      case Left(e)  => fail(s"panel seed failed: $e")
    }
    dashboardId = dash.id.value
    panelId     = panel.id.value
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def cannedResponse(text: String): Future[ClaudeApiResponse] =
    Future.successful(ClaudeApiResponse(
      id         = "msg_test",
      content    = Seq(ClaudeApiContentBlock("text", Some(text))),
      stopReason = Some("end_turn"),
      usage      = ClaudeApiUsage(10, 10)
    ))

  private class FakeClaudeTransport(sendResponses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
    val sendInvocations = new AtomicInteger(0)
    private val recordedRequests = new CopyOnWriteArrayList[ClaudeApiRequest]()
    def sendRequests: Vector[ClaudeApiRequest] = recordedRequests.asScala.toVector

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      recordedRequests.add(request)
      sendResponses(sendInvocations.getAndIncrement())
    }
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("RefinementService never streams")
  }

  private def serviceWith(transport: ClaudeTransport): RefinementService = {
    val claudeConfig = ClaudeConfig(apiKey = "sk-ant-test", model = "claude-test", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)
    new RefinementService(refinementGrounding, patchSetPreviewService, new ClaudeClient(claudeConfig, transport)(routeEc), conversationRepo)(routeEc)
  }

  private def routesFor(serviceOpt: Option[RefinementService]): Route =
    new RefinementRoutes(serviceOpt, user)(routeEc).routes

  private def jsonEntity(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private def requestBody(message: String, conversationId: Option[String] = None): String = {
    val convField = conversationId.map(id => s""","conversationId":"$id"""").getOrElse("")
    s"""{"target":{"kind":"dashboard","id":"$dashboardId"},"message":"$message"$convField}"""
  }

  private def patchSetJson(title: String, summary: String = "Rename panel"): String =
    s"""{"summary":"$summary","edits":[{"target":{"kind":"panel","id":"$panelId"},"op":"update","patch":{"title":"$title"}}]}"""

  "POST /api/refinements" should {

    "return 200 with a PatchSet + conversationId for a well-wired buffered call" in {
      val service = serviceWith(new FakeClaudeTransport(Vector(cannedResponse(patchSetJson("New title")))))

      Post("/refinements", jsonEntity(requestBody("rename the panel"))) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should contain allOf ("patchSet", "conversationId")
        obj.fields("patchSet").asJsObject.fields.keySet should contain("edits")
      }
    }

    "degrade to a clean 503 when the service is unavailable (missing ANTHROPIC_API_KEY/DbContext), not a route-registration failure" in {
      Post("/refinements", jsonEntity(requestBody("rename the panel"))) ~> routesFor(None) ~> check {
        status shouldBe StatusCodes.ServiceUnavailable
      }
    }

    "a second call with conversationId continues the SAME conversation" in {
      val service = serviceWith(new FakeClaudeTransport(Vector(
        cannedResponse(patchSetJson("First title")),
        cannedResponse(patchSetJson("Second title"))
      )))

      var conversationId: String = ""
      Post("/refinements", jsonEntity(requestBody("rename it"))) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        conversationId = responseAs[String].parseJson.asJsObject.fields("conversationId").convertTo[String]
      }
      conversationId should not be empty

      Post("/refinements", jsonEntity(requestBody("rename it again", Some(conversationId)))) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("conversationId").convertTo[String] shouldBe conversationId
      }
    }

    "return 404 for a target dashboard id that doesn't exist" in {
      val service = serviceWith(new FakeClaudeTransport(Vector.empty))
      val body = s"""{"target":{"kind":"dashboard","id":"${UUID.randomUUID().toString}"},"message":"do something"}"""

      Post("/refinements", jsonEntity(body)) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
