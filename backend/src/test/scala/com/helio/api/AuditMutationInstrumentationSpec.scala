package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader, `Set-Cookie`}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.protocols.auth.{AuthResponse, LoginRequest, MfaConfirmRequest, MfaEnrollResponse, MfaRequiredResponse, MfaVerifyRequest, RegisterRequest}
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse, DashboardSnapshotPayload, DuplicateDashboardResponse}
import com.helio.api.protocols.panels.{CreatePanelBatchItem, CreatePanelRequest, CreatePanelsBatchRequest, CreatePanelsBatchResponse, PanelBatchItem, PanelResponse, UpdatePanelsBatchRequest}
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel, ReplaceDashboardContentsRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse, ReorderPipelineStepsRequest}
import com.helio.api.protocols.sources.{DataSourceResponse, StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.connectors.RestApiConnector
import com.helio.domain.model.{ApiTokenId, AuditEvent, AuditEventId, AuditSource, AuthenticatedUser, DataField, DataType, DataTypeId, MetricDefinition, MetricFormat, MetricId, UserId}
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.auth.{MfaRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.{Database, DbContext}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import spray.json._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
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
  private var mfaRepo: MfaRepository                        = _
  private var metricRepo: MetricRepository                  = _
  private var realSessionRepo: SlickUserSessionRepository   = _

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
    mfaRepo            = new MfaRepository(db)(typedSystem.executionContext)
    metricRepo         = new MetricRepository(ctx)(typedSystem.executionContext)
    realSessionRepo    = new SlickUserSessionRepository(db)(typedSystem.executionContext)
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
    await(db.run(sqlu"TRUNCATE TABLE resource_permissions, user_sessions, users, panels, dashboards, data_types, data_sources RESTART IDENTITY CASCADE"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ('00000000-0000-0000-0000-000000000099'::uuid, 'test@helio.test', now())"""))
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                           = Future.successful(())
    def exists(path: String): Future[Boolean]                                                        = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  private def stubConnector: RestApiConnector = new RestApiConnector(Some(_ => Future.successful(Left("no real HTTP in tests"))))

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
      metricRepo = metricRepo
    ).routes
    val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
    Directives.mapRequest { (req: HttpRequest) =>
      val withCookie = req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken))
      withCookie.withHeaders(withCookie.headers :+ csrfHeader)
    } {
      raw
    }
  }

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
      metricRepo = metricRepo
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
}
