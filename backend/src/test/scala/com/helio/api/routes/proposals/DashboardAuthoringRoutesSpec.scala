package com.helio.api.routes.proposals

import com.helio.api.routes.proposals.DashboardAuthoringRoutes
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.ai.{ClaudeApiContentBlock, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeStreamEvent, ClaudeTransport}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.JsonProtocols
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.services.proposals.{DashboardAuthoringService, DashboardProposalService}
import com.helio.services.sources.DataSourceService
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelCapabilityService
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
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}

/** HTTP-shell coverage for `POST /api/authoring/dashboard` (HEL-392 tasks.md 5.4) — the buffered
 *  and `?stream=true` paths are both wired correctly, and a `None` service (missing
 *  `ANTHROPIC_API_KEY`) degrades to a clean `503`, not a route-registration failure (the path still
 *  resolves — see `DashboardAuthoringRoutes`'s own `serviceOpt.fold` gate). Business-logic depth
 *  (repair round-trips, empty-workspace, binding rejection) is `DashboardAuthoringServiceSpec`'s
 *  job; this spec only exercises the HTTP layer. */
class DashboardAuthoringRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  // HEL-401 design.md D3: widened from `ExecutionContext` — `DashboardAuthoringService`/
  // `DashboardAuthoringRoutes` both now take `ExecutionContextExecutor` so telemetry can build a
  // `MdcPropagatingExecutionContext`; `ActorSystem[_].executionContext` already IS one at runtime.
  private def routeEc: ExecutionContextExecutor           = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataTypeRepo: DataTypeRepository   = _
  private var outputRepo: OutputRepository       = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var pipelineRepo: PipelineRepository   = _
  private var dataSourceRepo: DataSourceRepository = _

  private var workspaceContextService: WorkspaceContextService   = _
  private var panelCapabilityService: PanelCapabilityService     = _
  private var dashboardProposalService: DashboardProposalService = _
  // HEL-397: DashboardAuthoringService now unconditionally persists a conversation row on every
  // successful turn — a real repository over the same embedded Postgres, not a mock.
  private var conversationRepo: AuthoringConversationRepository  = _

  private val userId = UUID.randomUUID().toString
  private val user   = AuthenticatedUser(UserId(userId))
  private var pipelineOutputType: DataType = _

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

    dataSourceRepo       = new DataSourceRepository(ctx)
    dataTypeRepo         = new DataTypeRepository(ctx)
    val dataTypeRowRepo  = new DataTypeRowRepository(ctx)
    pipelineRepo         = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-authoring-routes-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    // HEL-904 task 3.12: WorkspaceContextService takes OutputRepository now (dataTypeService dropped from that constructor).
    outputRepo            = new OutputRepository(ctx)
    nodeSnapshotRepo      = new NodeSnapshotRepository(ctx)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    val registry        = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val accessChecker    = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    workspaceContextService  = new WorkspaceContextService(dashboardService, dataSourceService, outputRepo, pipelineService)
    panelCapabilityService   = new PanelCapabilityService(outputRepo, nodeSnapshotRepo)
    dashboardProposalService = new DashboardProposalService(null, null, dataTypeRepo, null, outputRepo)
    conversationRepo         = new AuthoringConversationRepository(ctx)

    // Seeded ONCE (not per-test) — `user` is a single shared fixture id for this whole spec, so a
    // per-test insert would violate the `users` primary key on the second test.
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"$userId@test.local"}, now())"""))
    val now = Instant.now()
    // HEL-904 task 3.12: `DashboardAuthoringService.assembleGroundedContext`'s "empty workspace"
    // check now filters `WorkspaceContextService.assemble`'s Output-backed `dataTypes` -- a real
    // pipeline + Output is required for this fixture's workspace to read as non-empty. The
    // vestigial `DataType` below is kept ONLY so `pipelineOutputType.id.value` (used to bind an
    // "output"-kind proposal panel's `dataTypeId` field, task 3.9's Output-id semantics) keeps
    // resolving -- its id is deliberately set to the SAME string as the real Output's id, not a
    // fresh/unrelated one; it is never inserted into `data_types` itself.
    val sourceReq = StaticDataSourceRequest(
      name    = s"src-${UUID.randomUUID()}",
      `type`  = "static",
      columns = Vector(StaticColumnPayload("value", "string")),
      rows    = Vector(Vector(JsString("x"))),
      tag     = None
    )
    val source = await(dataSourceService.createStatic(sourceReq, user)) match {
      case Right(ds) => ds
      case Left(err) => fail(s"createStatic failed: $err")
    }
    val summary = await(pipelineRepo.create(s"pipe-${UUID.randomUUID()}", source.id, user)) match {
      case Right(s)  => s
      case Left(err) => fail(s"pipeline create failed: $err")
    }
    val createdOutput = await(outputRepo.insertInternal(
      PipelineId(summary.id), nodeStepId = None, user.id, "Sales", OutputKind.Table,
      schema = Vector(SchemaField("revenue", "float"))
    ))
    val dt = DataType(
      id        = DataTypeId(createdOutput.id.value),
      sourceId  = None,
      name      = "Sales",
      fields    = Vector(DataField("revenue", "Revenue", "float", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = user.id
    )
    pipelineOutputType = dt
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

  private class FakeClaudeTransport(sendResponse: Future[ClaudeApiResponse], streamEvents: Seq[ClaudeStreamEvent] = Seq.empty) extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = sendResponse
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = Source(streamEvents.toList)
  }

  private def serviceWith(transport: ClaudeTransport): DashboardAuthoringService = {
    val claudeConfig = ClaudeConfig(apiKey = "sk-ant-test", model = "claude-test", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)
    new DashboardAuthoringService(workspaceContextService, panelCapabilityService, dashboardProposalService, new ClaudeClient(claudeConfig, transport)(routeEc), conversationRepo)(routeEc)
  }

  private def routesFor(serviceOpt: Option[DashboardAuthoringService]): Route =
    new DashboardAuthoringRoutes(serviceOpt, user)(routeEc).routes

  private def jsonEntity(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private val requestBody = """{"goal":"Show total revenue"}"""

  "POST /api/authoring/dashboard" should {

    "return 200 with a proposal for a well-wired buffered call" in {
      val validJson =
        s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"output","dataTypeId":"${pipelineOutputType.id.value}","fieldMapping":{"value":"revenue"}}]}"""
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(validJson)))

      Post("/authoring/dashboard", jsonEntity(requestBody)) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should contain allOf ("proposal", "warnings")
      }
    }

    "return a text/event-stream response for ?stream=true, wired correctly" in {
      // The streamed JSON below has zero panels — structurally valid (no repair needed), so the
      // canned `send` response is never invoked; this test proves the SSE wiring itself, not the
      // repair round-trip (already covered by DashboardAuthoringServiceSpec).
      val events = Seq(
        ClaudeStreamEvent.TextDelta("""{"dashboardName":"Sales","panels":[]}"""),
        ClaudeStreamEvent.MessageStop
      )
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(""), events))

      Post("/authoring/dashboard?stream=true", jsonEntity(requestBody)) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        contentType.mediaType.mainType shouldBe "text"
        contentType.mediaType.subType shouldBe "event-stream"
        responseAs[String] should include("event:")
      }
    }

    "degrade to a clean 503 when the service is unavailable (missing ANTHROPIC_API_KEY), not a route-registration failure" in {
      Post("/authoring/dashboard", jsonEntity(requestBody)) ~> routesFor(None) ~> check {
        status shouldBe StatusCodes.ServiceUnavailable
      }
    }

    "the response body carries an additive conversationId alongside proposal/warnings" in {
      val validJson =
        s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"output","dataTypeId":"${pipelineOutputType.id.value}","fieldMapping":{"value":"revenue"}}]}"""
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(validJson)))

      Post("/authoring/dashboard", jsonEntity(requestBody)) ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should contain allOf ("proposal", "warnings", "conversationId")
      }
    }
  }


  "GET /api/authoring/conversations/:id" should {

    "return 200 with the display-only view for a conversation the caller owns" in {
      val validJson =
        s"""{"dashboardName":"Sales","panels":[{"title":"Total","type":"output","dataTypeId":"${pipelineOutputType.id.value}","fieldMapping":{"value":"revenue"}}]}"""
      val service = serviceWith(new FakeClaudeTransport(cannedResponse(validJson)))

      var conversationId: String = ""
      Post("/authoring/dashboard", jsonEntity(requestBody)) ~> routesFor(Some(service)) ~> check {
        conversationId = responseAs[String].parseJson.asJsObject.fields("conversationId").convertTo[String]
      }

      Get(s"/authoring/conversations/$conversationId") ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should contain allOf ("conversationId", "displayTurns")
        obj.fields.keySet should not contain "apiHistory"
      }
    }

    "return 404 for an unknown conversation id" in {
      val service = serviceWith(new FakeClaudeTransport(cannedResponse("{}")))

      Get(s"/authoring/conversations/${UUID.randomUUID().toString}") ~> routesFor(Some(service)) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "degrade to a clean 503 when the service is unavailable, not a route-registration failure" in {
      Get(s"/authoring/conversations/${UUID.randomUUID().toString}") ~> routesFor(None) ~> check {
        status shouldBe StatusCodes.ServiceUnavailable
      }
    }
  }
}
