package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader, `Set-Cookie`}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.protocols.auth.{AuthResponse, LoginRequest, MfaConfirmRequest, MfaEnrollResponse, MfaRequiredResponse, MfaVerifyRequest, RegisterRequest}
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse, DashboardSnapshotPayload, DuplicateDashboardResponse, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{CreatePanelBatchItem, CreatePanelRequest, CreatePanelsBatchRequest, CreatePanelsBatchResponse, PanelBatchItem, PanelResponse, UpdatePanelsBatchRequest}
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel, ReplaceDashboardContentsRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse, ReorderPipelineStepsRequest}
import com.helio.api.protocols.sources.{CreateSourceRequest, CreateSourceResponse, DataSourceResponse, RestApiConfigPayload, SqlCreateSourceRequest, SqlSourceConfigPayload, StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{ApiTokenId, AuditEvent, AuditEventId, AuditSource, AuthenticatedUser, CsvSource, DataField, DataSource, DataSourceId, DataSourceKind, DataType, DataTypeId, MetricDefinition, MetricFormat, MetricId, UserId, UserSession}
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, ConnectorCredentialRepository, MfaRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.{Database, DbContext}
import com.helio.api.protocols.workspace.{TeardownRequest, TeardownResponse}
import com.helio.infrastructure.storage.{FileSystem, ListPage, LocalFileSystem}
import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testsupport.PdfFixtures
import spray.json._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import javax.imageio.ImageIO
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** HEL-477 tasks.md 7.2-7.4/7.6 — integration coverage for audit
 *  instrumentation, exercised through the real route -> service -> audit
 *  repository chain (an embedded Postgres `AuditEventRepository`, not a
 *  stub), per the ticket's acceptance criteria ("integration tests using the
 *  route testkit + a real/embedded audit repo"). */
class AuditMutationInstrumentationSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var dataTypeRepo: DataTypeRepository              = _
  private var userRepo: UserRepository                     = _
  private var userPreferenceRepo: UserPreferenceRepository = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository              = _
  private var pipelineStepRepo: PipelineStepRepository      = _
  private var auditEventRepo: AuditEventRepository          = _
  private var apiTokenRepo: ApiTokenRepository               = _
  private var mfaRepo: MfaRepository                        = _
  private var metricRepo: MetricRepository                  = _
  private var realSessionRepo: SlickUserSessionRepository   = _
  // HEL-838 tasks.md 2.1: simplified `DbContext(db, db)` pattern (both pools
  // the same superuser connection) — this spec doesn't exercise RLS, only
  // audit-row wiring, so `WorkspaceTeardownServiceSpec`'s dual-role harness
  // is unnecessary here. Needed so `workspaceTeardownServiceOpt` is `Some`
  // and `POST /api/workspace/teardown` is mounted (task 2.1).
  private var dbContext: DbContext                          = _
  private var connectorRepo: ConnectorRepository             = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))

    val ctx            = new DbContext(db, db)(typedSystem.executionContext)
    dashboardRepo      = new DashboardRepository(ctx)(typedSystem.executionContext)
    panelRepo          = new PanelRepository(ctx)(typedSystem.executionContext)
    dataSourceRepo     = new DataSourceRepository(ctx)(typedSystem.executionContext)
    dataTypeRepo       = new DataTypeRepository(ctx)(typedSystem.executionContext)
    userRepo           = new UserRepository(db)(typedSystem.executionContext)
    userPreferenceRepo = new UserPreferenceRepository(db)(typedSystem.executionContext)
    permissionRepo     = new ResourcePermissionRepository(ctx)(typedSystem.executionContext)
    pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(typedSystem.executionContext)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(typedSystem.executionContext)
    auditEventRepo     = new AuditEventRepository(ctx)(typedSystem.executionContext)
    apiTokenRepo       = new ApiTokenRepository(ctx)(typedSystem.executionContext)
    mfaRepo            = new MfaRepository(db)(typedSystem.executionContext)
    metricRepo         = new MetricRepository(ctx)(typedSystem.executionContext)
    realSessionRepo    = new SlickUserSessionRepository(db)(typedSystem.executionContext)
    dbContext          = ctx
    // HEL-822: real ConnectorRepository fixture for the direct SourceService.createRest(...)
    // unit-level tests below, which need a repository to synthesize an implicit Connector
    // through for their bare-`url` requests.
    connectorRepo      = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    // HEL-471: audit_events is append-only (BEFORE TRUNCATE/UPDATE/DELETE
    // trigger) — it cannot be part of the TRUNCATE statement below. DELETE
    // is also rejected by the same trigger, so each test's fixture data is
    // cleared, and audit rows are read (never wiped) per test via the
    // per-test filtering `allAuditRows()` already does on `action`.
    await(db.run(sqlu"TRUNCATE TABLE api_tokens, resource_permissions, user_sessions, users, panels, dashboards, data_types, data_sources RESTART IDENTITY CASCADE"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ('00000000-0000-0000-0000-000000000099'::uuid, 'test@helio.test', now())"""))
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                           = Future.successful(())
    def exists(path: String): Future[Boolean]                                                        = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private def stubConnector: RestApiConnectorDriver = new RestApiConnectorDriver(Some(_ => Future.successful(Left("no real HTTP in tests"))))

  private val testUserId = "00000000-0000-0000-0000-000000000099"
  private val testToken  = "valid-test-token"
  private val testUser   = AuthenticatedUser(UserId(testUserId))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == testToken) Some(testUser) else None)
  }

  /** `auditEventRepo` is always the real, embedded-Postgres-backed repo —
   *  this is the "real/embedded audit repo" the acceptance criteria ask for. */
  private def routesFor(): Route = {
    val raw = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem, stubConnector,
      userRepo, stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      auditEventRepo = auditEventRepo,
      mfaRepo = mfaRepo,
      metricRepo = metricRepo,
      apiTokenRepo = apiTokenRepo,
      dbContext = dbContext
    ).routes
    val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
    Directives.mapRequest { (req: HttpRequest) =>
      val withCookie = req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken))
      withCookie.withHeaders(withCookie.headers :+ csrfHeader)
    } {
      raw
    }
  }

  /** Same wiring as [[routesFor]] but WITHOUT the automatic session-cookie
   *  injection (HEL-483) — needed so a test can supply its own credential
   *  (a PAT bearer header, specifically) without the cookie taking priority
   *  per `AuthDirectives.resolveIdentity`'s session-over-header precedence. */
  private def rawRoutesFor(): Route =
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem, stubConnector,
      userRepo, stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      auditEventRepo = auditEventRepo,
      mfaRepo = mfaRepo,
      metricRepo = metricRepo,
      apiTokenRepo = apiTokenRepo
    ).routes

  /** Routes backed by the REAL, embedded-Postgres `SlickUserSessionRepository`
   *  — `routesFor()`'s `stubSessionRepo` only resolves the one fixed
   *  `testToken`, so it cannot authenticate a session token minted by an
   *  actual `POST /api/auth/register`/`login` call. Used by the MFA and
   *  proposal-apply-rollback tests, which need to log in as a real user and
   *  carry that user's own session cookie (no default credential injected —
   *  callers supply their own via `Cookie`/CSRF headers). */
  private def realSessionRoutesFor(): Route =
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem, stubConnector,
      userRepo, realSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      auditEventRepo = auditEventRepo,
      mfaRepo = mfaRepo,
      metricRepo = metricRepo,
      apiTokenRepo = apiTokenRepo
    ).routes

  private val csrfHeaderValue = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  /** `realSessionRoutesFor()`, wrapped so every request carries `token`'s
   *  session cookie + the CSRF header — mirrors `MfaApiRoutesSpec.
   *  authedRoutes`/`ApiRoutesSpec.withDefaultCredentials`. */
  private def authedRealRoutes(token: String): Route =
    Directives.mapRequest { (req: HttpRequest) =>
      req.withHeaders(req.headers ++ Seq(Cookie(SessionCookies.Name -> token), csrfHeaderValue))
    } {
      realSessionRoutesFor()
    }

  /** `AuditService.record` is fire-and-forget (never awaited into the
   *  response chain — design.md Decision 2), so the audit row can persist
   *  slightly AFTER the HTTP response the route test's `check {}` block
   *  observes. Polls briefly instead of asserting immediately. */
  private def eventuallyAuditRows(predicate: AuditEvent => Boolean): Seq[AuditEvent] = {
    val deadline = System.nanoTime() + 2.seconds.toNanos
    var rows     = allAuditRows().filter(predicate)
    while (rows.isEmpty && System.nanoTime() < deadline) {
      Thread.sleep(25)
      rows = allAuditRows().filter(predicate)
    }
    rows
  }

  /** Reads every persisted audit row (system context — this is a test, no
   *  caller-scoped ACL to honor). */
  private def allAuditRows(): Seq[AuditEvent] = {
    import slick.jdbc.PostgresProfile.api._
    val rows = await(db.run(sql"""SELECT id, actor_user_id, actor_token_id, source, action, resource_type, resource_id, metadata, created_at FROM audit_events""".as[(String, Option[String], Option[String], String, String, String, Option[String], String, java.sql.Timestamp)]))
    rows.map { case (id, actor, token, source, action, resourceType, resourceId, metadata, createdAt) =>
      AuditEvent(
        id           = AuditEventId(id),
        actorUserId  = actor.map(UserId(_)),
        actorTokenId = token.map(ApiTokenId(_)),
        source       = AuditSource.fromString(source).getOrElse(AuditSource.System),
        action       = action,
        resourceType = resourceType,
        resourceId   = resourceId,
        metadata     = metadata.parseJson,
        createdAt    = createdAt.toInstant
      )
    }
  }

  /** Reads the `helio_session` value set by a `Set-Cookie` response header —
   *  mirrors `ApiRoutesSpec.sessionCookieValue`/`MfaApiRoutesSpec.
   *  sessionCookieValue`. Must be called from inside a `check {}` block. */
  private def sessionCookieValue(response: HttpResponse): String =
    response.headers.collectFirst { case `Set-Cookie`(cookie) if cookie.name == SessionCookies.Name => cookie.value }
      .getOrElse(fail(s"no Set-Cookie: ${SessionCookies.Name} header in response"))

  /** Computes the current valid TOTP code for `secret` directly via
   *  `java-otp` — mirrors `MfaApiRoutesSpec.totpCodeFor` exactly (independent
   *  of the service's own verification path). Local, single-use imports per
   *  CONTRIBUTING's documented exception. */
  private def totpCodeFor(secret: String): String = {
    import com.eatthepath.otp.TimeBasedOneTimePasswordGenerator
    import org.apache.commons.codec.binary.Base32
    import javax.crypto.spec.SecretKeySpec

    val totp = new TimeBasedOneTimePasswordGenerator()
    val key  = new SecretKeySpec(new Base32().decode(secret), totp.getAlgorithm)
    totp.generateOneTimePasswordString(key, Instant.now())
  }

  /** Enrolls + confirms MFA for the session at `token` (mirrors
   *  `MfaApiRoutesSpec.enableMfa`), resetting the replay watermark
   *  afterward so an immediately-following independent verification in the
   *  same 30s window isn't spuriously replay-rejected. */
  private def enableMfa(token: String): String = {
    val authed: Route = authedRealRoutes(token)
    var secret = ""
    Post("/api/auth/mfa/enroll") ~> authed ~> check {
      status shouldBe StatusCodes.OK
      secret = responseAs[MfaEnrollResponse].secret
    }
    Post("/api/auth/mfa/enroll/confirm", MfaConfirmRequest(totpCodeFor(secret))) ~> authed ~> check {
      status shouldBe StatusCodes.OK
    }
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"UPDATE user_mfa SET last_used_step = -1"))
    secret
  }

  /** Pipeline-output DataType (`sourceId = None`) — the shape a `Metric`
   *  must bind to at creation time (mirrors `MetricRoutesSpec.
   *  seedPipelineOutputDataType`). */
  private def seedPipelineOutputDataType(owner: UserId): DataType = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "AuditRollbackType",
      fields    = Vector(DataField("revenue", "Revenue", "number", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
    await(dataTypeRepo.insert(dt, AuthenticatedUser(owner)))
  }

  /** A metric bound to `dataTypeId`, inserted directly via the repository
   *  (bypassing `POST /api/metrics`, whose own create-time V41 check would
   *  otherwise make it impossible to construct the exact fixture this test
   *  needs — see the test's own comment for why). */
  private def seedMetric(owner: UserId, dataTypeId: DataTypeId): MetricId = {
    val now = Instant.now()
    val metric = MetricDefinition(
      id                = MetricId(UUID.randomUUID().toString),
      ownerId           = owner,
      dataTypeId        = dataTypeId,
      name              = "Audit Rollback Metric",
      description       = None,
      measureField      = "revenue",
      aggregation       = "sum",
      allowedDimensions = Vector.empty,
      format            = MetricFormat(None, None, None, None),
      createdAt         = now,
      updatedAt         = now
    )
    await(metricRepo.insert(metric, AuthenticatedUser(owner))) match {
      case Right(inserted) => inserted.id
      case Left(err)       => fail(s"seedMetric failed: $err")
    }
  }

  "dashboard mutations" should {

    "write exactly one dashboard.create audit row on POST /api/dashboards" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(Some("Ops"))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val dashboardId = responseAs[DashboardResponse].id
        val rows        = eventuallyAuditRows(r => r.action == "dashboard.create" && r.resourceId.contains(dashboardId))
        rows should have size 1
        rows.head.actorUserId shouldBe Some(UserId(testUserId))
        rows.head.resourceType shouldBe "dashboard"
      }
    }

    "write exactly one dashboard.delete audit row, not one per cascaded panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId1     = ""
      var panelId2     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("ToDelete"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("P1"), Some("markdown"), Some(JsObject("content" -> JsString("x"))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        panelId1 = responseAs[PanelResponse].id
      }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("P2"), Some("markdown"), Some(JsObject("content" -> JsString("y"))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        panelId2 = responseAs[PanelResponse].id
      }

      Delete(s"/api/dashboards/$dashboardId") ~> routesFor() ~> check {
        status shouldBe StatusCodes.NoContent
        // HEL-471: audit_events is append-only and not truncated between
        // tests — scope every assertion to THIS test's own resource ids
        // rather than a global row count.
        eventuallyAuditRows(r => r.action == "dashboard.delete" && r.resourceId.contains(dashboardId)) should have size 1
        // The two panels' own panel.create rows exist (one each), but no
        // panel.delete row exists for either — the DB-level cascade is not
        // separately audited (design.md Decision 7).
        val allRows = allAuditRows()
        allRows.count(r => r.action == "panel.create" && (r.resourceId.contains(panelId1) || r.resourceId.contains(panelId2))) shouldBe 2
        allRows.count(r => r.action == "panel.delete" && (r.resourceId.contains(panelId1) || r.resourceId.contains(panelId2))) shouldBe 0
      }
    }

    "write exactly one dashboard.duplicate audit row, not one per copied panel" in {
      cleanDb()
      var dashboardId = ""
      var panelId      = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("ToDup"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("P1"), Some("markdown"), Some(JsObject("content" -> JsString("x"))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val newDashboardId = responseAs[DuplicateDashboardResponse].dashboard.id
        eventuallyAuditRows(r => r.action == "dashboard.duplicate" && r.resourceId.contains(newDashboardId)) should have size 1
        // Only the one originally-created panel.create row exists for the
        // source panel — the duplicate's copied panel does NOT also emit
        // its own panel.create.
        allAuditRows().count(r => r.action == "panel.create" && r.resourceId.contains(panelId)) shouldBe 1
      }
    }
  }

  "panel mutations" should {

    "write exactly one panel.create audit row on POST /api/panels" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("PanelHost"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Notes"), Some("markdown"), Some(JsObject("content" -> JsString("# Hello"))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val panelId = responseAs[PanelResponse].id
        val rows    = eventuallyAuditRows(r => r.action == "panel.create" && r.resourceId.contains(panelId))
        rows should have size 1
        rows.head.resourceType shouldBe "panel"
      }
    }

    "write exactly one panel.delete audit row on DELETE /api/panels/:id" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("PanelHost2"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("Notes"), Some("markdown"), Some(JsObject("content" -> JsString("# Hello"))))
      ) ~> routesFor() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Delete(s"/api/panels/$panelId") ~> routesFor() ~> check {
        status shouldBe StatusCodes.NoContent
        val rows = eventuallyAuditRows(r => r.action == "panel.delete" && r.resourceId.contains(panelId))
        rows should have size 1
      }
    }
  }

  "auth events" should {

    "write exactly one auth.register row on successful registration" in {
      cleanDb()
      Post("/api/auth/register", RegisterRequest("audit-reg@example.com", "password123", None)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val userId = responseAs[AuthResponse].user.id
        val rows   = eventuallyAuditRows(r => r.action == "auth.register" && r.actorUserId.contains(UserId(userId)))
        rows should have size 1
      }
    }

    "write exactly one auth.login row on successful login" in {
      cleanDb()
      var userId = ""
      Post("/api/auth/register", RegisterRequest("audit-login@example.com", "password123", None)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        userId = responseAs[AuthResponse].user.id
      }
      Post("/api/auth/login", LoginRequest("audit-login@example.com", "password123")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        eventuallyAuditRows(r => r.action == "auth.login" && r.actorUserId.contains(UserId(userId))) should have size 1
      }
    }

    "write an auth.login.failed row with no plaintext password/secret in metadata, and no actor" in {
      cleanDb()
      val identifier = "audit-badpw@example.com"
      Post("/api/auth/register", RegisterRequest(identifier, "correctpass123", None)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/auth/login", LoginRequest(identifier, "wrongpassword")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Unauthorized
        val rows = eventuallyAuditRows(r => r.action == "auth.login.failed" && r.metadata.compactPrint.contains(identifier))
        rows should have size 1
        rows.head.actorUserId shouldBe None
        val metadataText = rows.head.metadata.compactPrint
        metadataText should include(identifier)
        metadataText should not include "wrongpassword"
        metadataText should not include "correctpass123"
      }
    }
  }

  "audit write failure isolation" should {

    "never fail the underlying mutation when the audit repository's append fails" in {
      cleanDb()
      // A failing/stubbed audit repo, wired the same way — proves the swallow
      // holds at the actual call site, not just inside AuditService's own spec.
      val failingAuditRepo = new AuditEventRepository(null)(typedSystem.executionContext) {
        override def append(event: AuditEvent.NewAuditEvent): Future[AuditEventId] =
          Future.failed(new RuntimeException("HEL-477 test: simulated audit append failure"))
      }
      val raw = new ApiRoutes(
        dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem, stubConnector,
        userRepo, stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
        new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
        auditEventRepo = failingAuditRepo
      ).routes
      val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
      val withAuth: Route = Directives.mapRequest { (req: HttpRequest) =>
        val withCookie = req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken))
        withCookie.withHeaders(withCookie.headers :+ csrfHeader)
      } {
        raw
      }

      Post("/api/dashboards", CreateDashboardRequest(Some("StillWorks"))) ~> withAuth ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DashboardResponse].name shouldBe "StillWorks"
      }
    }
  }

  "MFA-gated login (design.md Decision 6)" should {

    "write auth.login.challenged at the initial login, then auth.login (not a duplicate .challenged) on successful verify" in {
      cleanDb()
      var userId = ""
      var preMfaToken = ""
      Post("/api/auth/register", RegisterRequest("audit-mfa@example.com", "password123", None)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        userId       = responseAs[AuthResponse].user.id
        preMfaToken  = sessionCookieValue(response)
      }
      val secret = enableMfa(preMfaToken)

      var challengeToken = ""
      Post("/api/auth/login", LoginRequest("audit-mfa@example.com", "password123")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MfaRequiredResponse]
        resp.mfaRequired shouldBe true
        challengeToken = resp.challengeToken
      }
      val challengedRows = eventuallyAuditRows(r => r.action == "auth.login.challenged" && r.actorUserId.contains(UserId(userId)))
      challengedRows should have size 1
      // No auth.login row exists yet — a session has not been established.
      allAuditRows().count(r => r.action == "auth.login" && r.actorUserId.contains(UserId(userId))) shouldBe 0

      Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, totpCodeFor(secret))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
      }
      // The actual session-establishing event fires here, from MfaService.verifyLogin — not a
      // second auth.login.challenged.
      eventuallyAuditRows(r => r.action == "auth.login" && r.actorUserId.contains(UserId(userId))) should have size 1
      allAuditRows().count(r => r.action == "auth.login.challenged" && r.actorUserId.contains(UserId(userId))) shouldBe 1
    }

    "write auth.login.failed on an incorrect TOTP code at verify time" in {
      cleanDb()
      var userId = ""
      Post("/api/auth/register", RegisterRequest("audit-mfa-badcode@example.com", "password123", None)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        userId = responseAs[AuthResponse].user.id
      }
      var token = ""
      Post("/api/auth/login", LoginRequest("audit-mfa-badcode@example.com", "password123")) ~> routesFor() ~> check {
        token = sessionCookieValue(response)
      }
      enableMfa(token)

      var challengeToken = ""
      Post("/api/auth/login", LoginRequest("audit-mfa-badcode@example.com", "password123")) ~> routesFor() ~> check {
        challengeToken = responseAs[MfaRequiredResponse].challengeToken
      }

      Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, "000000")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
      eventuallyAuditRows(r => r.action == "auth.login.failed" && r.metadata.compactPrint.contains(userId)) should have size 1
    }
  }

  "batch and composite call sites (design.md Decision 9)" should {

    "write exactly one panel.batch_create audit row per call, with the correct count in metadata" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("BatchCreateHost"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      val items = Vector(
        CreatePanelBatchItem(Some("A"), Some("markdown"), Some(JsObject("content" -> JsString("a"))), None),
        CreatePanelBatchItem(Some("B"), Some("markdown"), Some(JsObject("content" -> JsString("b"))), None),
        CreatePanelBatchItem(Some("C"), Some("markdown"), Some(JsObject("content" -> JsString("c"))), None)
      )
      Post("/api/panels/batch", CreatePanelsBatchRequest(Some(dashboardId), items)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val createdIds = responseAs[CreatePanelsBatchResponse].panels.map(_.id).toSet
        val rows       = eventuallyAuditRows(r => r.action == "panel.batch_create" && r.resourceId.contains(dashboardId))
        rows should have size 1
        rows.head.metadata.asJsObject.fields("count") shouldBe JsNumber(3)
        // No individual panel.create rows for the batch's own items.
        allAuditRows().count(r => r.action == "panel.create" && r.resourceId.exists(createdIds.contains)) shouldBe 0
      }
    }

    "write exactly one panel.batch_update audit row per call, with the correct count in metadata" in {
      cleanDb()
      var dashboardId = ""
      var panelId1     = ""
      var panelId2     = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("BatchUpdateHost"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("P1"), Some("markdown"), Some(JsObject("content" -> JsString("x"))))
      ) ~> routesFor() ~> check { panelId1 = responseAs[PanelResponse].id }
      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboardId), Some("P2"), Some("markdown"), Some(JsObject("content" -> JsString("y"))))
      ) ~> routesFor() ~> check { panelId2 = responseAs[PanelResponse].id }

      val items = Vector(
        PanelBatchItem(panelId1, Some("P1-updated"), None, None, None),
        PanelBatchItem(panelId2, Some("P2-updated"), None, None, None)
      )
      Post("/api/panels/updateBatch", UpdatePanelsBatchRequest(Vector("title"), items)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "panel.batch_update" && r.resourceId.contains(dashboardId))
        rows should have size 1
        rows.head.metadata.asJsObject.fields("count") shouldBe JsNumber(2)
        // No individual panel.update rows for the batch's own items.
        allAuditRows().count(r => r.action == "panel.update") shouldBe 0
      }
    }

    "write exactly one dashboard.import audit row on POST /api/dashboards/import" in {
      cleanDb()
      val payload =
        s"""{"version":${DashboardSnapshotPayload.CurrentVersion},"dashboard":{"name":"Imported","appearance":{"background":"transparent","gridBackground":"transparent"},"layout":{"lg":[],"md":[],"sm":[],"xs":[]}},"panels":[]}"""
      Post(
        "/api/dashboards/import",
        HttpEntity(ContentTypes.`application/json`, payload)
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val dashboardId = responseAs[DuplicateDashboardResponse].dashboard.id
        eventuallyAuditRows(r => r.action == "dashboard.import" && r.resourceId.contains(dashboardId)) should have size 1
        allAuditRows().count(r => r.action == "dashboard.create" && r.resourceId.contains(dashboardId)) shouldBe 0
      }
    }

    "write exactly one dashboard.contents.replace audit row on PUT /api/dashboards/:id/contents" in {
      cleanDb()
      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("ReplaceHost"))) ~> routesFor() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      val panels = Vector(
        ProposalPanel("Note", "markdown", None, None, None, None, Some("hello"), None, None, None, None, None, None, None, None, None, None, None)
      )
      Put(s"/api/dashboards/$dashboardId/contents", ReplaceDashboardContentsRequest(panels)) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "dashboard.contents.replace" && r.resourceId.contains(dashboardId))
        rows should have size 1
        rows.head.metadata.asJsObject.fields("panelCount") shouldBe JsNumber(1)
      }
    }
  }

  "pipeline step reorder and duplicate (skeptic-final-1 round 1)" should {

    "write exactly one pipeline.step.duplicate audit row on POST /api/pipeline-steps/:id/duplicate" in {
      cleanDb()
      var dataSourceId = ""
      Post(
        "/api/data-sources",
        StaticDataSourceRequest("DupStepSource", "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(1))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        dataSourceId = responseAs[DataSourceResponse].id
      }
      var pipelineId = ""
      Post("/api/pipelines", CreatePipelineRequest("DupStepPipeline", dataSourceId, "DupStepOutput")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        pipelineId = responseAs[PipelineSummaryResponse].id
      }
      var stepId = ""
      Post(s"/api/pipelines/$pipelineId/steps", CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(10)))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      Post(s"/api/pipeline-steps/$stepId/duplicate") ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        val newStepId = responseAs[PipelineStepResponse].id
        val rows = eventuallyAuditRows(r => r.action == "pipeline.step.duplicate" && r.resourceId.contains(newStepId))
        rows should have size 1
        rows.head.resourceType shouldBe "pipeline_step"
        rows.head.metadata.asJsObject.fields("sourceStepId") shouldBe JsString(stepId)
      }
    }

    "write exactly one pipeline.step.reorder audit row (not one per step) on PUT /api/pipelines/:id/steps/order" in {
      cleanDb()
      var dataSourceId = ""
      Post(
        "/api/data-sources",
        StaticDataSourceRequest("ReorderStepSource", "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(1))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        dataSourceId = responseAs[DataSourceResponse].id
      }
      var pipelineId = ""
      Post("/api/pipelines", CreatePipelineRequest("ReorderStepPipeline", dataSourceId, "ReorderStepOutput")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        pipelineId = responseAs[PipelineSummaryResponse].id
      }
      var stepId1 = ""
      var stepId2 = ""
      Post(s"/api/pipelines/$pipelineId/steps", CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(10)))) ~> routesFor() ~> check {
        stepId1 = responseAs[PipelineStepResponse].id
      }
      Post(s"/api/pipelines/$pipelineId/steps", CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(20)))) ~> routesFor() ~> check {
        stepId2 = responseAs[PipelineStepResponse].id
      }

      Put(s"/api/pipelines/$pipelineId/steps/order", ReorderPipelineStepsRequest(Seq(stepId2, stepId1))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "pipeline.step.reorder" && r.resourceId.contains(pipelineId))
        rows should have size 1
        rows.head.resourceType shouldBe "pipeline"
        rows.head.metadata.asJsObject.fields("stepIds") shouldBe JsArray(JsString(stepId2), JsString(stepId1))
      }
    }
  }

  "proposal-apply rollback (design.md Decision 10)" should {

    "write dashboard.create but NOT dashboard.delete when panel creation fails partway through" in {
      cleanDb()
      val testStart = Instant.now()
      val ownerId   = UserId(testUserId)
      // Panel 1's OWN dataTypeId (`typeA`) stays a valid, unflipped
      // pipeline-output type — `ProposalPanelSupport.validateDataTypeBinding`
      // (pre-validation) checks exactly that field and passes. Panel 2's
      // `metricId` resolves to a metric bound to a DIFFERENT DataType
      // (`typeB`) — pre-validation's `validateMetricBinding` only checks the
      // metric's own existence/deprecated flag, never re-deriving/checking
      // `metric.dataTypeId`'s pipeline-output-ness. `typeB` is flipped to a
      // companion type (source_id set) via direct SQL AFTER the metric is
      // created (satisfying `MetricService.create`'s own V41 check at
      // metric-creation time), so the flip is invisible to pre-validation
      // but caught by `PanelService.rejectUnresolvableMetric` at ACTUAL
      // panel-2 creation time — the exact asymmetry
      // `DashboardProposalService.createAll`'s rollback branch exists to
      // handle safely (dashboard.create already happened for panel 1's
      // dashboard; deleteInternal must not also write dashboard.delete).
      val typeA    = seedPipelineOutputDataType(ownerId)
      val typeB    = seedPipelineOutputDataType(ownerId)
      val metricId = seedMetric(ownerId, typeB.id)
      import slick.jdbc.PostgresProfile.api._
      val fakeSourceId = UUID.randomUUID().toString
      await(db.run(sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at)
             VALUES ($fakeSourceId, 'FlipSource', 'static', '{}', now(), now())"""))
      await(db.run(sqlu"UPDATE data_types SET source_id = $fakeSourceId WHERE id = ${typeB.id.value}"))

      val proposal = DashboardProposal(
        dashboardName = "RollbackTarget",
        panels = Vector(
          ProposalPanel("OK Panel", "metric", Some(typeA.id.value), None, None, None, None, None, None, None, None, None, None, None, None, None, None, None),
          ProposalPanel("Metric Panel", "metric", Some(typeA.id.value), Some(metricId.value), None, None, None, None, None, None, None, None, None, None, None, None, None, None)
        )
      )
      Post("/api/dashboards/apply-proposal", proposal) ~> routesFor() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      // The dashboard WAS created (first write of createAll, before panel 2's
      // rejection) — `deleteInternal` deletes the row itself (only its audit
      // trail is suppressed), so it can't be looked up by name afterward.
      // `testUser` accumulates dashboard.create rows across this whole
      // suite (audit_events is append-only, never wiped by cleanDb), so
      // scope to rows written after `testStart`, captured at the top of
      // this test — robust to suite/declaration-order changes.
      val createRows = eventuallyAuditRows(r =>
        r.action == "dashboard.create" && r.actorUserId.contains(ownerId) && r.createdAt.isAfter(testStart)
      )
      createRows should have size 1
      val rolledBackDashboardId = createRows.head.resourceId.getOrElse(fail("dashboard.create row has no resourceId"))
      // ...but the rollback used deleteInternal, so no dashboard.delete row exists for it.
      allAuditRows().count(r => r.action == "dashboard.delete" && r.resourceId.contains(rolledBackDashboardId)) shouldBe 0
    }
  }

  "PAT/session actor attribution (HEL-483)" should {

    /** Mints a PAT for `testUser` through the real route, authenticated by
     *  `testToken`'s session cookie — returns (tokenId, rawToken). */
    def createPat(name: String): (String, String) = {
      val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
      Post("/api/tokens", HttpEntity(ContentTypes.`application/json`, s"""{"name":"$name"}"""))
        .withHeaders(Cookie(SessionCookies.Name -> testToken), csrfHeader) ~> rawRoutesFor() ~> check {
        status shouldBe StatusCodes.Created
        val fields = responseAs[String].parseJson.asJsObject.fields
        (fields("id").convertTo[String], fields("token").convertTo[String])
      }
    }

    def createDashboardViaSession(name: String): String = {
      val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
      Post("/api/dashboards", CreateDashboardRequest(Some(name)))
        .withHeaders(Cookie(SessionCookies.Name -> testToken), csrfHeader) ~> rawRoutesFor() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DashboardResponse].id
      }
    }

    "record a session-cookie dashboard update with source=ui and null actor_token_id" in {
      cleanDb()
      val dashboardId = createDashboardViaSession("SessionOwned")
      val csrfHeader   = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(Some("Renamed"), None, None))
        .withHeaders(Cookie(SessionCookies.Name -> testToken), csrfHeader) ~> rawRoutesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "dashboard.update" && r.resourceId.contains(dashboardId))
        rows should have size 1
        AuditSource.asString(rows.head.source) shouldBe "ui"
        rows.head.actorTokenId shouldBe None
      }
    }

    "record the same dashboard update via a PAT bearer with source=pat and the resolving token's id" in {
      cleanDb()
      val dashboardId  = createDashboardViaSession("PatOwned")
      val (tokenId, raw) = createPat("pat-attribution-test")
      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(Some("RenamedByPat"), None, None))
        .withHeaders(Authorization(OAuth2BearerToken(raw))) ~> rawRoutesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "dashboard.update" && r.resourceId.contains(dashboardId))
        rows should have size 1
        AuditSource.asString(rows.head.source) shouldBe "pat"
        rows.head.actorTokenId shouldBe Some(ApiTokenId(tokenId))
      }
    }

    "leave a previously-recorded audit row's actor_token_id intact after the token is revoked" in {
      cleanDb()
      val dashboardId    = createDashboardViaSession("RevokeTarget")
      val (tokenId, raw) = createPat("revoke-me")
      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(Some("RenamedBeforeRevoke"), None, None))
        .withHeaders(Authorization(OAuth2BearerToken(raw))) ~> rawRoutesFor() ~> check {
        status shouldBe StatusCodes.OK
      }
      val rowsBefore = eventuallyAuditRows(r => r.action == "dashboard.update" && r.resourceId.contains(dashboardId))
      rowsBefore should have size 1
      rowsBefore.head.actorTokenId shouldBe Some(ApiTokenId(tokenId))

      val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
      Delete(s"/api/tokens/$tokenId")
        .withHeaders(Cookie(SessionCookies.Name -> testToken), csrfHeader) ~> rawRoutesFor() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      val rowsAfter = allAuditRows().filter(r => r.action == "dashboard.update" && r.resourceId.contains(dashboardId))
      rowsAfter should have size 1
      rowsAfter.head.actorTokenId shouldBe Some(ApiTokenId(tokenId))
    }
  }

  "MFA actions via PAT (HEL-483)" should {

    "record MfaService.confirmEnrollment invoked by a PAT-authenticated caller with source=pat and the token's id" in {
      import slick.jdbc.PostgresProfile.api._
      val realUserId = UUID.randomUUID().toString
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($realUserId::uuid, ${s"mfa-pat-$realUserId@helio.test"}, now())"""))
      val session = await(userRepo.createSession(
        UserSession(
          token     = s"real-session-$realUserId",
          userId    = UserId(realUserId),
          createdAt = Instant.now(),
          expiresAt = Instant.now().plusSeconds(3600)
        )
      )).token

      val routes     = realSessionRoutesFor()
      val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

      var secret = ""
      Post("/api/auth/mfa/enroll").withHeaders(Cookie(SessionCookies.Name -> session), csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        secret = responseAs[MfaEnrollResponse].secret
      }

      // Mint a PAT for this same user (session-authenticated), then confirm
      // enrollment authenticated by the PAT instead of the session cookie —
      // `MfaService.confirmEnrollment` has `user: AuthenticatedUser` in
      // scope and IS reachable by a PAT caller (design.md Decision 5).
      var rawPat = ""
      Post("/api/tokens", HttpEntity(ContentTypes.`application/json`, """{"name":"mfa-confirm-pat"}"""))
        .withHeaders(Cookie(SessionCookies.Name -> session), csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        rawPat = responseAs[String].parseJson.asJsObject.fields("token").convertTo[String]
      }

      Post("/api/auth/mfa/enroll/confirm", MfaConfirmRequest(totpCodeFor(secret)))
        .withHeaders(Authorization(OAuth2BearerToken(rawPat))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }

      val rows = eventuallyAuditRows(r => r.action == "auth.mfa.enable" && r.actorUserId.contains(UserId(realUserId)))
      rows should have size 1
      AuditSource.asString(rows.head.source) shouldBe "pat"
      rows.head.actorTokenId shouldBe defined
    }
  }

  "WorkspaceTeardownService audit instrumentation (HEL-838)" should {

    /** Creates a tagged static DataSource via the real route — the tag
     *  scopes what `POST /api/workspace/teardown` sees as its batch. */
    def createTaggedSource(name: String, tag: String): String = {
      var dataSourceId = ""
      Post(
        "/api/data-sources",
        StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(1))), Some(tag))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        dataSourceId = responseAs[DataSourceResponse].id
      }
      dataSourceId
    }

    "write exactly one workspace.teardown audit row on a committed teardown, with correct " +
      "resourceId, actor id, tokenId, source and deletion-count metadata (task 2.1, AC 1/2)" in {
      cleanDb()
      val tag           = s"teardown-committed-${UUID.randomUUID()}"
      val dataSourceId  = createTaggedSource("TeardownCommittedSource", tag)

      Post("/api/workspace/teardown", TeardownRequest(Some(tag), Some(false))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[TeardownResponse]
        resp.committed shouldBe true
        resp.blocked shouldBe false
        resp.sourcesDeleted shouldBe 1
        resp.typesDeleted shouldBe 1

        val rows = eventuallyAuditRows(r => r.action == "workspace.teardown" && r.resourceId.contains(tag))
        rows should have size 1
        val row = rows.head
        row.resourceType shouldBe "workspace"
        row.actorUserId shouldBe Some(testUser.id)
        row.actorTokenId shouldBe None
        AuditSource.asString(row.source) shouldBe "ui"
        row.metadata.asJsObject.fields("sourcesDeleted") shouldBe JsNumber(1)
        row.metadata.asJsObject.fields("pipelinesDeleted") shouldBe JsNumber(0)
        row.metadata.asJsObject.fields("typesDeleted") shouldBe JsNumber(1)
      }
      // `dataSourceId` created above is deleted by the teardown itself — no
      // further use needed, referenced only to document the fixture's shape.
      dataSourceId should not be empty
    }

    "write exactly one workspace.teardown audit row for a committed teardown of a tag matching " +
      "zero resources, with all-zero deletion counts (task 2.1, spec scenario)" in {
      cleanDb()
      val tag = s"teardown-empty-${UUID.randomUUID()}"

      Post("/api/workspace/teardown", TeardownRequest(Some(tag), Some(false))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[TeardownResponse]
        resp.committed shouldBe true
        resp.sourcesDeleted shouldBe 0

        val rows = eventuallyAuditRows(r => r.action == "workspace.teardown" && r.resourceId.contains(tag))
        rows should have size 1
        val metadata = rows.head.metadata.asJsObject.fields
        metadata("sourcesDeleted") shouldBe JsNumber(0)
        metadata("pipelinesDeleted") shouldBe JsNumber(0)
        metadata("typesDeleted") shouldBe JsNumber(0)
      }
    }

    "write no workspace.teardown audit row for a dryRun teardown (task 2.2, negative-assertion " +
      "barrier per design.md Test plan)" in {
      cleanDb()
      val dryRunTag = s"teardown-dryrun-${UUID.randomUUID()}"
      createTaggedSource("TeardownDryRunSource", dryRunTag)

      Post("/api/workspace/teardown", TeardownRequest(Some(dryRunTag), Some(true))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[TeardownResponse].committed shouldBe false
      }

      // Barrier: issue a second, real committed teardown (an empty-match
      // tag) and wait for ITS row first — this proves the fire-and-forget
      // audit write path has drained before asserting the dry-run tag wrote
      // nothing (design.md "Test plan" — otherwise "no row yet" is
      // unfalsifiable).
      val barrierTag = s"teardown-barrier-${UUID.randomUUID()}"
      Post("/api/workspace/teardown", TeardownRequest(Some(barrierTag), Some(false))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[TeardownResponse].committed shouldBe true
      }
      eventuallyAuditRows(r => r.action == "workspace.teardown" && r.resourceId.contains(barrierTag)) should have size 1

      allAuditRows().count(r => r.action == "workspace.teardown" && r.resourceId.contains(dryRunTag)) shouldBe 0
    }

    "write no workspace.teardown audit row for a blocked teardown (task 2.3, negative-assertion " +
      "barrier per design.md Test plan)" in {
      cleanDb()
      val blockedTag  = s"teardown-blocked-${UUID.randomUUID()}"
      val srcId       = createTaggedSource("TeardownBlockedSource", blockedTag)
      // An untagged dependent pipeline over the tagged source blocks the
      // whole call (mirrors WorkspaceTeardownServiceSpec 6.4).
      Post("/api/pipelines", CreatePipelineRequest("TeardownBlockedPipeline", srcId, "TeardownBlockedOutput")) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
      }

      Post("/api/workspace/teardown", TeardownRequest(Some(blockedTag), Some(false))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[TeardownResponse]
        resp.blocked shouldBe true
        resp.committed shouldBe false
      }

      val barrierTag = s"teardown-barrier-${UUID.randomUUID()}"
      Post("/api/workspace/teardown", TeardownRequest(Some(barrierTag), Some(false))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[TeardownResponse].committed shouldBe true
      }
      eventuallyAuditRows(r => r.action == "workspace.teardown" && r.resourceId.contains(barrierTag)) should have size 1

      allAuditRows().count(r => r.action == "workspace.teardown" && r.resourceId.contains(blockedTag)) shouldBe 0
    }
  }

  "DataSourceService.refresh / SourceService.refresh audit instrumentation (HEL-840)" should {

    // ── DataSourceService.refresh: static kind covered end-to-end via HTTP ──

    "write exactly one data_source.refresh row on a successful static refresh (end-to-end via HTTP)" in {
      cleanDb()
      var sourceId = ""
      Post(
        "/api/data-sources",
        StaticDataSourceRequest("RefreshStatic", "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(1))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        sourceId = responseAs[DataSourceResponse].id
      }

      val payload = StaticDataSourceRequest("RefreshStatic", "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(2))))
      Post(s"/api/data-sources/$sourceId/refresh", payload) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId))
        rows should have size 1
        val row = rows.head
        row.resourceType shouldBe "data_source"
        row.actorUserId shouldBe Some(testUser.id)
        AuditSource.asString(row.source) shouldBe "ui"
      }
    }

    "write no data_source.refresh row for a failed static refresh (payload exceeds the row cap; " +
      "negative-assertion barrier per design.md Test plan)" in {
      cleanDb()
      var sourceId = ""
      Post(
        "/api/data-sources",
        StaticDataSourceRequest("RefreshStaticFail", "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(1))))
      ) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        sourceId = responseAs[DataSourceResponse].id
      }

      val tooManyRows = Vector.fill(501)(Vector[JsValue](JsNumber(1)))
      val badPayload  = StaticDataSourceRequest("RefreshStaticFail", "static", Vector(StaticColumnPayload("n", "number")), tooManyRows)
      Post(s"/api/data-sources/$sourceId/refresh", badPayload) ~> routesFor() ~> check {
        status shouldBe StatusCodes.BadRequest
      }

      // Barrier: a real successful refresh drains the fire-and-forget audit
      // write path before we assert the failed call above wrote nothing.
      val barrierPayload = StaticDataSourceRequest("RefreshStaticFail", "static", Vector(StaticColumnPayload("n", "number")), Vector(Vector(JsNumber(3))))
      Post(s"/api/data-sources/$sourceId/refresh", barrierPayload) ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
      }
      eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId)) should have size 1

      allAuditRows().count(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId)) shouldBe 1
    }

    // ── DataSourceService.refresh: csv/text/pdf/image kinds via a dedicated, real-audit-repo-backed
    // service instance (design.md: "at least one kind covered end-to-end plus a table/loop for the
    // rest if that keeps the spec readable" — static above is the end-to-end HTTP case). ──

    def validPngBytes(): Array[Byte] = {
      val image = new BufferedImage(4, 3, BufferedImage.TYPE_INT_RGB)
      val out   = new ByteArrayOutputStream()
      ImageIO.write(image, "png", out)
      out.toByteArray
    }

    "write exactly one data_source.refresh row per successful refresh, for csv/text/pdf/image kinds" in {
      cleanDb()
      val tmpDir       = Files.createTempDirectory("audit-mutation-instrumentation-spec")
      val fileSystem   = new LocalFileSystem(tmpDir)
      val svc          = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, auditService = new AuditService(auditEventRepo))

      val fixtures: Seq[(String, Future[Either[ServiceError, DataSource]])] = Seq(
        "csv"   -> svc.createCsv("RefreshCsv", "a,b\n1,2".getBytes(StandardCharsets.UTF_8), Vector.empty, testUser),
        "text"  -> svc.createTextUpload("RefreshText", "hello world".getBytes(StandardCharsets.UTF_8), "notes.txt", testUser),
        "pdf"   -> svc.createPdfUpload("RefreshPdf", PdfFixtures.multiPagePdf(Seq("Hello")), "report.pdf", testUser),
        "image" -> svc.createImageUpload("RefreshImage", validPngBytes(), "photo.png", testUser)
      )

      fixtures.foreach { case (kind, createF) =>
        val created = await(createF) match {
          case Right(ds) => ds
          case Left(err) => fail(s"[$kind] create failed: $err")
        }
        await(svc.refresh(created.id, None, testUser)) match {
          case Right(_) => ()
          case Left(err) => fail(s"[$kind] refresh failed: $err")
        }
        val rows = eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(created.id.value))
        withClue(s"[$kind] ") { rows should have size 1 }
      }
    }

    "write no data_source.refresh row for a failed CSV refresh (source file missing on disk; " +
      "negative-assertion barrier per design.md Test plan)" in {
      cleanDb()
      val tmpDir     = Files.createTempDirectory("audit-mutation-instrumentation-spec-csv-fail")
      val fileSystem = new LocalFileSystem(tmpDir)
      val svc        = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, auditService = new AuditService(auditEventRepo))

      val created = await(svc.createCsv("RefreshCsvFail", "x\n1".getBytes(StandardCharsets.UTF_8), Vector.empty, testUser)) match {
        case Right(ds) => ds
        case Left(err) => fail(s"create failed: $err")
      }
      created match {
        case c: CsvSource => await(fileSystem.delete(c.config.path))
        case other                                => fail(s"expected CsvSource, got: $other")
      }

      await(svc.refresh(created.id, None, testUser)).isLeft shouldBe true

      // Barrier: a real successful refresh on a second source drains the
      // fire-and-forget audit write path first.
      val barrier = await(svc.createCsv("RefreshCsvBarrier", "x\n1".getBytes(StandardCharsets.UTF_8), Vector.empty, testUser)) match {
        case Right(ds) => ds
        case Left(err) => fail(s"barrier create failed: $err")
      }
      await(svc.refresh(barrier.id, None, testUser)).isRight shouldBe true
      eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(barrier.id.value)) should have size 1

      allAuditRows().count(r => r.action == "data_source.refresh" && r.resourceId.contains(created.id.value)) shouldBe 0
    }

    // ── SourceService.refresh: sql kind covered end-to-end via HTTP (embedded Postgres) ──

    def sqlConfigPayload(query: String): SqlSourceConfigPayload =
      SqlSourceConfigPayload(
        dialect  = "postgresql",
        host     = "localhost",
        port     = embeddedPostgres.getPort,
        database = "postgres",
        user     = "postgres",
        password = "postgres",
        query    = query
      )

    "write exactly one data_source.refresh row on a successful sql refresh (end-to-end via HTTP)" in {
      cleanDb()
      var sourceId = ""
      Post("/api/sources", SqlCreateSourceRequest("RefreshSql", DataSourceKind.Sql, sqlConfigPayload("SELECT 1 AS one"))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        sourceId = responseAs[CreateSourceResponse].source.id
      }

      Post(s"/api/sources/$sourceId/refresh") ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
        val rows = eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId))
        rows should have size 1
        rows.head.resourceType shouldBe "data_source"
        rows.head.actorUserId shouldBe Some(testUser.id)
      }
    }

    "write no data_source.refresh row for a failed sql refresh (query fails; negative-assertion " +
      "barrier per design.md Test plan)" in {
      cleanDb()
      var sourceId = ""
      Post("/api/sources", SqlCreateSourceRequest("RefreshSqlFail", DataSourceKind.Sql, sqlConfigPayload("SELECT 1 AS one"))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        sourceId = responseAs[CreateSourceResponse].source.id
      }

      // Rewrite the source's query to a broken one directly in the DB so the
      // refresh call itself fails (create validates the query up front).
      import slick.jdbc.PostgresProfile.api._
      val brokenConfig = sqlConfigPayload("SELECT * FROM definitely_not_a_real_table").toJson.compactPrint
      await(db.run(sql"UPDATE data_sources SET config = $brokenConfig WHERE id = $sourceId".asUpdate))

      Post(s"/api/sources/$sourceId/refresh") ~> routesFor() ~> check {
        status shouldBe StatusCodes.BadGateway
      }

      var barrierSourceId = ""
      Post("/api/sources", SqlCreateSourceRequest("RefreshSqlBarrier", DataSourceKind.Sql, sqlConfigPayload("SELECT 1 AS one"))) ~> routesFor() ~> check {
        status shouldBe StatusCodes.Created
        barrierSourceId = responseAs[CreateSourceResponse].source.id
      }
      Post(s"/api/sources/$barrierSourceId/refresh") ~> routesFor() ~> check {
        status shouldBe StatusCodes.OK
      }
      eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(barrierSourceId)) should have size 1

      allAuditRows().count(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId)) shouldBe 0
    }

    // ── SourceService.refresh: rest kind, via a dedicated service instance with a stubbed connector
    // (routesFor()'s ApiRoutes-constructed SourceService always uses a rejecting stub connector). ──

    "write exactly one data_source.refresh row on a successful rest refresh" in {
      cleanDb()
      val restConnector = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("id" -> JsNumber(1)))))))
      val svc            = new SourceService(dataSourceRepo, dataTypeRepo, restConnector, auditService = new AuditService(auditEventRepo), connectorRepo = connectorRepo)
      val restConfigPayload = RestApiConfigPayload(url = Some("http://example.invalid/data"), method = Some("GET"), auth = None, headers = None)

      val created = await(svc.createRest(CreateSourceRequest("RefreshRest", DataSourceKind.RestApi, restConfigPayload, None), testUser)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      await(svc.refresh(sourceId, testUser)).isRight shouldBe true
      val rows = eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId.value))
      rows should have size 1
      rows.head.resourceType shouldBe "data_source"
    }

    "write no data_source.refresh row for a failed rest refresh (fetch fails; negative-assertion " +
      "barrier per design.md Test plan)" in {
      cleanDb()
      val failingConnector = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Left("Request failed"))))
      val successConnector = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("id" -> JsNumber(1)))))))
      val auditSvc          = new AuditService(auditEventRepo)
      val failingSvc        = new SourceService(dataSourceRepo, dataTypeRepo, failingConnector, auditService = auditSvc, connectorRepo = connectorRepo)
      val successSvc        = new SourceService(dataSourceRepo, dataTypeRepo, successConnector, auditService = auditSvc, connectorRepo = connectorRepo)
      val restConfigPayload = RestApiConfigPayload(url = Some("http://example.invalid/data"), method = Some("GET"), auth = None, headers = None)

      val created = await(failingSvc.createRest(CreateSourceRequest("RefreshRestFail", DataSourceKind.RestApi, restConfigPayload, None), testUser)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      await(failingSvc.refresh(sourceId, testUser)).isLeft shouldBe true

      // Barrier: a real successful refresh (different source, same audit
      // service/repo) drains the fire-and-forget write path first.
      val barrierCreated = await(successSvc.createRest(CreateSourceRequest("RefreshRestBarrier", DataSourceKind.RestApi, restConfigPayload, None), testUser)) match {
        case Right(r) => r
        case Left(e)  => fail(s"barrier createRest failed: $e")
      }
      val barrierSourceId = DataSourceId(barrierCreated.source.id)
      await(successSvc.refresh(barrierSourceId, testUser)).isRight shouldBe true
      eventuallyAuditRows(r => r.action == "data_source.refresh" && r.resourceId.contains(barrierSourceId.value)) should have size 1

      allAuditRows().count(r => r.action == "data_source.refresh" && r.resourceId.contains(sourceId.value)) shouldBe 0
    }
  }
}
