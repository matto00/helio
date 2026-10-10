package com.helio.api.routes.proposals

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.assistant.TierErrorResponse
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.engine.SchemaField
import com.helio.api.routes.assistant.AssistantConversationRoutes
import com.helio.api.routes.patchsets.RefinementRoutes
import com.helio.domain.model._
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.assistant.{AssistantConversationRepository, AssistantDailyUsageRepository}
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.assistant.{AssistantConversationService, AssistantService}
import com.helio.services.auth.{ChatAccessService, UserTierConfig}
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{PanelCapabilityService, PanelService}
import com.helio.services.patchsets.{PatchSetPreviewService, RefinementGrounding, RefinementService}
import com.helio.services.pipelines.PipelineService
import com.helio.services.proposals.{DashboardAuthoringService, DashboardProposalService}
import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.WorkspaceContextService
import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.scaladsl.Source
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future}

/** HEL-1205 — `POST /api/authoring/dashboard` (buffered + stream) and `POST /api/refinements` are
 *  gated through the SAME [[ChatAccessService]] the workspace assistant uses: free -> 403
 *  TIER_FORBIDDEN, beta -> counted against the shared `assistant_daily_usage` row -> 429
 *  CHAT_LIMIT_REACHED, owner unlimited. Every Claude call here goes to a stub transport
 *  ([[CountingTransport]]) that counts invocations; no real Anthropic call is ever made. */
class ClaudeRoutesChatGateSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor          = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var userRepo: UserRepository           = _
  private var usageRepo: AssistantDailyUsageRepository = _
  private var dashboardService: DashboardService = _
  private var panelService: PanelService         = _
  private var dataSourceService: DataSourceService = _
  private var pipelineRepo: PipelineRepository     = _
  private var outputRepo: OutputRepository         = _
  private var conversationService: AssistantConversationService = _
  private var authoringService: (ClaudeClient) => DashboardAuthoringService = _
  private var refinementService: (ClaudeClient) => RefinementService        = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    implicit val ec: ExecutionContext = routeEc
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dashboardRepo    = new DashboardRepository(ctx)
    val panelRepo        = new PanelRepository(ctx)
    val dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineRepo         = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    outputRepo           = new OutputRepository(ctx)
    val nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel", id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker     = new AccessCheckerImpl(new ResourcePermissionRepository(ctx), registry)
    val fs                = new LocalFileSystem(newTempDir("helio-claude-routes-gate-spec"))
    dashboardService      = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService          = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dataSourceService     = new DataSourceService(dataSourceRepo, fs)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)

    val workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, outputRepo, pipelineService)
    val panelCapabilityService  = new PanelCapabilityService(outputRepo, nodeSnapshotRepo)
    val proposalService         = new DashboardProposalService(null, null, outputRepo)
    val previewService = new PatchSetPreviewService(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo)
    val grounding = new RefinementGrounding(dashboardRepo, panelRepo, pipelineService, workspaceContextService, panelCapabilityService)
    val authoringConvRepo = new AuthoringConversationRepository(ctx)
    authoringService  = client => new DashboardAuthoringService(workspaceContextService, panelCapabilityService, proposalService, client, authoringConvRepo)(routeEc)
    refinementService = client => new RefinementService(grounding, previewService, client, authoringConvRepo)(routeEc)

    userRepo            = new UserRepository(db)(routeEc)
    usageRepo           = new AssistantDailyUsageRepository(ctx)(routeEc)
    conversationService = new AssistantConversationService(new AssistantConversationRepository(ctx), fs)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  // -- stub transport: counts every call on every entry point, never touches the network ---------

  private def textResponse(text: String): ClaudeApiResponse =
    ClaudeApiResponse("msg_test", Seq(ClaudeApiContentBlock("text", Some(text))), Some("end_turn"), ClaudeApiUsage(1, 1))

  private class CountingTransport(sendText: String) extends ClaudeTransport {
    val calls = new AtomicInteger(0)
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      calls.incrementAndGet(); Future.successful(textResponse(sendText))
    }
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
      calls.incrementAndGet()
      Source(List(ClaudeStreamEvent.TextDelta("""{"dashboardName":"S","panels":[]}"""), ClaudeStreamEvent.MessageStop))
    }
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      calls.incrementAndGet(); Future.successful(textResponse("hi"))
    }
  }

  private def client(t: ClaudeTransport): ClaudeClient =
    new ClaudeClient(ClaudeConfig("sk-ant-stub-never-used", "claude-test", 1.0, 4096, 100000), t)(routeEc)

  private val authoringJson = """{"dashboardName":"S","panels":[]}"""

  private case class Fixture(user: AuthenticatedUser, dashboardId: String, panelId: String)

  private def newUser(tier: String): Fixture = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, ${s"$id@test.local"}, now(), $tier)"""))
    val user = AuthenticatedUser(UserId(id))
    val dash = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash")), user))._1
    val panel = await(panelService.create(CreatePanelRequest(Some(dash.id.value), Some("P"), Some("divider"), None), user)) match {
      case Right((p, _)) => p
      case Left(e)       => fail(s"panel seed failed: $e")
    }
    // A real source -> pipeline -> Output so the authoring service's empty-workspace check passes and
    // the stub transport is actually reached (an empty workspace 422s before any model call).
    val source = await(dataSourceService.createStatic(
      StaticDataSourceRequest(s"src-${UUID.randomUUID()}", "static", Vector(StaticColumnPayload("value", "string")), Vector(Vector(JsString("x"))), None), user)) match {
      case Right(ds) => ds
      case Left(e)   => fail(s"source seed failed: $e")
    }
    val pipe = await(pipelineRepo.create(s"pipe-${UUID.randomUUID()}", Vector(source.id), user)) match {
      case Right(p) => p
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }
    await(outputRepo.insertInternal(PipelineId(pipe.id), nodeStepId = None, user.id, "Sales", OutputKind.Table,
      schema = Vector(SchemaField("revenue", "float")), explicitRootId = None))
    Fixture(user, dash.id.value, panel.id.value)
  }

  private def refineJson(panelId: String) =
    s"""{"summary":"r","edits":[{"target":{"kind":"panel","id":"$panelId"},"op":"update","patch":{"title":"T"}}]}"""

  private def jsonEntity(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)
  private def limited(limit: Int): UserTierConfig          = UserTierConfig(Set.empty, limit)
  private def chat(limit: Int): ChatAccessService          = new ChatAccessService(userRepo, usageRepo, limited(limit))

  /** All three Claude-reaching route families for one user over ONE shared stub transport and ONE
   *  shared [[ChatAccessService]] (so cap sharing is observable). `chatOpt = None` models a missing gate. */
  private def routes(f: Fixture, t: CountingTransport, chatOpt: Option[ChatAccessService], converseChat: ChatAccessService): Route = {
    val c = client(t)
    concat(
      new DashboardAuthoringRoutes(Some(authoringService(c)), f.user, chatOpt)(routeEc).routes,
      new RefinementRoutes(Some(refinementService(c)), f.user, chatOpt)(routeEc).routes,
      new AssistantConversationRoutes(conversationService, Some(new AssistantService(c, null, null, null, null, null, null, null)(routeEc)), converseChat, f.user).routes
    )
  }

  private def usage(f: Fixture): Option[Int] = {
    val today = LocalDate.now(ZoneOffset.UTC).toString
    await(db.run(sql"""SELECT message_count FROM assistant_daily_usage WHERE user_id = ${f.user.id.value}::uuid AND usage_date = $today::date""".as[Int].headOption))
  }

  private val goal = """{"goal":"Show revenue"}"""
  private def refineBody(f: Fixture) = s"""{"target":{"kind":"dashboard","id":"${f.dashboardId}"},"message":"rename"}"""

  private def expectTier(code: String, st: StatusCode, limit: Option[Int]): Unit = {
    status shouldBe st
    val body = responseAs[String].parseJson.convertTo[TierErrorResponse]
    body.code shouldBe code
    body.limit shouldBe limit
  }

  "free tier" should {
    "get 403 TIER_FORBIDDEN on buffered authoring, with zero transport calls" in {
      val f = newUser("free"); val t = new CountingTransport(authoringJson)
      Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(chat(5)), chat(5)) ~> check { expectTier("TIER_FORBIDDEN", StatusCodes.Forbidden, None) }
      t.calls.get shouldBe 0
    }
    "get 403 on streaming authoring, with zero transport calls" in {
      val f = newUser("free"); val t = new CountingTransport(authoringJson)
      Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> routes(f, t, Some(chat(5)), chat(5)) ~> check { expectTier("TIER_FORBIDDEN", StatusCodes.Forbidden, None) }
      t.calls.get shouldBe 0
    }
    "get 403 on refinements, with zero transport calls" in {
      val f = newUser("free"); val t = new CountingTransport(refineJson(f.panelId))
      Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t, Some(chat(5)), chat(5)) ~> check { expectTier("TIER_FORBIDDEN", StatusCodes.Forbidden, None) }
      t.calls.get shouldBe 0
    }
  }

  "beta tier" should {
    "be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes" in {
      val f = newUser("beta"); val t = new CountingTransport(authoringJson); val c = chat(2)
      Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      usage(f) shouldBe Some(2)
      val before = t.calls.get
      Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(2)) }
      Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(2)) }
      t.calls.get shouldBe before
      usage(f) shouldBe Some(2)
    }
    "have a refinement call counted (limit 1 then 429)" in {
      val f = newUser("beta"); val t = new CountingTransport(refineJson(f.panelId)); val c = chat(1)
      Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      usage(f) shouldBe Some(1)
      Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(1)) }
    }
    "share the cap with assistant converse in both directions" in {
      // routes exhaust converse
      val f1 = newUser("beta"); val t1 = new CountingTransport(authoringJson); val c1 = chat(1)
      Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f1, t1, Some(c1), c1) ~> check { status shouldBe StatusCodes.OK }
      val conv1 = await(conversationService.create(f1.user, None, title = None))
      Post(s"/assistant-conversations/${conv1.record.id.value}/converse", jsonEntity("""{"message":"hi"}""")) ~> routes(f1, t1, Some(c1), c1) ~> check {
        expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(1))
      }
      // converse exhausts routes
      val f2 = newUser("beta"); val t2 = new CountingTransport(authoringJson); val c2 = chat(1)
      val conv2 = await(conversationService.create(f2.user, None, title = None))
      Post(s"/assistant-conversations/${conv2.record.id.value}/converse", jsonEntity("""{"message":"hi"}""")) ~> routes(f2, t2, Some(c2), c2) ~> check { status shouldBe StatusCodes.OK }
      Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f2, t2, Some(c2), c2) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(1)) }
      Post("/refinements", jsonEntity(refineBody(f2))) ~> routes(f2, t2, Some(c2), c2) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(1)) }
    }
    "not charge a replayed converse idempotency key" in {
      val f = newUser("beta"); val t = new CountingTransport(authoringJson); val c = chat(2)
      val conv = await(conversationService.create(f.user, None, title = None))
      val body = """{"message":"hi","idempotencyKey":"key-1"}"""
      Post(s"/assistant-conversations/${conv.record.id.value}/converse", jsonEntity(body)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      usage(f) shouldBe Some(1)
      Post(s"/assistant-conversations/${conv.record.id.value}/converse", jsonEntity(body)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      usage(f) shouldBe Some(1)
    }
  }

  "owner tier" should {
    "never be counted or capped on either route" in {
      val f = newUser("owner"); val t = new CountingTransport(authoringJson); val c = chat(0)
      Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      val t2 = new CountingTransport(refineJson(f.panelId))
      Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t2, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
      usage(f) shouldBe None
    }
  }

  "a missing service or malformed body" should {
    "503 without charging a beta user when the service is unavailable" in {
      val f = newUser("beta"); val c = chat(5)
      val r = concat(
        new DashboardAuthoringRoutes(None, f.user, Some(c))(routeEc).routes,
        new RefinementRoutes(None, f.user, Some(c))(routeEc).routes
      )
      Post("/authoring/dashboard", jsonEntity(goal)) ~> r ~> check { status shouldBe StatusCodes.ServiceUnavailable }
      Post("/refinements", jsonEntity(refineBody(f))) ~> r ~> check { status shouldBe StatusCodes.ServiceUnavailable }
      usage(f) shouldBe None
    }
    "400 without charging on a malformed body" in {
      val f = newUser("beta"); val t = new CountingTransport(authoringJson); val c = chat(5)
      Post("/authoring/dashboard", jsonEntity("""{"nope":1}""")) ~> Route.seal(routes(f, t, Some(c), c)) ~> check { status shouldBe StatusCodes.BadRequest }
      usage(f) shouldBe None
    }
    "not charge the outcome or conversation-read sub-routes" in {
      val f = newUser("beta"); val t = new CountingTransport(authoringJson); val c = chat(5)
      Post("/authoring/requests/abc/outcome", jsonEntity("""{"outcome":"accepted"}""")) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.NoContent }
      Get(s"/authoring/conversations/${UUID.randomUUID()}") ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.NotFound }
      usage(f) shouldBe None
      t.calls.get shouldBe 0
    }
    "fail closed with 503 (zero transport calls) when the service exists but ChatAccessService is absent" in {
      val f = newUser("free"); val t = new CountingTransport(authoringJson); val cl = client(t)
      val r = concat(
        new DashboardAuthoringRoutes(Some(authoringService(cl)), f.user, None)(routeEc).routes,
        new RefinementRoutes(Some(refinementService(cl)), f.user, None)(routeEc).routes
      )
      Post("/authoring/dashboard", jsonEntity(goal)) ~> r ~> check { status shouldBe StatusCodes.ServiceUnavailable }
      Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> r ~> check { status shouldBe StatusCodes.ServiceUnavailable }
      Post("/refinements", jsonEntity(refineBody(f))) ~> r ~> check { status shouldBe StatusCodes.ServiceUnavailable }
      t.calls.get shouldBe 0
    }
  }
}
