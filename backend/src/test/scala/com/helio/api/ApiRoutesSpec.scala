package com.helio.api

import com.helio.api.http.{AuthDirectives, RequestValidation, SessionCookies}
import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader, `Set-Cookie`}
import com.helio.domain.model.{AuthenticatedUser, ChartAppearance, ChartAxisLabel, ChartAxisLabels, ChartLegend, ChartTooltip, DashboardId, Page, PagedResult, PanelId, User, UserId, UserSession}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.api.protocols.agents.{CreateAgentMemoryRequest, PutAgentPreferencesRequest, PutMemoryEnabledRequest}
import com.helio.api.protocols.auth.RedeemInviteCodeRequest
import com.helio.infrastructure.persistence.{Database, DbContext}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.infrastructure.crypto.TokenHashing
import spray.json._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend

import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

class ApiRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres            = _
  private var db: JdbcBackend.Database                      = _
  private var dashboardRepo: DashboardRepository            = _
  private var panelRepo: PanelRepository                    = _
  private var dataSourceRepo: DataSourceRepository          = _
  private var connectorRepo: ConnectorRepository            = _
  private var dataTypeRepo: DataTypeRepository              = _
  private var userRepo: UserRepository                      = _
  private var userPreferenceRepo: UserPreferenceRepository  = _
  private var permissionRepo: ResourcePermissionRepository  = _
  private var pipelineRepo: PipelineRepository              = _
  private var pipelineStepRepo: PipelineStepRepository         = _
  private var realSessionRepo: SlickUserSessionRepository   = _
  // HEL-822: promoted from a beforeAll-local val to a field so rawRoutes() below can pass it
  // as dbContext — SourceService.createRest's bare-url dual-support path needs a real
  // ConnectorRepository (constructed by ApiRoutes when dbContext is present).
  private var ctx: DbContext = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(
      embeddedPostgres.getPostgresDatabase,
      Some(10)
    )

    ctx                = new DbContext(db, db)(typedSystem.executionContext)
    dashboardRepo      = new DashboardRepository(ctx)(typedSystem.executionContext)
    panelRepo          = new PanelRepository(ctx)(typedSystem.executionContext)
    dataSourceRepo     = new DataSourceRepository(ctx)(typedSystem.executionContext)
    dataTypeRepo       = new DataTypeRepository(ctx)(typedSystem.executionContext)
    userRepo           = new UserRepository(db)(typedSystem.executionContext)
    userPreferenceRepo = new UserPreferenceRepository(db)(typedSystem.executionContext)
    permissionRepo     = new ResourcePermissionRepository(ctx)(typedSystem.executionContext)
    pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(typedSystem.executionContext)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(typedSystem.executionContext)
    realSessionRepo    = new SlickUserSessionRepository(db)(typedSystem.executionContext)
    connectorRepo      = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))(typedSystem.executionContext))(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE resource_permissions, user_sessions, users, panels, dashboards, data_types, data_sources RESTART IDENTITY CASCADE"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ('00000000-0000-0000-0000-000000000099'::uuid, 'test@helio.test', now())"""))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ('00000000-0000-0000-0000-000000000098'::uuid, 'other@helio.test', now())"""))
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                         = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                       = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                            = Future.successful(())
    def exists(path: String): Future[Boolean]                                                         = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]  = Future.successful(ListPage(Seq.empty, None))
  }

  private def stubConnector(response: Either[String, JsValue]): RestApiConnectorDriver =
    new RestApiConnectorDriver(Some(_ => Future.successful(response)))

  // Fixed test user injected by the stub session repository
  private val testUserId  = "00000000-0000-0000-0000-000000000099"
  private val testToken   = "valid-test-token"
  private val testUser    = AuthenticatedUser(UserId(testUserId))

  private val otherUserId = "00000000-0000-0000-0000-000000000098"
  private val otherToken  = "valid-other-token"
  private val otherUser   = AuthenticatedUser(UserId(otherUserId))

  // Stub session repo: returns testUser for testToken, otherUser for otherToken, None otherwise
  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case `testToken`  => Some(testUser)
        case `otherToken` => Some(otherUser)
        case _            => None
      })
  }

  /** Builds the raw routes (no automatic auth header). */
  private def rawRoutes(connector: RestApiConnectorDriver = stubConnector(Left("no real HTTP in tests"))): Route =
    new ApiRoutes(dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem, connector, userRepo, stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      // HEL-822: dbContext wired so SourceService.createRest's bare-url dual-support path has a
      // real ConnectorRepository to synthesize an implicit Connector through.
      dbContext = ctx
    ).routes

  /** Routes that use the real DB-backed session repository (needed for auth/me tests). */
  private def realSessionRoutes(): Route =
    new ApiRoutes(dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem, stubConnector(Left("no real HTTP in tests")), userRepo, realSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext)).routes

  import org.apache.pekko.http.scaladsl.server.Directives.mapRequest

  // HEL-287: session auth moved from an `Authorization` bearer header to a
  // `helio_session` cookie; a custom header is required on non-GET requests
  // once that cookie is present (see AuthDirectives.requireCsrfHeader).
  private val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  /** Injects the given session token as a `helio_session` cookie (unless the
   *  request already carries one) and the CSRF header (unless already
   *  present) — mirrors what a real browser session + `httpClient.ts`
   *  produce, so the bulk of this suite doesn't need to know about either
   *  mechanism explicitly. */
  private def withDefaultCredentials(token: String)(req: HttpRequest): HttpRequest = {
    val withCookie =
      if (req.header[Cookie].exists(_.cookies.exists(_.name == SessionCookies.Name))) req
      else req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> token))
    if (withCookie.headers.exists(_.is(AuthDirectives.CsrfHeaderName.toLowerCase))) withCookie
    else withCookie.withHeaders(withCookie.headers :+ csrfHeader)
  }

  /** Routes with the valid session cookie + CSRF header pre-applied to every
   *  request that does not already carry its own `helio_session` cookie.
   *  This keeps all existing happy-path tests working without modification
   *  while still allowing the auth-route tests to supply their own
   *  credentials.
   */
  private def routes(connector: RestApiConnectorDriver = stubConnector(Left("no real HTTP in tests"))): Route =
    mapRequest(withDefaultCredentials(testToken)) {
      rawRoutes(connector)
    }

  /** Routes authenticated as the second (non-owner) user. */
  private def otherUserRoutes(): Route =
    mapRequest(withDefaultCredentials(otherToken)) {
      rawRoutes()
    }

  /** Reads the `helio_session` value set by a `Set-Cookie` response header —
   *  the only place the raw session token is exposed post-HEL-287 (the JSON
   *  body no longer carries it). Must be called from inside a `check {}`
   *  block, where `header[T]` resolves against the actual response. */
  private def sessionCookieValue(response: HttpResponse): String =
    response.headers.collectFirst { case `Set-Cookie`(cookie) if cookie.name == SessionCookies.Name => cookie.value }
      .getOrElse(fail(s"no Set-Cookie: ${SessionCookies.Name} header in response"))

  private def assertResourceMeta(meta: ResourceMetaResponse): Unit = {
    meta.createdBy should not be empty
    meta.createdAt should not be empty
    meta.lastUpdated should not be empty
  }

  private def assertDashboardAppearance(appearance: DashboardAppearanceResponse): Unit = {
    appearance.background should not be empty
    appearance.gridBackground should not be empty
  }

  private def assertDashboardLayout(layout: DashboardLayoutResponse): Unit = {
    layout.lg should not be null
    layout.md should not be null
    layout.sm should not be null
    layout.xs should not be null
  }

  private def assertPanelAppearance(appearance: PanelAppearanceResponse): Unit = {
    appearance.background should not be empty
    appearance.color should not be empty
    appearance.transparency should be >= 0.0
    appearance.transparency should be <= 1.0
  }

  "ApiRoutes" should {

    "return health status" in {
      Get("/health") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        contentType shouldBe ContentTypes.`application/json`
        responseAs[HealthResponse] shouldBe HealthResponse("ok")
      }
    }

    "return an empty dashboard collection by default" in {
      cleanDb()
      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[PagedResult[DashboardResponse]]
        paged.items shouldBe Vector.empty
        paged.total shouldBe 0
        paged.offset shouldBe 0
        paged.limit shouldBe Page.Default.limit
      }
    }

    "create a dashboard and return 201" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[DashboardResponse]
        response.name shouldBe "Operations"
        response.id should not be empty
        assertResourceMeta(response.meta)
        assertDashboardAppearance(response.appearance)
        response.layout shouldBe DashboardLayoutResponse(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
      }
    }

    "default a missing dashboard name" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DashboardResponse].name shouldBe RequestValidation.DefaultDashboardName
      }
    }

    "return dashboard and panel data after seeding" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PagedResult[DashboardResponse]]
        response.items should have size 1
        response.items.head.name shouldBe "Operations"
        assertResourceMeta(response.items.head.meta)
        assertDashboardAppearance(response.items.head.appearance)
        assertDashboardLayout(response.items.head.layout)
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PagedResult[PanelResponse]]
        response.items should have size 1
        response.items.head.dashboardId shouldBe dashboardId
        response.items.head.title shouldBe "CPU Usage"
        assertResourceMeta(response.items.head.meta)
        assertPanelAppearance(response.items.head.appearance)
      }
    }

    "persist dashboard data across repository reloads" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Persistent"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      // Re-query via repository directly to confirm DB persistence
      val found = await(dashboardRepo.findByIdInternal(DashboardId(dashboardId)))
      found.isDefined shouldBe true
      found.get.name shouldBe "Persistent"
    }

    "create a panel and return 201" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Latency"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[PanelResponse]
        response.dashboardId shouldBe dashboardId
        response.title shouldBe "Latency"
        response.id should not be empty
        assertResourceMeta(response.meta)
        assertPanelAppearance(response.appearance)
      }
    }

    // HEL-904 task 3.6/4.1: `collection`/`timeline` are retired PanelType
    // values (5-value collapse) — the three tests this comment used to guard
    // (HEL-310's collection-create, HEL-317's timeline-create, and its
    // invalid-sort rejection) are deleted outright, not rewritten; there is
    // no Panel-level equivalent (timeline sort/collection baseType are now
    // Output concerns, not Panel concerns).

    "return dashboards sorted by lastUpdated descending" in {
      cleanDb()

      Post("/api/dashboards", CreateDashboardRequest(Some("Alpha"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/dashboards", CreateDashboardRequest(Some("Beta"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items      = responseAs[PagedResult[DashboardResponse]].items
        items should have size 2
        val timestamps = items.map(d => java.time.Instant.parse(d.meta.lastUpdated))
        timestamps shouldEqual timestamps.sortWith(_.isAfter(_))
      }
    }

    "return panels sorted by lastUpdated descending" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel A"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel B"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items      = responseAs[PagedResult[PanelResponse]].items
        items should have size 2
        val timestamps = items.map(p => java.time.Instant.parse(p.meta.lastUpdated))
        timestamps shouldEqual timestamps.sortWith(_.isAfter(_))
      }
    }

    "update dashboard appearance and refresh lastUpdated" in {
      cleanDb()
      var dashboardId  = ""
      var originalMeta = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        val r = responseAs[DashboardResponse]
        dashboardId  = r.id
        originalMeta = r.meta.lastUpdated
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = Some(DashboardAppearancePayload(Some("#1e293b"), Some("#0f172a"))),
          layout     = None
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.appearance.background shouldBe "#1e293b"
        response.appearance.gridBackground shouldBe "#0f172a"
        response.meta.lastUpdated should not be originalMeta
      }

      Get("/api/dashboards") ~> routes() ~> check {
        val items = responseAs[PagedResult[DashboardResponse]].items
        items.head.appearance.background shouldBe "#1e293b"
      }
    }

    "update dashboard layout and refresh lastUpdated" in {
      cleanDb()
      var dashboardId  = ""
      var originalMeta = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        val r = responseAs[DashboardResponse]
        dashboardId  = r.id
        originalMeta = r.meta.lastUpdated
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload("panel-a", x = 1, y = 2, w = 5, h = 6)),
            md = Vector(DashboardLayoutItemPayload("panel-a", x = 0, y = 1, w = 4, h = 5)),
            sm = Vector(DashboardLayoutItemPayload("panel-a", x = 0, y = 0, w = 3, h = 5)),
            xs = Vector(DashboardLayoutItemPayload("panel-a", x = 0, y = 0, w = 2, h = 5))
          ))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.layout.lg should contain only DashboardLayoutItemResponse("panel-a", 1, 2, 5, 6)
        response.meta.lastUpdated should not be originalMeta
      }

      Get("/api/dashboards") ~> routes() ~> check {
        val items = responseAs[PagedResult[DashboardResponse]].items
        items.head.layout.md should contain only DashboardLayoutItemResponse("panel-a", 0, 1, 4, 5)
      }
    }

    "update panel appearance and clamp transparency" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(4.0), None).toJson), None, None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.appearance.background shouldBe "#0f172a"
        response.appearance.color shouldBe "#f8fafc"
        response.appearance.transparency shouldBe 1.0
      }
    }

    "reject appearance updates without appearance or layout payload" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(None, None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("name, appearance, or layout is required")
      }
    }

    "default a missing panel title" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), None, None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe RequestValidation.DefaultPanelTitle
      }
    }

    "reject panel creation without dashboardId" in {
      Post("/api/panels", CreatePanelRequest(None, Some("Latency"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("dashboardId is required")
      }
    }

    "reject panel creation for a missing dashboard" in {
      Post("/api/panels", CreatePanelRequest(Some("missing-dashboard"), Some("Latency"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "reject malformed panel requests" in {
      Post(
        "/api/panels",
        HttpEntity(ContentTypes.`application/json`, """{"title":17}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject malformed dashboard create request with type mismatch" in {
      Post(
        "/api/dashboards",
        HttpEntity(ContentTypes.`application/json`, """{"name":42}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject malformed dashboard create request with invalid JSON" in {
      Post(
        "/api/dashboards",
        HttpEntity(ContentTypes.`application/json`, """{invalid}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "delete a dashboard and return 204" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("ToDelete"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Delete(s"/api/dashboards/$dashboardId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get("/api/dashboards") ~> routes() ~> check {
        responseAs[PagedResult[DashboardResponse]].items shouldBe empty
      }
    }

    "cascade delete panels when dashboard is deleted" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("WithPanels"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Delete(s"/api/dashboards/$dashboardId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      val found = await(panelRepo.findByIdInternal(PanelId(panelId)))
      found shouldBe None
    }

    "return 404 when deleting a non-existent dashboard" in {
      Delete("/api/dashboards/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "delete a panel and return 204" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Latency"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Delete(s"/api/panels/$panelId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        responseAs[PagedResult[PanelResponse]].items shouldBe empty
      }
    }

    "return 404 when deleting a non-existent panel" in {
      Delete("/api/panels/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    "duplicate a panel and return 201 with copied title and appearance" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(0.5), None).toJson), None, None)
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val dup = responseAs[PanelResponse]
        dup.id should not be panelId
        dup.dashboardId shouldBe dashboardId
        dup.title shouldBe "CPU Usage (copy)"
        dup.appearance.background shouldBe "#0f172a"
        dup.appearance.color shouldBe "#f8fafc"
        dup.appearance.transparency shouldBe 0.5
      }
    }

    "increment copy counter on subsequent duplications" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy)"
      }
      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy 2)"
      }
      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy 3)"
      }
    }

    "strip existing copy suffix before computing new copy title" in {
      cleanDb()
      var dashboardId = ""
      var copyId      = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      var sourceId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        sourceId = responseAs[PanelResponse].id
      }
      Post(s"/api/panels/$sourceId/duplicate") ~> routes() ~> check {
        copyId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$copyId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy 2)"
      }
    }

    "return 404 when duplicating a non-existent panel" in {
      Post("/api/panels/no-such-panel/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    "leave the source panel unchanged after duplication" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        val panels = responseAs[PagedResult[PanelResponse]].items
        panels should have size 2
        val source = panels.find(_.id == panelId).get
        source.title shouldBe "CPU Usage"
      }
    }

    "rename a dashboard and return 200 with updated name" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Old Name"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(name = Some("New Name"), appearance = None, layout = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DashboardResponse].name shouldBe "New Name"
      }
    }

    "reject rename with blank name" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("My Dashboard"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(name = Some("   "), appearance = None, layout = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("name must not be blank")
      }
    }

    "return 404 when renaming a non-existent dashboard" in {
      Patch(
        "/api/dashboards/does-not-exist",
        UpdateDashboardRequest(name = Some("New Name"), appearance = None, layout = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "update panel title and return 200 with updated title" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Old Title"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(title = Some("New Title"), appearance = None, `type` = None, config = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PanelResponse].title shouldBe "New Title"
      }
    }

    "reject panel title update with blank title" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(title = Some(""), appearance = None, `type` = None, config = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("title must not be blank")
      }
    }

    "return 404 when updating title of a non-existent panel" in {
      Patch(
        "/api/panels/does-not-exist",
        UpdatePanelRequest(title = Some("New Title"), appearance = None, `type` = None, config = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    // ── DataType CRUD ──────────────────────────────────────────────────────────

    "return an empty data type collection by default" in {
      cleanDb()
      Get("/api/types") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PagedResult[DataTypeResponse]].items shouldBe Vector.empty
      }
    }

    "return 404 for a non-existent data type" in {
      Get("/api/types/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }

    "update a data type name and fields and increment version" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "Original",
        fields    = Vector(DataField("col1", "Column 1", "string", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name   = Some("Renamed"),
          fields = Some(Vector(DataFieldPayload("col1", "Column 1", "string", nullable = false), DataFieldPayload("col2", "Column 2", "integer", nullable = true)))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.name shouldBe "Renamed"
        response.fields should have size 2
        response.version shouldBe 2
      }
    }

    "return 404 when patching a non-existent data type" in {
      Patch(
        "/api/types/does-not-exist",
        UpdateDataTypeRequest(name = Some("X"), fields = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }

    "delete a data type and return 204" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "ToDelete",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Delete(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 when deleting a non-existent data type" in {
      Delete("/api/types/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }

    // HEL-904 task 4.1: "return 409 when deleting a data type bound to a
    // panel" removed outright -- Text/Markdown's data-bound "Source mode"
    // no longer exists, so no panel kind can ever be bound to a DataType
    // anymore, and `DataTypeService.delete`'s `existsBoundToAnyOwnedPanel`
    // guard can never fire (queries a `panels.type_id` column no live panel
    // kind ever populates).

    // ── DataType computed fields ───────────────────────────────────────────────

    "PATCH /api/types/:id includes computedFields and returns updated DataType" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "PriceType",
        fields    = Vector(
          DataField("price", "Price", "float", nullable = false),
          DataField("quantity", "Quantity", "integer", nullable = false)
        ),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name   = None,
          fields = None,
          computedFields = Some(Vector(
            ComputedFieldPayload("total", "Total", "price * quantity", "float")
          ))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.computedFields should have size 1
        response.computedFields.head.name shouldBe "total"
        response.computedFields.head.expression shouldBe "price * quantity"
        response.version shouldBe 2
      }
    }

    "GET /api/types/:id includes computedFields array" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id             = DataTypeId(UUID.randomUUID().toString),
        sourceId       = None,
        name           = "WithComputed",
        fields         = Vector(DataField("x", "X", "float", nullable = false)),
        computedFields = Vector(ComputedField("doubled", "Doubled", "x * 2", "float")),
        version        = 1,
        createdAt      = Instant.now(),
        updatedAt      = Instant.now(),
        ownerId        = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Get(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.computedFields should have size 1
        response.computedFields.head.name shouldBe "doubled"
      }
    }

    "PATCH /api/types/:id with invalid computed field expression returns 400" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "ErrorType",
        fields    = Vector(DataField("price", "Price", "float", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name   = None,
          fields = None,
          computedFields = Some(Vector(
            ComputedFieldPayload("bad", "Bad", "price **", "float")
          ))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "PATCH /api/types/:id with expression exceeding 500 chars returns 400" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "LongExprType",
        fields    = Vector(DataField("x", "X", "float", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      val longExpr = "x + " * 200 // > 500 chars

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name   = None,
          fields = None,
          computedFields = Some(Vector(
            ComputedFieldPayload("toolong", "Too Long", longExpr, "float")
          ))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "GET /api/types/:id/validate-expression returns valid=true for a valid expression" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "ValidateType",
        fields    = Vector(
          DataField("price", "Price", "float", nullable = false),
          DataField("quantity", "Qty", "integer", nullable = false)
        ),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Get(s"/api/types/${dt.id.value}/validate-expression?expr=price+*+quantity") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[ValidateExpressionResponse]
        response.valid shouldBe true
        response.message shouldBe None
      }
    }

    "GET /api/types/:id/validate-expression returns valid=false for syntax error" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "ValidateSyntaxType",
        fields    = Vector(DataField("price", "Price", "float", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Get(s"/api/types/${dt.id.value}/validate-expression?expr=price+**") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[ValidateExpressionResponse]
        response.valid shouldBe false
        response.message shouldBe defined
      }
    }

    "GET /api/types/:id/validate-expression returns valid=false for unknown field" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "ValidateFieldType",
        fields    = Vector(DataField("price", "Price", "float", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(testUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Get(s"/api/types/${dt.id.value}/validate-expression?expr=nonexistent+*+2") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[ValidateExpressionResponse]
        response.valid shouldBe false
        response.message shouldBe Some("Unknown field: nonexistent")
      }
    }

    "GET /api/types/:id/validate-expression returns 404 for unknown DataType" in {
      Get(s"/api/types/no-such-id/validate-expression?expr=x+*+2") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // ── DataSources ────────────────────────────────────────────────────────────

    "return an empty data sources collection by default" in {
      cleanDb()
      Get("/api/data-sources") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PagedResult[DataSourceResponse]].items shouldBe Vector.empty
      }
    }

    // HEL-904 task 4.1: "bind a data type to a panel and return it in the
    // response" / "unbind a data type from a panel by setting typeId to
    // null" removed outright -- Text/Markdown's data-bound "Source mode"
    // no longer exists, so a panel can never carry a `dataTypeId` binding.

    // ── HEL-292: panel-level aggregation persistence (evaluation-1.md CR #1/#2) ──
    //
    // Cycle 1 computed `aggregation` correctly in memory (decode/patch/applyPatch)
    // but never wired it into PanelRowMapper/PanelRepository, so the very first
    // PATCH-then-reload silently dropped it. These tests PATCH the aggregation
    // spec and then re-read it via `GET /api/dashboards/:id/panels` — a fresh
    // `panelRepo.findAllByDashboardId` query, NOT the PATCH response — so a
    // regression that drops the DB round-trip (but keeps the in-memory patch
    // working) is actually caught.

    // HEL-904 task 3.10a: HEL-292 panel-level aggregation is retired outright
    // (design.md: "aggregation exists only as steps... an Output is
    // render-only") — the two persistence tests this comment used to guard
    // ("persist a metric panel's aggregation spec"/"persist a chart panel's
    // groupBy aggregation spec") are deleted: no surviving Panel kind's typed
    // config has an `aggregation` field to persist (a Divider's config
    // silently drops the unknown key on encode; "chart" is a retired
    // PanelType outright). The "clear ... via explicit null" test below only
    // asserts ABSENCE, so it's unaffected and stays.

    "clear a metric panel's aggregation spec via explicit null and have the clear survive a real repository re-read (HEL-292)" in {
      cleanDb()

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Clear Aggregation Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Avg Metric"), Some("divider"), None)
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, config = Some(JsObject(
          "aggregation" -> JsObject("value" -> JsString("profit"), "agg" -> JsString("sum"))
        )))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, config = Some(JsObject("aggregation" -> JsNull)))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val panels = responseAs[PanelsResponse].items
        val panel  = panels.find(_.id == panelId).get
        panel.config.asJsObject.fields.contains("aggregation") shouldBe false
      }
    }

    // HEL-904 task 3.6/4.1: `table`/`chart` are retired PanelType values (5-
    // value collapse) — the three HEL-255 table-display-config tests this
    // comment used to guard (density+columnOrder persistence, invalid-
    // density rejection, display-only-PATCH-leaves-binding-untouched) are
    // deleted outright, not rewritten: there is no Panel-level equivalent
    // (table density/columnOrder are now Output-owned display concerns).

    // HEL-904 task 3.6/4.1: `chart` is a retired PanelType value (5-value
    // collapse) — the four HEL-248 chartOptions persistence tests this
    // comment used to guard are deleted outright, not rewritten: chart
    // display options are now an Output-owned concern, not a Panel one.


    // ── HEL-293: metric literal label/unit persistence (Decision 5 whitelist
    // gotcha — guards against a repeat of the HEL-292 `aggregation` regression
    // where `PanelRepository.replace`'s explicit column tuple silently dropped
    // a config field on write). PATCH-then-reload via a fresh
    // `panelRepo.findAllByDashboardId` query, NOT the PATCH response. ──

    // HEL-904 task 3.10a: HEL-293 metric literal label/unit is retired along
    // with the Metric panel kind — "persist a metric panel's literal
    // label/unit" is deleted outright (no Panel kind's typed config has
    // `label`/`unit` fields to persist; a Divider's config silently drops
    // them on encode). The "clear ... via explicit null" test below only
    // asserts ABSENCE, so it's unaffected and stays.

    "clear a metric panel's literal label/unit via explicit null and have the clear survive a real repository re-read (HEL-293)" in {
      cleanDb()

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Clear Metric Literal Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Total"), Some("divider"), None)
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, config = Some(JsObject(
          "label" -> JsString("Total Revenue"),
          "unit"  -> JsString("USD")
        )))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, config = Some(JsObject("label" -> JsNull, "unit" -> JsNull)))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val panels = responseAs[PanelsResponse].items
        val panel  = panels.find(_.id == panelId).get
        panel.config.asJsObject.fields.contains("label") shouldBe false
        panel.config.asJsObject.fields.contains("unit") shouldBe false
      }
    }

    // ── REST connector routes ──────────────────────────────────────────────────

    "POST /api/sources creates DataSource and registers DataType on successful fetch" in {
      cleanDb()
      import spray.json._

      val connectorId = await(
        connectorRepo.create(
          ownerId             = testUser.id,
          name                = s"api-routes-conn-${UUID.randomUUID()}",
          kind                = "rest_api",
          baseUrl             = "http://example.com",
          config              = """{"authType":"none"}""",
          credentialPlaintext = "",
          credentialName      = "cred"
        )
      ).id.value
      val responseJson = """[{"col1":"a","col2":1},{"col1":"b","col2":2}]""".parseJson
      Post(
        "/api/sources",
        CreateSourceRequest(
          name           = "My API",
          `type`         = "rest_api",
          config         = RestApiConfigPayload(connectorId = Some(connectorId), method = None),
          fieldOverrides = None
        )
      ) ~> routes(stubConnector(Right(responseJson))) ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[CreateSourceResponse]
        response.source.name shouldBe "My API"
        response.inferredSchema shouldBe defined
        response.inferredSchema.get.fields should have size 2
        response.fetchError shouldBe None
      }
    }

    "POST /api/sources creates DataSource with fetchError when fetch fails" in {
      cleanDb()
      val connectorId = await(
        connectorRepo.create(
          ownerId             = testUser.id,
          name                = s"api-routes-conn-${UUID.randomUUID()}",
          kind                = "rest_api",
          baseUrl             = "http://example.com",
          config              = """{"authType":"none"}""",
          credentialPlaintext = "",
          credentialName      = "cred"
        )
      ).id.value
      Post(
        "/api/sources",
        CreateSourceRequest(
          name           = "Bad API",
          `type`         = "rest_api",
          config         = RestApiConfigPayload(connectorId = Some(connectorId), method = None),
          fieldOverrides = None
        )
      ) ~> routes(stubConnector(Left("HTTP 500: Internal Server Error"))) ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[CreateSourceResponse]
        response.inferredSchema shouldBe None
        response.fetchError shouldBe Some("HTTP 500: Internal Server Error")
      }
    }

    "POST /api/sources rejects a bare-url rest_api config with 400 naming connectorId" in {
      cleanDb()
      import spray.json._

      val responseJson = """[{"col1":"a","col2":1}]""".parseJson
      Post(
        "/api/sources",
        CreateSourceRequest(
          name           = "Bare Url API",
          `type`         = "rest_api",
          config         = RestApiConfigPayload(url = Some("http://example.com"), method = None, auth = None, headers = None),
          fieldOverrides = None
        )
      ) ~> routes(stubConnector(Right(responseJson))) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("connectorId")
      }
    }

    "POST /api/sources/:id/refresh updates the source's inferredSchema" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID
      import spray.json._

      val now = Instant.now()
      val source = RestSource(
        id        = DataSourceId(UUID.randomUUID().toString),
        name      = "Refresh Source",
        ownerId   = UserId(testUserId),
        createdAt = now,
        updatedAt = now,
        config    = RestApiConfig(connectorId = "conn-1", endpoint = "http://example.com", method = "GET")
      )
      await(dataSourceRepo.insert(source, testUser))

      // HEL-904: `SourceService.refresh` re-writes `inferredSchema` directly on the source —
      // no companion DataType, no version to increment.
      val newJson = """[{"new_col":"x"}]""".parseJson
      Post(s"/api/sources/${source.id.value}/refresh") ~> routes(stubConnector(Right(newJson))) ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataSourceResponse]
        response.id shouldBe source.id.value
      }
      await(dataSourceRepo.findByIdOwned(source.id, testUser)).get.inferredSchema.map(_.name) shouldBe Vector("new_col")
    }

    "POST /api/sources/:id/refresh returns 404 for unknown source" in {
      Post("/api/sources/does-not-exist/refresh") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataSource not found")
      }
    }

    "GET /api/sources/:id/preview returns up to 10 rows" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID
      import spray.json._

      val now = Instant.now()
      val source = RestSource(
        id        = DataSourceId(UUID.randomUUID().toString),
        name      = "Preview Source",
        ownerId   = UserId(testUserId),
        createdAt = now,
        updatedAt = now,
        config    = RestApiConfig(connectorId = "conn-1", endpoint = "http://example.com", method = "GET")
      )
      await(dataSourceRepo.insert(source, testUser))

      val bigArray = JsArray((1 to 15).map(i => JsObject("n" -> JsNumber(i))).toVector)
      Get(s"/api/sources/${source.id.value}/preview") ~> routes(stubConnector(Right(bigArray))) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PreviewSourceResponse].rows should have size 10
      }
    }

    "GET /api/sources/:id/preview returns 404 for unknown source" in {
      Get("/api/sources/does-not-exist/preview") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataSource not found")
      }
    }

    "duplicate a dashboard and return 201 with copied name, appearance, and panels" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(0.5), None).toJson), None, None)
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.id should not be dashboardId
        result.dashboard.name shouldBe "Operations (copy)"
        result.panels should have size 1
        val copiedPanel = result.panels.head
        copiedPanel.id should not be panelId
        copiedPanel.dashboardId shouldBe result.dashboard.id
        copiedPanel.title shouldBe "CPU Usage"
        copiedPanel.appearance.background shouldBe "#0f172a"
        copiedPanel.appearance.color shouldBe "#f8fafc"
        copiedPanel.appearance.transparency shouldBe 0.5
      }
    }

    "remap layout panel IDs when duplicating a dashboard" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Layout Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel A"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout     = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result    = responseAs[DuplicateDashboardResponse]
        val newPanelId = result.panels.head.id
        result.dashboard.layout.lg should have size 1
        result.dashboard.layout.lg.head.panelId shouldBe newPanelId
        result.dashboard.layout.lg.head.panelId should not be panelId
      }
    }

    "duplicate a dashboard with no panels" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Empty"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.name shouldBe "Empty (copy)"
        result.panels shouldBe empty
      }
    }

    "return 404 when duplicating a non-existent dashboard" in {
      Post("/api/dashboards/no-such-dashboard/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "leave the source dashboard unchanged after duplication" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Source"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        val panels = responseAs[PagedResult[PanelResponse]].items
        panels should have size 1
        panels.head.id shouldBe panelId
        panels.head.title shouldBe "My Panel"
      }

      Get("/api/dashboards") ~> routes() ~> check {
        val dashboards = responseAs[PagedResult[DashboardResponse]].items
        val source     = dashboards.find(_.id == dashboardId).get
        source.name shouldBe "Source"
      }
    }

    // ── Export endpoint ────────────────────────────────────────────────────────

    "export a dashboard and return snapshot shape without IDs or meta" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Export Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val snapshot = responseAs[DashboardSnapshotPayload]
        snapshot.version shouldBe DashboardSnapshotPayload.CurrentVersion
        snapshot.dashboard.name shouldBe "Export Test"
        snapshot.panels should have size 1
        val snapshotPanel = snapshot.panels.head
        snapshotPanel.snapshotId shouldBe panelId
        snapshotPanel.title shouldBe "My Panel"
        snapshotPanel.`type` shouldBe "divider"
        snapshot.dashboard.layout.lg.head.panelId shouldBe snapshotPanel.snapshotId
        // HEL-368: the additive `id` field equals both `snapshotId` and the panel's real id
        snapshotPanel.id shouldBe Some(panelId)
        snapshotPanel.id shouldBe Some(snapshotPanel.snapshotId)
      }
    }

    // HEL-368: an export captured before the `id` field existed (or any
    // hand-rolled snapshot omitting it) must still import successfully and
    // produce the same result as one that carries `id` — `id` is decode-
    // tolerant and ignored by the importer, which keys exclusively off
    // `snapshotId`.
    "import a snapshot whose panel entries omit the `id` field succeeds identically to one that includes it" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Legacy Export"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Legacy Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      var snapshot: DashboardSnapshotPayload = null
      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        snapshot = responseAs[DashboardSnapshotPayload]
      }
      // Simulate a pre-existing exported file: strip `id` from every panel entry.
      val legacySnapshot = snapshot.copy(panels = snapshot.panels.map(_.copy(id = None)))

      Post("/api/dashboards/import", legacySnapshot) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.id should not be dashboardId
        result.dashboard.name shouldBe "Legacy Export"
        result.panels should have size 1
        val importedPanel = result.panels.head
        importedPanel.id should not be panelId
        importedPanel.title shouldBe "Legacy Panel"
      }
    }

    "export a dashboard with no panels returns empty panels array and empty layout" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Empty Export"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val snapshot = responseAs[DashboardSnapshotPayload]
        snapshot.panels shouldBe empty
        snapshot.dashboard.layout.lg shouldBe empty
        snapshot.dashboard.layout.md shouldBe empty
        snapshot.dashboard.layout.sm shouldBe empty
        snapshot.dashboard.layout.xs shouldBe empty
      }
    }

    "return 404 when exporting a non-existent dashboard" in {
      Get("/api/dashboards/no-such-id/export") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    // ── Import endpoint ────────────────────────────────────────────────────────

    "import a snapshot and return 201 with new IDs, remapped layout, and DuplicateDashboardResponse" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Original"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      var snapshot: DashboardSnapshotPayload = null
      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        snapshot = responseAs[DashboardSnapshotPayload]
      }

      Post("/api/dashboards/import", snapshot) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.id should not be dashboardId
        result.dashboard.name shouldBe "Original"
        result.panels should have size 1
        val importedPanel = result.panels.head
        importedPanel.id should not be panelId
        importedPanel.dashboardId shouldBe result.dashboard.id
        importedPanel.title shouldBe "CPU"
        // layout should use the new panel ID (remapped from snapshotId)
        result.dashboard.layout.lg should have size 1
        result.dashboard.layout.lg.head.panelId shouldBe importedPanel.id
      }
    }

    // HEL-317: a timeline panel's config (timelineOptions.sort) must survive the
    // dashboard export→import round trip — exercises the
    // DashboardServiceValidation.validatePanelEntries / PanelType.fromString
    // import path (distinct from POST /api/panels/:id/duplicate).
    // HEL-904 task 3.6/4.1: `timeline` is a retired PanelType value (5-value
    // collapse) — "import a snapshot containing a timeline panel and
    // preserve its timelineOptions" is deleted outright; timeline sort is
    // now an Output-owned concern, not a Panel one.

    "import assigns new IDs on each import" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Repeated Import"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var snapshot: DashboardSnapshotPayload = null
      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        snapshot = responseAs[DashboardSnapshotPayload]
      }

      var firstImportId  = ""
      var secondImportId = ""
      Post("/api/dashboards/import", snapshot) ~> routes() ~> check {
        firstImportId = responseAs[DuplicateDashboardResponse].dashboard.id
      }
      Post("/api/dashboards/import", snapshot) ~> routes() ~> check {
        secondImportId = responseAs[DuplicateDashboardResponse].dashboard.id
      }

      firstImportId should not be dashboardId
      secondImportId should not be dashboardId
      firstImportId should not be secondImportId
    }

    "reject import with missing version field" in {
      Post(
        "/api/dashboards/import",
        HttpEntity(
          ContentTypes.`application/json`,
          """{"dashboard":{"name":"X","appearance":{"background":"transparent","gridBackground":"transparent"},"layout":{"lg":[],"md":[],"sm":[],"xs":[]}},"panels":[]}"""
        )
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("version")
      }
    }

    "reject import with empty dashboard name" in {
      val payload = DashboardSnapshotPayload(
        version = DashboardSnapshotPayload.CurrentVersion,
        dashboard = DashboardSnapshotDashboardEntry(
          name = "",
          appearance = DashboardAppearancePayload(Some("transparent"), Some("transparent")),
          layout = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
        ),
        panels = Vector.empty
      )
      Post("/api/dashboards/import", payload) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("name")
      }
    }

    "reject import with invalid panel type" in {
      val payload = DashboardSnapshotPayload(
        version = DashboardSnapshotPayload.CurrentVersion,
        dashboard = DashboardSnapshotDashboardEntry(
          name = "Test",
          appearance = DashboardAppearancePayload(Some("transparent"), Some("transparent")),
          layout = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
        ),
        panels = Vector(
          DashboardSnapshotPanelEntry(
            snapshotId = "snap-1",
            id         = Some("snap-1"),
            title      = "Panel",
            `type`     = "unknown_type",
            appearance = PanelAppearancePayload(None, None, None, None),
            config     = JsObject.empty
          )
        )
      )
      Post("/api/dashboards/import", payload) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("unknown_type")
      }
    }

    "reject import when layout references unknown snapshotId" in {
      val payload = DashboardSnapshotPayload(
        version = DashboardSnapshotPayload.CurrentVersion,
        dashboard = DashboardSnapshotDashboardEntry(
          name = "Test",
          appearance = DashboardAppearancePayload(Some("transparent"), Some("transparent")),
          layout = DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload("nonexistent-id", 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          )
        ),
        panels = Vector.empty
      )
      Post("/api/dashboards/import", payload) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("nonexistent-id")
      }
    }

    // HEL-624 task 5.8 — 5th enforcement site: import rejects a chart entry
    // combining `chartType: "scatter"` with a present `aggregation`, with
    // zero dashboard/panel rows created (DashboardServiceValidation.validatePanelEntries).
    // HEL-904 task 3.6/4.1/3.10a: `chart` is a retired PanelType value (5-
    // value collapse), and panel-level `aggregation` is retired outright —
    // the scatter+aggregation import-rejection test and its "valid chart
    // entry" regression-guard sibling are both deleted outright: chart
    // appearance/aggregation are now Output-owned concerns, not Panel ones,
    // and `type: "chart"` itself is no longer a decodable panel type.

    // ── Dashboard /update endpoint ────────────────────────────────────────────

    "dashboard update endpoint applies layout changes" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Update Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Metric"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val updateReq = UpdateDashboardBatchRequest(
        fields = Vector("layout"),
        dashboard = UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout     = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 6, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      )

      Patch(s"/api/dashboards/$dashboardId/update", updateReq) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.layout.lg should contain only DashboardLayoutItemResponse(panelId, 0, 0, 6, 4)
      }
    }

    "dashboard update endpoint returns 400 when no fields provided" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Validation Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(
        s"/api/dashboards/$dashboardId/update",
        UpdateDashboardBatchRequest(fields = Vector.empty, dashboard = UpdateDashboardRequest(None, None, None))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    // ── Panels updateBatch endpoint ───────────────────────────────────────────

    "panels updateBatch applies appearance updates to multiple panels" in {
      cleanDb()
      var dashboardId = ""
      var panelId1    = ""
      var panelId2    = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Panel Batch Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel 1"), None, None)) ~> routes() ~> check {
        panelId1 = responseAs[PanelResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel 2"), None, None)) ~> routes() ~> check {
        panelId2 = responseAs[PanelResponse].id
      }

      val batchReq = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(
          PanelBatchItem(panelId1, None, Some(PanelAppearancePayload(Some("#111111"), None, None, None).toJson), None, None),
          PanelBatchItem(panelId2, None, Some(PanelAppearancePayload(Some("#222222"), None, None, None).toJson), None, None)
        )
      )

      Post("/api/panels/updateBatch", batchReq) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[UpdatePanelsBatchResponse]
        response.panels should have size 2
        response.panels.map(_.appearance.background) should contain allOf ("#111111", "#222222")
      }
    }

    // HEL-904 task 3.6/4.1: `chart` is a retired PanelType value (5-value
    // collapse) — the whole HEL-305 creation-time chartType-validation block
    // (create/PATCH/updateBatch, 7 tests) is deleted outright: chart
    // appearance/chartType are now Output-owned concerns, not Panel ones.

    // ── HEL-362: appearance PATCH/updateBatch is a partial merge, not a replace ──

    "PATCH background only, without a chart key, preserves a chart panel's already-set chartType and every other chart sub-field (HEL-362 AC1)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Merge AC1 Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      // First PATCH: establish a non-default, fully-customized stored chart.
      val customChart = JsObject(
        "seriesColors" -> JsArray(JsString("#123123"), JsString("#456456")),
        "legend"       -> JsObject("show" -> JsBoolean(false), "position" -> JsString("left")),
        "tooltip"      -> JsObject("enabled" -> JsBoolean(false)),
        "axisLabels" -> JsObject(
          "x" -> JsObject("show" -> JsBoolean(false), "label" -> JsString("Custom X")),
          "y" -> JsObject("show" -> JsBoolean(false), "label" -> JsString("Custom Y"))
        ),
        "chartType" -> JsString("bar")
      )
      Patch(s"/api/panels/$panelId", UpdatePanelRequest(None, Some(JsObject("chart" -> customChart)), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PanelResponse].appearance.chart.flatMap(_.chartType) shouldBe Some("bar")
      }

      // Second PATCH: background only, no `chart` key at all.
      Patch(s"/api/panels/$panelId", UpdatePanelRequest(None, Some(JsObject("background" -> JsString("#0a0"))), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.appearance.background shouldBe "#0a0"
        val chart = response.appearance.chart.get
        chart.chartType shouldBe Some("bar")
        chart.seriesColors shouldBe Vector("#123123", "#456456")
        chart.legend shouldBe ChartLegend(show = false, position = "left")
        chart.tooltip shouldBe ChartTooltip(enabled = false)
        chart.axisLabels shouldBe ChartAxisLabels(
          x = ChartAxisLabel(show = false, label = Some("Custom X")),
          y = ChartAxisLabel(show = false, label = Some("Custom Y"))
        )
      }
    }

    "PATCH a partial chart object ({chartType}) returns 200 (not 400) and changes only chartType (HEL-362 AC2)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Merge AC2 Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val fullChart = JsObject(
        "seriesColors" -> JsArray(JsString("#654321")),
        "legend"       -> JsObject("show" -> JsBoolean(true), "position" -> JsString("right")),
        "tooltip"      -> JsObject("enabled" -> JsBoolean(true)),
        "axisLabels" -> JsObject(
          "x" -> JsObject("show" -> JsBoolean(true), "label" -> JsString("X!")),
          "y" -> JsObject("show" -> JsBoolean(true), "label" -> JsString("Y!"))
        ),
        "chartType" -> JsString("line")
      )
      Patch(s"/api/panels/$panelId", UpdatePanelRequest(None, Some(JsObject("chart" -> fullChart)), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(JsObject("chart" -> JsObject("chartType" -> JsString("bar")))), None, None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val chart = responseAs[PanelResponse].appearance.chart.get
        chart.chartType shouldBe Some("bar")
        chart.seriesColors shouldBe Vector("#654321")
        chart.legend shouldBe ChartLegend(show = true, position = "right")
        chart.tooltip shouldBe ChartTooltip(enabled = true)
      }
    }

    "two sequential PATCHes (chart.chartType, then background) each preserve the other's change (HEL-362 AC3)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Merge AC3 Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(JsObject("chart" -> JsObject("chartType" -> JsString("bar")))), None, None)
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(JsObject("background" -> JsString("#123456"))), None, None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.appearance.background shouldBe "#123456"
        response.appearance.chart.flatMap(_.chartType) shouldBe Some("bar")
      }
    }

    "PATCH with an explicit null resets that field to PanelAppearance.Default (HEL-362)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Merge Null Reset Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(JsObject("background" -> JsString("#0a0"))), None, None)
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(JsObject("background" -> JsNull)), None, None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PanelResponse].appearance.background shouldBe "transparent"
      }
    }

    "a top-level {\"appearance\": null} PATCH is a no-op — stored appearance unchanged, not wiped to Default (HEL-362 5.7a)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Merge Top-Level Null Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      // Establish a distinctive, non-default stored appearance first.
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(
          None,
          Some(JsObject("background" -> JsString("#0a0"), "chart" -> JsObject("chartType" -> JsString("bar")))),
          None,
          None
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      // A top-level `appearance: null` (present-but-null, not omitted) must be a
      // no-op — NOT a wipe back to `PanelAppearance.Default`.
      Patch(s"/api/panels/$panelId", UpdatePanelRequest(None, Some(JsNull), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.appearance.background shouldBe "#0a0"
        response.appearance.chart.flatMap(_.chartType) shouldBe Some("bar")
      }
    }

    "batch appearance update with a top-level null appearance is a no-op, not a wipe (HEL-362 5.7a)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Batch Merge Top-Level Null Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val establish = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(PanelBatchItem(panelId, None, Some(JsObject("background" -> JsString("#654321"))), None, None))
      )
      Post("/api/panels/updateBatch", establish) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      val nullAppearance = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(PanelBatchItem(panelId, None, Some(JsNull), None, None))
      )
      Post("/api/panels/updateBatch", nullAppearance) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[UpdatePanelsBatchResponse].panels.head.appearance.background shouldBe "#654321"
      }
    }

    "batch appearance update preserves an omitted field (HEL-362)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Batch Merge Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val setColor = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(PanelBatchItem(panelId, None, Some(JsObject("color" -> JsString("#ffffff"))), None, None))
      )
      Post("/api/panels/updateBatch", setColor) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      val setBackgroundOnly = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(PanelBatchItem(panelId, None, Some(JsObject("background" -> JsString("#000000"))), None, None))
      )
      Post("/api/panels/updateBatch", setBackgroundOnly) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val panel = responseAs[UpdatePanelsBatchResponse].panels.head
        panel.appearance.background shouldBe "#000000"
        panel.appearance.color shouldBe "#ffffff"
      }
    }

    "batch appearance update accepts a partial chart payload (HEL-362)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Batch Merge Chart Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel"), Some("divider"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val fullChart = JsObject(
        "seriesColors" -> JsArray(JsString("#010101")),
        "legend"       -> JsObject("show" -> JsBoolean(true), "position" -> JsString("bottom")),
        "tooltip"      -> JsObject("enabled" -> JsBoolean(true)),
        "axisLabels" -> JsObject(
          "x" -> JsObject("show" -> JsBoolean(true), "label" -> JsString("X")),
          "y" -> JsObject("show" -> JsBoolean(true), "label" -> JsString("Y"))
        ),
        "chartType" -> JsString("line")
      )
      val establish = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(PanelBatchItem(panelId, None, Some(JsObject("chart" -> fullChart)), None, None))
      )
      Post("/api/panels/updateBatch", establish) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      val partialChart = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(
          PanelBatchItem(panelId, None, Some(JsObject("chart" -> JsObject("chartType" -> JsString("scatter")))), None, None)
        )
      )
      Post("/api/panels/updateBatch", partialChart) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val chart = responseAs[UpdatePanelsBatchResponse].panels.head.appearance.chart.get
        chart.chartType shouldBe Some("scatter")
        chart.legend shouldBe ChartLegend(show = true, position = "bottom")
      }
    }

    "panels updateBatch returns 404 for an unknown panel id" in {
      cleanDb()

      val batchReq = UpdatePanelsBatchRequest(
        fields = Vector("appearance"),
        panels = Vector(PanelBatchItem("non-existent-id", None, Some(PanelAppearancePayload(Some("#ff0000"), None, None, None).toJson), None, None))
      )

      Post("/api/panels/updateBatch", batchReq) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "panels updateBatch returns 400 for empty panels array" in {
      cleanDb()

      Post(
        "/api/panels/updateBatch",
        UpdatePanelsBatchRequest(fields = Vector.empty, panels = Vector.empty)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("panels must not be empty")
      }
    }

    // HEL-904 task 3.10a: HEL-296's batchUpdate config-patch-persistence
    // block (metric aggregation, chart groupBy aggregation, metric literal
    // label/unit) is retired along with panel-level aggregation and the
    // Metric/Chart panel kinds — no surviving Panel kind's typed config has
    // these fields to persist. Deleted outright, not rewritten.

  }

  // ── Session middleware — 401 tests ───────────────────────────────────────────

  "Protected routes" should {

    "return 401 for GET /api/dashboards without Authorization" in {
      Get("/api/dashboards") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for POST /api/dashboards without Authorization" in {
      Post("/api/dashboards", CreateDashboardRequest(Some("Test"))) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 404 for GET /api/dashboards/:id/panels without Authorization (non-public resource)" in {
      Get("/api/dashboards/some-id/panels") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 401 for POST /api/panels without Authorization" in {
      Post("/api/panels", CreatePanelRequest(Some("some-id"), Some("Test"), None, None)) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for an expired or unknown token" in {
      import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
      Get("/api/dashboards").withHeaders(Authorization(OAuth2BearerToken("unknown-bad-token"))) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for GET /api/connector-types without Authorization (HEL-484)" in {
      Get("/api/connector-types") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    // HEL-391: composed-route-tree coverage for GET /api/pipeline-shapes. This is the test that
    // would have caught the round-1 design-gate routing collision (design.md Risks;
    // skeptic-design-1.md change request 2) — it drives the request through the fully composed
    // `ApiRoutes` tree (not the isolated `PipelineShapeRoutes` route object covered by
    // `PipelineShapeRoutesSpec`), so a future mounting mistake that let `PipelineRoutes`'s
    // `path(PipelineIdSegment)` catch-all swallow `/api/pipeline-shapes` would fail here.
    "return 401 for GET /api/pipeline-shapes without Authorization (HEL-391)" in {
      Get("/api/pipeline-shapes") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 200 with the real shape catalog for GET /api/pipeline-shapes when authenticated (HEL-391)" in {
      Get("/api/pipeline-shapes") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val entries = responseAs[Vector[PipelineShapeCatalogEntryResponse]]
        entries.map(_.id) should contain("passthrough")
      }
    }

    // HEL-402: composed-route-tree coverage for POST /api/pipeline-shapes/:id/expand — the same
    // routing-collision guard as the GET catalog test above, but for the new expand endpoint.
    "return 401 for POST /api/pipeline-shapes/single-row/expand without Authorization (HEL-402)" in {
      Post("/api/pipeline-shapes/single-row/expand", ExpandPipelineShapeRequest(JsObject.empty)) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 200 and expand a real shape via POST /api/pipeline-shapes/:id/expand when authenticated (HEL-402)" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      Post("/api/pipeline-shapes/single-row/expand", ExpandPipelineShapeRequest(params)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val expansions = responseAs[Vector[ShapeStepExpansionResponse]]
        expansions.map(_.kind) shouldBe Vector("aggregate")
      }
    }

    // HEL-472 (420-A): composed-route-tree coverage for /api/preferences — proves the request
    // is rejected by the AuthDirectives layer itself (before ever reaching
    // agentPreferencesServiceOpt.fold(reject)), so this holds even though `rawRoutes()` doesn't
    // wire an AgentPreferencesRepository. Full GET/PUT round-trip coverage (default object,
    // full-replace semantics) lives in the isolated `AgentPreferencesRoutesSpec`.
    "return 401 for GET /api/preferences without Authorization (HEL-472)" in {
      Get("/api/preferences") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for PUT /api/preferences without Authorization (HEL-472)" in {
      val body = PutAgentPreferencesRequest(None, None, None, None)
      Put("/api/preferences", body) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    // HEL-531 (420-E): same composed-route-tree 401 coverage as the two /api/preferences tests
    // above — the dedicated memory-enabled endpoint sits behind the SAME AuthDirectives layer, so
    // this holds even though `rawRoutes()` doesn't wire an AgentPreferencesRepository either. Full
    // opt-out/opt-in round-trip coverage lives in the isolated `AgentPreferencesRoutesSpec`.
    "return 401 for PUT /api/preferences/memory-enabled without Authorization (HEL-531)" in {
      val body = PutMemoryEnabledRequest(memoryEnabled = false)
      Put("/api/preferences/memory-enabled", body) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    // HEL-478 (420-B): composed-route-tree coverage for /api/agent/memory — proves the request
    // is rejected by the AuthDirectives layer itself (before ever reaching
    // agentMemoryServiceOpt.fold(reject)), so this holds even though `rawRoutes()` doesn't wire
    // an AgentMemoryRepository. Full CRUD coverage (create-then-list, invalid-kind 400,
    // delete-then-404, clear-then-empty) lives in the isolated `AgentMemoryRoutesSpec`.
    "return 401 for GET /api/agent/memory without Authorization (HEL-478)" in {
      Get("/api/agent/memory") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for POST /api/agent/memory without Authorization (HEL-478)" in {
      Post("/api/agent/memory", CreateAgentMemoryRequest("fact", "something")) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for DELETE /api/agent/memory/:id without Authorization (HEL-478)" in {
      import java.util.UUID
      Delete(s"/api/agent/memory/${UUID.randomUUID()}") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for DELETE /api/agent/memory (clear all) without Authorization (HEL-478)" in {
      Delete("/api/agent/memory") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for GET /api/audit-events without Authorization (HEL-488)" in {
      Get("/api/audit-events") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    // HEL-704: composed-route-tree coverage for /api/beta-access — proves the request is
    // rejected by the AuthDirectives layer itself (before ever reaching
    // betaAccessServiceOpt.fold(reject)), so this holds even though `rawRoutes()` doesn't wire a
    // DbContext either. Full status-code coverage (204/409/503/502/429 for request, 200/400/409
    // for redeem) lives in the isolated `BetaAccessRoutesSpec`.
    "return 401 for POST /api/beta-access/request without Authorization (HEL-704)" in {
      Post("/api/beta-access/request") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "return 401 for POST /api/beta-access/redeem without Authorization (HEL-704)" in {
      Post("/api/beta-access/redeem", RedeemInviteCodeRequest("some-code")) ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Unauthorized"
      }
    }

    "POST /api/dashboards with valid token sets createdBy to the authenticated user ID" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(Some("Auth Dashboard"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[DashboardResponse]
        response.meta.createdBy shouldBe testUserId
      }
    }

    "POST /api/panels with valid token sets createdBy to the authenticated user ID" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Auth Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[PanelResponse]
        response.meta.createdBy shouldBe testUserId
      }
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  "POST /api/auth/register" should {

    "return 201 with token and user on successful registration" in {
      cleanDb()
      val req = RegisterRequest("test@example.com", "password123", Some("Test User"))
      Post("/api/auth/register", req) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[AuthResponse]
        resp.expiresAt should not be empty
        resp.user.email shouldBe "test@example.com"
        resp.user.displayName shouldBe Some("Test User")
        resp.user.id should not be empty
        // HEL-703: a non-allowlisted email (the test harness's default, empty allowlist) defaults
        // to `free`.
        resp.user.tier shouldBe "free"
        // HEL-287 CodeQL #8: the session token is delivered via `Set-Cookie`
        // only — never in the JSON body.
        sessionCookieValue(response) should not be empty
        val body = responseAs[String]
        body should not include "password_hash"
        body should not include "passwordHash"
        body should not include "\"token\""
      }
    }

    "sets Set-Cookie with HttpOnly, Path=/, Max-Age=2592000 (30 days), and dev SameSite=Lax (design.md D1)" in {
      cleanDb()
      val req = RegisterRequest("cookie-attrs@example.com", "password123", None)
      Post("/api/auth/register", req) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val cookieHeaderValue = header[`Set-Cookie`].map(_.value).getOrElse(fail("no Set-Cookie header"))
        cookieHeaderValue should include("HttpOnly")
        cookieHeaderValue should include("Path=/")
        cookieHeaderValue should include("Max-Age=2592000")
        cookieHeaderValue should include("SameSite=Lax")
        // Test fixtures use the default (dev-shaped) CookieConfig(secure=false);
        // Secure only appears when COOKIE_SECURE=true (prod), see CookieConfig.
        cookieHeaderValue should not include "Secure"
      }
    }

    "return 409 on duplicate email" in {
      cleanDb()
      val req = RegisterRequest("dup@example.com", "password123", None)
      Post("/api/auth/register", req) ~> routes() ~> check { status shouldBe StatusCodes.Created }
      Post("/api/auth/register", req) ~> routes() ~> check {
        status shouldBe StatusCodes.Conflict
        responseAs[ErrorResponse].message should include("email")
      }
    }

    "return 400 on invalid email format" in {
      cleanDb()
      val req = RegisterRequest("not-an-email", "password123", None)
      Post("/api/auth/register", req) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("email")
      }
    }

    "return 400 when password is too short" in {
      cleanDb()
      val req = RegisterRequest("short@example.com", "abc", None)
      Post("/api/auth/register", req) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("password")
      }
    }

    "return 400 when required fields are absent from JSON payload" in {
      cleanDb()
      Post(
        "/api/auth/register",
        HttpEntity(ContentTypes.`application/json`, """{"displayName":"NoEmailOrPassword"}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "POST /api/auth/login" should {

    "return 200 with token and user on successful login" in {
      cleanDb()
      Post("/api/auth/register", RegisterRequest("login@example.com", "password123", None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/auth/login", LoginRequest("login@example.com", "password123")) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AuthResponse]
        resp.user.email shouldBe "login@example.com"
        resp.user.tier shouldBe "free"
        sessionCookieValue(response) should not be empty
        val body = responseAs[String]
        body should not include "password_hash"
        body should not include "passwordHash"
        body should not include "\"token\""
      }
    }

    "return 401 with generic message on wrong password" in {
      cleanDb()
      Post("/api/auth/register", RegisterRequest("wrong@example.com", "correctpass", None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/auth/login", LoginRequest("wrong@example.com", "wrongpassword")) ~> routes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Invalid email or password"
      }
    }

    "return 401 with identical generic message on unknown email" in {
      cleanDb()
      Post("/api/auth/login", LoginRequest("nobody@example.com", "somepassword")) ~> routes() ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Invalid email or password"
      }
    }

    "return 400 when fields are empty" in {
      cleanDb()
      Post("/api/auth/login", LoginRequest("", "")) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "POST /api/auth/logout" should {

    "return 204 and invalidate the token so a second logout returns 401" in {
      cleanDb()
      var token = ""
      // logout now resolves identity via authDirectives.authenticate, which
      // must look the cookie up in a real session store — the stub-backed
      // routes() harness only recognizes its two fixed test tokens, so this
      // round-trip needs realSessionRoutes() (see the "GET /api/auth/me"
      // tests below for the same requirement).
      Post("/api/auth/register", RegisterRequest("logout@example.com", "password123", None)) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Created
        token = sessionCookieValue(response)
      }
      Post("/api/auth/logout").withHeaders(Cookie(SessionCookies.Name -> token), csrfHeader) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.NoContent
        // Clears the cookie (Max-Age=0) so the browser drops it immediately.
        header[`Set-Cookie`].map(_.value) should contain("helio_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax")
      }
      Post("/api/auth/logout").withHeaders(Cookie(SessionCookies.Name -> token), csrfHeader) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return 401 when no session cookie is provided" in {
      cleanDb()
      Post("/api/auth/logout") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return 401 for an unrecognised session cookie" in {
      cleanDb()
      Post("/api/auth/logout").withHeaders(Cookie(SessionCookies.Name -> "deadbeefdeadbeef"), csrfHeader) ~> routes() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }

  // ── Session token hashing at rest (HEL-288) ─────────────────────────────────

  "user_sessions token hashing" should {

    "persist only the SHA-256 hex digest of the raw session token, never the raw value" in {
      cleanDb()
      var token = ""
      Post("/api/auth/register", RegisterRequest("hash-check@example.com", "password123", None)) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Created
        token = sessionCookieValue(response)
      }

      import slick.jdbc.PostgresProfile.api._
      val expectedHash = TokenHashing.sha256Hex(token)
      val storedHash = await(
        db.run(sql"SELECT token_hash FROM user_sessions WHERE token_hash = $expectedHash".as[String].head)
      )
      storedHash shouldBe expectedHash
      storedHash should not be token

      // The raw token exists nowhere in the column.
      val rawHits = await(db.run(sql"SELECT COUNT(*) FROM user_sessions WHERE token_hash = $token".as[Int].head))
      rawHits shouldBe 0
    }

    "round-trip createSession / findSession / deleteSession / findValidSession by hashing the raw token at every lookup" in {
      cleanDb()
      val userId    = UserId(testUserId)
      val now       = java.time.Instant.now()
      val rawToken  = "repo-roundtrip-raw-token"
      val session   = UserSession(token = rawToken, userId = userId, createdAt = now, expiresAt = now.plusSeconds(3600))

      val created = await(userRepo.createSession(session))
      created.token shouldBe rawToken // createSession returns the original raw-token session unchanged

      // findValidSession (the hot auth path) hashes the incoming raw token to match the stored hash.
      await(realSessionRepo.findValidSession(rawToken)) shouldBe Some(AuthenticatedUser(userId))
      // The already-hashed value is not itself a valid raw token at lookup time.
      await(realSessionRepo.findValidSession(TokenHashing.sha256Hex(rawToken))) shouldBe None

      // findSession hashes the incoming raw token and returns the raw token back on the domain object.
      val found = await(userRepo.findSession(rawToken))
      found.map(_.token) shouldBe Some(rawToken)
      found.map(_.userId) shouldBe Some(userId)

      // deleteSession hashes the incoming raw token before deleting.
      await(userRepo.deleteSession(rawToken))
      await(userRepo.findSession(rawToken)) shouldBe None
      await(realSessionRepo.findValidSession(rawToken)) shouldBe None
    }
  }

  // ── Ownership enforcement ────────────────────────────────────────────────────

  "Ownership enforcement" should {

    "GET /api/dashboards returns only the calling user's dashboards" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      // Create a dashboard as testUser via the API
      Post("/api/dashboards", CreateDashboardRequest(Some("My Dashboard"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      // Insert a dashboard directly belonging to a different user
      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-1', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))

      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[PagedResult[DashboardResponse]].items
        items should have size 1
        items.head.name shouldBe "My Dashboard"
      }
    }

    "PATCH /api/dashboards/:id returns 404 when caller has no grant on the dashboard (HEL-265 CS4)" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      // Insert a dashboard owned by another user (testUser has no grant)
      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-2', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))

      Patch("/api/dashboards/other-dash-2", UpdateDashboardRequest(name = Some("Hacked"), appearance = None, layout = None)) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "DELETE /api/dashboards/:id returns 404 when caller has no grant on the dashboard (HEL-265 CS4)" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-3', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))

      Delete("/api/dashboards/other-dash-3") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET /api/dashboards/:id/panels returns 403 when caller does not own the dashboard" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-4', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))

      Get("/api/dashboards/other-dash-4/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse].message shouldBe "Forbidden"
      }
    }

    "PATCH /api/panels/:id returns 403 when caller does not own the panel" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-5', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))
      await(db.run(sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id) VALUES ('other-panel-1', 'other-dash-5', 'Other Panel', 'other-user', now(), now(), '{"background":"transparent","color":"inherit","transparency":0.0}', 'metric', '00000000-0000-0000-0000-000000000098')"""))

      Patch("/api/panels/other-panel-1", UpdatePanelRequest(title = Some("Hacked"), appearance = None, `type` = None, config = None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse].message shouldBe "Forbidden"
      }
    }

    "DELETE /api/panels/:id returns 403 when caller does not own the panel" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-6', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))
      await(db.run(sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id) VALUES ('other-panel-2', 'other-dash-6', 'Other Panel', 'other-user', now(), now(), '{"background":"transparent","color":"inherit","transparency":0.0}', 'metric', '00000000-0000-0000-0000-000000000098')"""))

      Delete("/api/panels/other-panel-2") ~> routes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse].message shouldBe "Forbidden"
      }
    }

    "POST /api/panels/:id/duplicate sets the calling user as owner of the new panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None, None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      var dupId = ""
      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dupId = responseAs[PanelResponse].id
      }

      val dupPanel = await(panelRepo.findByIdInternal(PanelId(dupId)))
      dupPanel.isDefined shouldBe true
      dupPanel.get.ownerId shouldBe UserId(testUserId)
    }

    "POST /api/panels/:id/duplicate returns 403 when caller does not own the source panel" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._

      await(db.run(sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id) VALUES ('other-dash-7', 'Other Dashboard', 'other-user', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '00000000-0000-0000-0000-000000000098')"""))
      await(db.run(sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id) VALUES ('other-panel-3', 'other-dash-7', 'Other Panel', 'other-user', now(), now(), '{"background":"transparent","color":"inherit","transparency":0.0}', 'metric', '00000000-0000-0000-0000-000000000098')"""))

      Post("/api/panels/other-panel-3/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse].message shouldBe "Forbidden"
      }
    }
  }
  // ── DataSource ACL tests (Task 7.3) ─────────────────────────────────────────

  "DataSource ownership enforcement" should {

    "GET /api/data-sources returns only sources owned by the authenticated user" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      // testUser creates a source via the API
      Post("/api/data-sources", HttpEntity(ContentTypes.`application/json`,
        """{"name":"My Source","type":"static","columns":[{"name":"id","type":"integer"}],"rows":[]}"""
      )) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      // Insert a source owned by another user directly
      val otherId = UUID.randomUUID().toString
      val now = Instant.now()
      await(dataSourceRepo.insert(StaticSource(
        id        = DataSourceId(otherId),
        name      = "Other Source",
        ownerId   = UserId(otherUserId),
        createdAt = now,
        updatedAt = now
      ), otherUser))

      Get("/api/data-sources") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[PagedResult[DataSourceResponse]].items
        items.map(_.name) should contain ("My Source")
        items.map(_.name) should not contain "Other Source"
      }
    }

    "DELETE /api/data-sources/:id returns 404 when caller does not own the source (HEL-265 CS3)" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID

      var sourceId = ""
      Post("/api/data-sources", HttpEntity(ContentTypes.`application/json`,
        """{"name":"Protected Source","type":"static","columns":[{"name":"x","type":"string"}],"rows":[]}"""
      )) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        sourceId = responseAs[DataSourceResponse].id
      }

      // otherUser tries to delete it — returns 404, not 403 (existence is not leaked)
      Delete(s"/api/data-sources/$sourceId") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET /api/data-sources/:id/preview returns 404 when caller does not own the source (HEL-265 CS3)" in {
      cleanDb()
      var sourceId = ""
      Post("/api/data-sources", HttpEntity(ContentTypes.`application/json`,
        """{"name":"Private Source","type":"static","columns":[{"name":"x","type":"string"}],"rows":[["hello"]]}"""
      )) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        sourceId = responseAs[DataSourceResponse].id
      }

      Get(s"/api/data-sources/$sourceId/preview") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── DataType ACL tests (Task 7.4) ────────────────────────────────────────────

  "DataType ownership enforcement" should {

    "GET /api/types returns only types owned by the authenticated user" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      // HEL-904: `POST /api/data-sources` no longer auto-creates a companion DataType — insert
      // testUser's type directly to exercise the still-live DataTypeRoutes ACL surface.
      val userDt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "User Type",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = testUser.id
      )
      await(dataTypeRepo.insert(userDt, testUser))

      // Insert a type owned by another user directly
      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "Other Type",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = UserId(otherUserId)
      )
      await(dataTypeRepo.insert(dt, testUser))

      Get("/api/types") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val types = responseAs[PagedResult[DataTypeResponse]]
        types.items.map(_.name) should contain ("User Type")
        types.items.map(_.name) should not contain "Other Type"
      }
    }

    "PATCH /api/types/:id returns 404 when caller does not own the type (HEL-265 CS3)" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      // HEL-904: `POST /api/data-sources` no longer auto-creates a companion DataType.
      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "My Type",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = testUser.id
      )
      await(dataTypeRepo.insert(dt, testUser))
      val typeId = dt.id.value

      // otherUser tries to PATCH it — returns 404, not 403 (existence is not leaked)
      Patch(s"/api/types/$typeId",
        UpdateDataTypeRequest(name = Some("Hacked"), fields = None)
      ) ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "DELETE /api/types/:id returns 404 when caller does not own the type (HEL-265 CS3)" in {
      cleanDb()
      import com.helio.domain.model._
      import java.time.Instant
      import java.util.UUID

      // HEL-904: `POST /api/data-sources` no longer auto-creates a companion DataType.
      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "My Type2",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = testUser.id
      )
      await(dataTypeRepo.insert(dt, testUser))
      val typeId = dt.id.value

      // otherUser tries to DELETE it — returns 404, not 403 (existence is not leaked)
      Delete(s"/api/types/$typeId") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // HEL-904 task 4.1: the "Cross-user panel type binding" test (Task 7.5) is
  // removed outright -- Text/Markdown's data-bound "Source mode" no longer
  // exists, so a panel can no longer carry a `type_id` binding to leak
  // cross-user in the first place.

  "GET /api/auth/me" should {

    "return 200 with user info for a valid token" in {
      cleanDb()
      var token = ""
      // Register via realSessionRoutes to get a real DB session token
      Post("/api/auth/register", RegisterRequest("me@example.com", "password123", Some("Me User"))) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Created
        token = sessionCookieValue(response)
      }
      Get("/api/auth/me").withHeaders(Cookie(SessionCookies.Name -> token)) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val user = responseAs[UserResponse]
        user.email shouldBe "me@example.com"
        user.displayName shouldBe Some("Me User")
        user.id should not be empty
        user.tier shouldBe "free"
      }
    }

    "return 401 for an expired or unknown token" in {
      cleanDb()
      Get("/api/auth/me").withHeaders(Cookie(SessionCookies.Name -> "deadbeef00000000")) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return 401 when no session cookie is provided" in {
      cleanDb()
      Get("/api/auth/me") ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }

  "GET /api/auth/me unexpected internal failure" should {

    // HEL-311: if the user-lookup future fails unexpectedly, the route must
    // return a generic 500 that does NOT leak the exception message
    // (previously it returned `ex.getMessage` in the body), and must log the
    // full exception + stack trace server-side.
    "return a generic 500 without leaking the exception message, and log the detail" in {
      cleanDb()
      var token = ""
      Post("/api/auth/register", RegisterRequest("me-fail@example.com", "password123", None)) ~> realSessionRoutes() ~> check {
        status shouldBe StatusCodes.Created
        token = sessionCookieValue(response)
      }

      val secret = "leaky-internal-detail-should-not-surface-hel311"
      val failingUserRepo = new UserRepository(db)(typedSystem.executionContext) {
        override def findById(userId: UserId): Future[Option[User]] =
          Future.failed(new RuntimeException(secret))
      }
      val failingRoutes: Route = new ApiRoutes(
        dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem,
        stubConnector(Left("no real HTTP in tests")), failingUserRepo, realSessionRepo, userPreferenceRepo,
        pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
        new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext)
      ).routes

      val logbackLogger = LoggerFactory.getLogger(classOf[ApiRoutes]).asInstanceOf[LogbackLogger]
      val appender       = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        Get("/api/auth/me").withHeaders(Cookie(SessionCookies.Name -> token)) ~> failingRoutes ~> check {
          status shouldBe StatusCodes.InternalServerError
          val body = responseAs[String]
          body should not include secret
          body should include("Internal server error")
        }

        import scala.jdk.CollectionConverters._
        val events = appender.list.asScala.toSeq
        val logged = events.find(e => Option(e.getThrowableProxy).exists(_.getMessage == secret))
        logged shouldBe defined
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }

  "ACL enforcement on DashboardRoutes" should {

    "allow owner to PATCH their own dashboard" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Owner Dash"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(Some("Renamed"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DashboardResponse].name shouldBe "Renamed"
      }
    }

    "return 404 when non-owner (no grant) attempts PATCH on dashboard (HEL-265 CS4)" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Owner Dash"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      // otherUser has no grant → 404 (no existence leak)
      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(Some("Hacked"), None, None)) ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "allow owner to DELETE their own dashboard" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("To Delete"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      Delete(s"/api/dashboards/$dashboardId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }

    "return 404 when non-owner (no grant) attempts DELETE on dashboard (HEL-265 CS4)" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Protected Dash"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      // otherUser has no grant → 404 (no existence leak)
      Delete(s"/api/dashboards/$dashboardId") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 403 when non-owner attempts GET on dashboard panels" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Panels Dash"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      Get(s"/api/dashboards/$dashboardId/panels") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "return 404 when non-owner (no grant) attempts duplicate on dashboard (HEL-265 CS4)" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Dup Dash"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      // otherUser has no grant → 404 (no existence leak)
      Post(s"/api/dashboards/$dashboardId/duplicate") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 when non-owner (no grant) attempts export on dashboard (HEL-265 CS4)" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Export Dash"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      // otherUser has no grant → 404 (no existence leak)
      Get(s"/api/dashboards/$dashboardId/export") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "ACL enforcement on PanelRoutes" should {

    "allow owner to PATCH their own panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("D"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      Patch(s"/api/panels/$panelId", UpdatePanelRequest(Some("Renamed Panel"), None, None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PanelResponse].title shouldBe "Renamed Panel"
      }
    }

    "return 403 when non-owner attempts PATCH on panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("D"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      Patch(s"/api/panels/$panelId", UpdatePanelRequest(Some("Hacked"), None, None, None)) ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "allow owner to DELETE their own panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("D"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("To Delete"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      Delete(s"/api/panels/$panelId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }

    "return 403 when non-owner attempts DELETE on panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("D"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Protected Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      Delete(s"/api/panels/$panelId") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "return 403 when non-owner attempts duplicate on panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("D"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Dup Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      Post(s"/api/panels/$panelId/duplicate") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }
  }

  // ── 8.2 PermissionRoutes integration tests ────────────────────────────────

  "PermissionRoutes" should {

    "grant permission and return 201 with the grant details" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Shared"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      val body = s"""{"granteeId":"$otherUserId","role":"viewer"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PermissionResponse]
        resp.granteeId shouldBe Some(otherUserId)
        resp.role shouldBe "viewer"
        resp.createdAt should not be empty
      }
    }

    "return 409 Conflict when the same grant is created twice" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Dup Perm"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      val body = s"""{"granteeId":"$otherUserId","role":"viewer"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.Conflict
      }
    }

    "revoke permission and return 204" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Revoke Test"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      val body = s"""{"granteeId":"$otherUserId","role":"editor"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Delete(s"/api/dashboards/$dashboardId/permissions/$otherUserId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }

    "list all grants for a dashboard (owner only)" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("List Perms"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      val body = s"""{"granteeId":"$otherUserId","role":"viewer"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Get(s"/api/dashboards/$dashboardId/permissions") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PermissionsResponse]
        resp.items should have size 1
        resp.items.head.granteeId shouldBe Some(otherUserId)
        resp.items.head.role shouldBe "viewer"
      }
    }

    "return 403 when a non-owner tries to manage permissions" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Protected"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      val body = s"""{"granteeId":"$testUserId","role":"viewer"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
      Get(s"/api/dashboards/$dashboardId/permissions") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }
  }

  // ── 8.3 Public panel read integration tests ───────────────────────────────

  "Public panel access" should {

    "return 200 for unauthenticated request on a public dashboard" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Public"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Public Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      // Grant public viewer access (no granteeId)
      val body = """{"role":"viewer"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Get(s"/api/dashboards/$dashboardId/panels") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PagedResult[PanelResponse]]
        resp.items should have size 1
        resp.items.head.id shouldBe panelId
      }
    }

    "return 404 for unauthenticated request on a non-public dashboard" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Private"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      // No public grant — unauthenticated access should be hidden
      Get(s"/api/dashboards/$dashboardId/panels") ~> rawRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── 8.4 Editor / viewer access integration tests ─────────────────────────

  "Editor and viewer access" should {

    "allow an editor to PATCH a panel on the shared dashboard" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Edit Test"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Editable"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      val grantBody = s"""{"granteeId":"$otherUserId","role":"editor"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, grantBody)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      // otherUser patches the panel — should succeed
      val patchBody = """{"title":"Updated by Editor"}"""
      Patch(s"/api/panels/$panelId", HttpEntity(ContentTypes.`application/json`, patchBody)) ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PanelResponse].title shouldBe "Updated by Editor"
      }
    }

    "prevent an editor from deleting the dashboard" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("No Delete"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      val grantBody = s"""{"granteeId":"$otherUserId","role":"editor"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, grantBody)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      // otherUser tries to delete the dashboard — should be forbidden
      Delete(s"/api/dashboards/$dashboardId") ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }

    "prevent a viewer from patching a panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("View Only"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Read Only Panel"), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }
      val grantBody = s"""{"granteeId":"$otherUserId","role":"viewer"}"""
      Post(s"/api/dashboards/$dashboardId/permissions", HttpEntity(ContentTypes.`application/json`, grantBody)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      // otherUser tries to patch the panel — should be forbidden
      val patchBody = """{"title":"Viewer Attempt"}"""
      Patch(s"/api/panels/$panelId", HttpEntity(ContentTypes.`application/json`, patchBody)) ~> otherUserRoutes() ~> check {
        status shouldBe StatusCodes.Forbidden
        responseAs[ErrorResponse] shouldBe ErrorResponse("Forbidden")
      }
    }
  }

  "PATCH /api/users/me/update" should {
    "return 200 with updated preferences when updating accent color" in {
      cleanDb()
      val body = """{"fields":["accentColor"],"user":{"accentColor":"#3b82f6"}}"""
      Patch("/api/users/me/update", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val prefs = responseAs[UserPreferences]
        prefs.accentColor shouldBe Some("#3b82f6")
        prefs.zoomLevels shouldBe Map.empty
      }
    }

    "return 200 with updated preferences when updating zoom level" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(Some("Test"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val dashboard = responseAs[DashboardResponse]

        // Now update zoom level for that dashboard
        val body = s"""{"fields":["zoomLevel"],"user":{"zoomLevel":1.5,"dashboardId":"${dashboard.id}"}}"""
        Patch("/api/users/me/update", HttpEntity(ContentTypes.`application/json`, body)) ~> routes() ~> check {
          status shouldBe StatusCodes.OK
          val prefs = responseAs[UserPreferences]
          prefs.zoomLevels should contain key dashboard.id
          prefs.zoomLevels(dashboard.id) shouldBe 1.5
        }
      }
    }
  }

  "GET /api/auth/me" should {
    "return user with preferences field" in {
      cleanDb()
      val saveBody = """{"fields":["accentColor"],"user":{"accentColor":"#f97316"}}"""
      Patch("/api/users/me/update", HttpEntity(ContentTypes.`application/json`, saveBody)) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      // Now fetch /api/auth/me and verify preferences are included
      Get("/api/auth/me") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val user = responseAs[UserResponse]
        user.id shouldBe testUserId
        user.preferences should not be None
        user.preferences.get.accentColor shouldBe Some("#f97316")
      }
    }
  }

  "POST /api/panels with type: markdown" should {
    "return 201 with content field present" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("MD Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Notes"), Some("markdown"), Some(JsObject("content" -> JsString("# Hello"))))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[PanelResponse]
        response.`type`                            shouldBe "markdown"
        response.config.asJsObject.fields("content") shouldBe JsString("# Hello")
      }
    }

    "return empty content when no content is provided" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("MD Test 2"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Empty"), Some("markdown"), None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[PanelResponse]
        response.`type`                            shouldBe "markdown"
        response.config.asJsObject.fields("content") shouldBe JsString("")
      }
    }
  }

  "PATCH /api/panels/:id updating content" should {
    "update content on a markdown panel and return 200" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("MD PATCH Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Notes"), Some("markdown"), None)
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        HttpEntity(ContentTypes.`application/json`, """{"config":{"content":"## Updated"}}""")
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.config.asJsObject.fields("content") shouldBe JsString("## Updated")
      }
    }
  }

  "PATCH /api/panels/:id updating divider fields" should {

    "set divider config fields and return 200" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Divider Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Rule"), Some("divider"), None)
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
        val resp = responseAs[PanelResponse]
        resp.`type` shouldBe "divider"
      }

      Patch(
        s"/api/panels/$panelId",
        HttpEntity(ContentTypes.`application/json`,
          """{"config":{"orientation":"vertical","weight":4,"color":"#ff0000"}}""")
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp   = responseAs[PanelResponse]
        val config = resp.config.asJsObject.fields
        config("orientation") shouldBe JsString("vertical")
        config("weight")      shouldBe JsNumber(4)
        config("color")       shouldBe JsString("#ff0000")
      }
    }

    "leave divider config fields unchanged when not sent in PATCH" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Divider No-op Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Ruled"), Some("divider"), None)
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        HttpEntity(ContentTypes.`application/json`,
          """{"config":{"orientation":"horizontal","weight":3,"color":"#0000ff"}}""")
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Patch(
        s"/api/panels/$panelId",
        HttpEntity(ContentTypes.`application/json`, """{"title":"Renamed Rule"}""")
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp   = responseAs[PanelResponse]
        val config = resp.config.asJsObject.fields
        config("orientation") shouldBe JsString("horizontal")
        config("weight")      shouldBe JsNumber(3)
        config("color")       shouldBe JsString("#0000ff")
      }
    }

    "reject invalid divider orientation with 400" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Divider Validation Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Bad Rule"), Some("divider"), None)
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        HttpEntity(ContentTypes.`application/json`, """{"config":{"orientation":"diagonal"}}""")
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "GET /api/dashboards/:id/panels — config payload by type" should {

    "return a metric config (no divider fields) for a metric panel" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Null Divider Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      // HEL-904 task 3.8/3.9: `outputs.id` is a real FK (panels.output_id
      // REFERENCES outputs(id)) — an arbitrary non-existent id 500s on
      // insert (FK violation), not the 400 an app-level check would give
      // (PanelService's own output-existence validation is real, separate
      // follow-on work — see PanelBatchCreateSpec's own note on this same
      // gap). Seed a real pipeline + Output so this test's actual subject
      // (an output-kind panel's config carries no divider fields) is
      // exercised without tripping that gap.
      val dsId = UUID.randomUUID().toString
      val dtId = UUID.randomUUID().toString
      val pidId = UUID.randomUUID().toString
      val outputId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $testUserId::uuid, now(), now())""",
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'mytype', '[]', 1, $testUserId::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pidId, 'pipe', $dsId, $dtId, $testUserId::uuid, now(), now())""",
        sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, schema, position, created_at, updated_at)
               VALUES ($outputId, $pidId, NULL, $testUserId::uuid, 'KPI', 'table', '{}'::jsonb, '[]'::jsonb, 0, now(), now())"""
      )))

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("KPI"), Some("output"), Some(JsObject("outputId" -> JsString(outputId))))
      ) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val panels = responseAs[PagedResult[PanelResponse]].items
        val panel  = panels.find(_.id == panelId).get
        val config = panel.config.asJsObject.fields
        panel.`type` shouldBe "output"
        config.contains("orientation") shouldBe false
        config.contains("weight")      shouldBe false
        config.contains("color")       shouldBe false
      }
    }

    // HEL-904 task 4.1: `dataAsOf`'s only producer (the `dataTypeId`-keyed
    // `PipelineRepository.findLastRunAtByOutputDataTypeId` lookup) was
    // removed outright -- no panel can carry a `dataTypeId` binding anymore,
    // so `dataAsOf` is now unconditionally `None` for every panel, regardless
    // of kind. The prior "bound panel resolves an ISO timestamp" scenario is
    // therefore removed; the remaining scenario below is renamed to reflect
    // that `dataAsOf` is dead-but-not-yet-deleted wire shape, not a live
    // per-panel computation.

    "return dataAsOf null for every panel (the feature is retired, task 4.1)" in {
      cleanDb()

      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Unbound Panel Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      // text panel — no dataTypeId binding
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Text Panel"), Some("text"), None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val panels = responseAs[PanelsResponse].items
        val panel  = panels.find(_.id == panelId).get
        panel.dataAsOf shouldBe None
      }
    }
  }

  // ── Pagination route tests (HEL-133, tasks 7.5-7.7) ───────────────────────

  "GET /api/dashboards pagination" should {

    "apply default offset=0 and limit=200 when no params provided" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(Some("Test"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PagedResult[DashboardResponse]]
        result.offset shouldBe 0
        result.limit  shouldBe Page.Default.limit
        result.total  shouldBe 1
        result.items  should have size 1
      }
    }

    "clamp limit to 500 when limit=9999 is provided" in {
      cleanDb()
      Get("/api/dashboards?limit=9999") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PagedResult[DashboardResponse]]
        result.limit shouldBe Page.MaxLimit
      }
    }

    "return 400 for negative offset" in {
      Get("/api/dashboards?offset=-1") ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message shouldBe "offset must not be negative"
      }
    }
  }

}
