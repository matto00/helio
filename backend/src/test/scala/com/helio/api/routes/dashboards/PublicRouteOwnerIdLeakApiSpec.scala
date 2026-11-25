package com.helio.api.routes.dashboards

import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialRepository, MfaRepository, TotpSupport, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorCompletionTokenRepository, ConnectorRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.sources.{ConnectorCompletionService, ImageUploadService}
import com.helio.infrastructure.persistence.pipelines.OutputInsightRepository
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.infrastructure.persistence.sources.ImageUploadRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.ratelimit.RateLimitConfig
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{OutputInsightApiHarness, OwnerIdGuard}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpMethods, HttpRequest, StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.Future

/** HEL-1248: every route reachable WITHOUT authentication (17 routes: the panel read routes incl. `/history` and
 *  `/insight`, image upload fetch, connector completion GET/POST, `/health`, and the error bodies of the auth routes under `/api/auth`), driven
 *  through the real `ApiRoutes` tree (so each is proven mounted, behind the real CSRF and rate-limit wrapping), with every
 *  response body and header value checked by [[OwnerIdGuard]]. Fixture data is owned by ONE distinctive id, with
 *  ownership positive controls. A structural check that fails when a NEW public route is added without coverage is NOT
 *  part of this spec; it moves to HEL-1881.
 *  Sibling of `PublicRouteOwnerIdLeakSpec` (HEL-1216), which walks `PublicDashboardRoutes` directly. */
class PublicRouteOwnerIdLeakApiSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with OutputInsightApiHarness
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  protected def apiSystem: ActorSystem[Nothing]          = typedSystem
  protected def harnessEc                                = typedSystem.executionContext

  private val ownerId  = "0badc0de-1248-4abc-8def-0123456789ab"
  private val ownerEmail = "owner@example.test"
  private val ownerPassword = "owner-password-1248"
  private val owner    = AuthenticatedUser(UserId(ownerId))
  private var strangerId: String = _
  private var viewerId: String   = _
  private var shareTokenRepo: ShareTokenRepository = _
  private var routes: Route = _

  private val inMemoryFs = new FileSystem {
    private val files = new ConcurrentHashMap[String, Array[Byte]]()
    def write(path: String, bytes: Array[Byte]): Future[Unit] = { files.put(path, bytes); Future.successful(()) }
    def read(path: String): Future[Array[Byte]]                = Future.successful(files.get(path))
    def delete(path: String): Future[Unit]                     = { files.remove(path); Future.successful(()) }
    def exists(path: String): Future[Boolean]                  = Future.successful(files.containsKey(path))
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    startHarness()
    insightRepo = new OutputInsightRepository(ctx)
    shareTokenRepo = new ShareTokenRepository(ctx)
    strangerId = seedUser()
    viewerId = seedUser()
    val users = new UserRepository(db)
    import com.github.t3hnar.bcrypt._
    awaitDb(users.insert(User(owner.id, ownerEmail, Some("Owner"), Instant.now()), Some(ownerPassword.bcryptBounded(4))))
    val sessions = new UserSessionRepository {
      override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
        Future.successful(tokens.get(t).map(uid => AuthenticatedUser(UserId(uid))))
    }
    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, inMemoryFs, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      users, sessions, new UserPreferenceRepository(db), pipelineRepo, stepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo),
      imageUploadRepo = new ImageUploadRepository(ctx),
      mfaRepo = new MfaRepository(db),
      rateLimitConfig = RateLimitConfig(requestsPerWindow = 100000, windowSeconds = 60),
      dbContext = ctx
    ).routes
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  // ---------------------------------------------------------------- guarded request plumbing

  private val csrf = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  private def request(method: String, uri: String, as: Option[String] = None, body: Option[JsValue] = None): HttpRequest = {
    val base = HttpRequest(HttpMethods.getForKey(method).get, uri)
    val withBody = body.fold(base)(b => base.withEntity(ContentTypes.`application/json`, b.compactPrint))
    as.fold(withBody)(u => withBody.addHeader(Cookie(SessionCookies.Name -> signIn(u))).addHeader(csrf))
  }

  /** Sends `req` through the real route tree and runs the guard over body and every header value. */
  private def guarded(label: String, req: HttpRequest, expected: Option[StatusCode] = None): Unit = {
    req ~> routes ~> check {
      val ctxt = s"[$label] ${req.method.value} ${req.uri} (status $status)"
      status should not be StatusCodes.TooManyRequests
      withClue(ctxt + ": ")(status.intValue should be < 500)
      expected.foreach(e => withClue(ctxt + ": ")(status shouldBe e))
      OwnerIdGuard.assertNoOwnerId(responseAs[String], ownerId, ctxt)
      response.headers.foreach(h => OwnerIdGuard.assertNoOwnerId(s"${h.name}: ${h.value}", ownerId, s"$ctxt header ${h.name}"))
    }
  }

  // ---------------------------------------------------------------- seeding

  private def seedDashboard(public: Boolean): String = {
    val id = UUID.randomUUID().toString
    awaitDb(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'Dash', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    if (public)
      awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                              VALUES ('dashboard', $id, NULL, 'viewer', now())"""))
    id
  }

  private def seedToken(dashboardId: String): String = {
    val raw = "tok-" + UUID.randomUUID()
    awaitDb(shareTokenRepo.insert(ShareToken(ShareTokenId(UUID.randomUUID().toString), DashboardId(dashboardId), owner.id, TokenHashing.sha256Hex(raw), None, None, Instant.now())))
    raw
  }

  private def seedPanel(dashId: String, outputId: Option[String], controls: String = "[]"): String = {
    val panelId = UUID.randomUUID().toString
    awaitDb(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
               VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'output', ${outputId}, $controls::jsonb, ${ownerId}::uuid)"""
    ))
    panelId
  }

  /** Table Output with a schema, real snapshot rows and one history point, owned by `ownerId`. */
  private final case class Seeded(rowsPanel: String, insightPanel: String, formPanel: String)

  private def seedPanels(dashId: String): Seeded = {
    val now    = Instant.now()
    val source = awaitDb(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now), owner))
    val pipe   = awaitDb(pipelineRepo.create("pipe", Vector(source.id), owner)).getOrElse(throw new IllegalStateException("pipeline create failed"))
    val pid    = PipelineId(pipe.id)
    val output = awaitDb(outputRepo.insertInternal(pid, None, owner.id, "Rows Output", OutputKind.Table,
      schema = Vector(SchemaField("region", "string"), SchemaField("amount", "integer")), explicitRootId = None))
    awaitDb(snapshotRepo.overwriteRows(pid.value, None,
      Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(1))), explicitRootId = None))
    addPoint(output.id.value, pid.value, now, Some(5.0))
    val rows = seedPanel(dashId, Some(output.id.value), controls = """[{"id":"c1","kind":"dropdown","column":"region","label":"Region"}]""")
    val (ipid, ioid) = seedInsightOutput(ownerId)
    addInsight(ioid, ipid, now, markdown = Some("Revenue is up."))
    addPoint(ioid, ipid, now, Some(7.0))
    val insightP = seedPanel(dashId, Some(ioid))
    // HEL-1587: a form panel bound to a dataset owned by the distinctive id, and a stored layout naming every panel.
    val formSrc  = UUID.randomUUID().toString
    val formP    = UUID.randomUUID().toString
    val formCfg  = s"""{"dataSourceId":"$formSrc","fields":[{"sourceField":"qty","control":"number"}],"submit":{"writeMode":"append"}}"""
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
               VALUES ($formSrc::uuid, 'ds', 'dataset', '{}'::jsonb, ${ownerId}::uuid, now(), now(), '[{"name":"qty","type":"integer","required":true}]'::jsonb)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, form_config)
               VALUES ($formP, $dashId, 'F', $ownerId, now(), now(), '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'form', ${ownerId}::uuid, $formCfg::jsonb)"""
    )))
    val items  = Seq(rows, insightP, formP).zipWithIndex.map { case (id, i) => s"""{"panelId":"$id","x":${i * 3},"y":0,"w":3,"h":3}""" }.mkString(",")
    val layout = s"""{"lg":[$items],"md":[$items],"sm":[$items],"xs":[$items]}"""
    awaitDb(db.run(sqlu"""UPDATE dashboards SET layout = $layout::jsonb WHERE id = $dashId"""))
    Seeded(rows, insightP, formP)
  }

  // ---------------------------------------------------------------- cases

  "Public dashboard routes through the real ApiRoutes tree" should {
    "leak the owner id in no response for anonymous, share-token and non-owner callers" in {
      val publicDash  = seedDashboard(public = true)
      val privateDash = seedDashboard(public = false)
      val pub         = seedPanels(publicDash)
      val priv        = seedPanels(privateDash)
      val tok         = seedToken(privateDash)
      awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                              VALUES ('dashboard', $privateDash, $viewerId::uuid, 'viewer', now())"""))

      def paths(dash: String, s: Seeded, q: String): Seq[String] = {
        val sep = if (q.isEmpty) "?" else s"$q&"
        Seq(
          s"/api/dashboards/$dash/panels$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/rows$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/filter-capabilities$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/distinct-values${sep}column=region",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/distinct-values${sep}column=amount",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/output-meta$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/provenance$q",
          s"/api/dashboards/$dash/panels/${UUID.randomUUID()}/provenance$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/history$q",
          s"/api/dashboards/$dash/panels/${s.insightPanel}/history$q",
          s"/api/dashboards/$dash/panels/${s.insightPanel}/insight$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/insight$q", // 404: not an insight Output
          s"/api/dashboards/$dash/panels/${UUID.randomUUID()}/insight$q",
          s"/api/dashboards/$dash/panels/${UUID.randomUUID()}/history$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/rows${sep}offset=-1",
          s"/api/dashboards/$dash/panels/${s.formPanel}/form-schema$q",
          s"/api/dashboards/$dash/panels/${s.rowsPanel}/form-schema$q", // 404: not a form
          s"/api/dashboards/$dash/panels/${UUID.randomUUID()}/form-schema$q"
        )
      }
      val scenarios: Seq[(String, Option[String], Seq[String])] = Seq(
        ("anonymous / public", None, paths(publicDash, pub, "")),
        ("anonymous / private, no token", None, paths(privateDash, priv, "")),
        ("anonymous / private, wrong token", None, paths(privateDash, priv, "?token=wrong")),
        ("share-token / private", None, paths(privateDash, priv, s"?token=$tok")),
        ("stranger + token / private", Some(strangerId), paths(privateDash, priv, s"?token=$tok")),
        ("stranger, no token / private", Some(strangerId), paths(privateDash, priv, "")),
        ("viewer grantee / private", Some(viewerId), paths(privateDash, priv, "")),
        ("anonymous / nonexistent", None, paths(UUID.randomUUID().toString, pub, ""))
      )
      scenarios.foreach { case (label, user, ps) => ps.foreach(p => guarded(label, request("GET", p, user))) }
      request("GET", s"/api/dashboards/$publicDash/panels/${pub.rowsPanel}/rows") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("east")
      }
      // Non-vacuous: the new routes really carry the seeded data on a public dashboard.
      request("GET", s"/api/dashboards/$publicDash/panels/${pub.insightPanel}/insight") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Revenue is up.")
      }
      request("GET", s"/api/dashboards/$publicDash/panels/${pub.rowsPanel}/history") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("sparkline")
        responseAs[JsObject].fields("points").asInstanceOf[JsArray].elements should not be empty
      }
      request("GET", s"/api/dashboards/$publicDash/panels/${pub.rowsPanel}/insight") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
      // HEL-1587: the new routes carry real data on a public dashboard (the guard is not vacuous for them).
      request("GET", s"/api/dashboards/$publicDash/panels/${pub.formPanel}/form-schema") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("qty")
      }
      request("GET", s"/api/dashboards/$publicDash/panels") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("layout").asJsObject.fields("lg").asInstanceOf[JsArray].elements.size shouldBe 3
      }
      request("GET", s"/api/dashboards/$privateDash/panels/${priv.insightPanel}/insight") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /health" should {
    "carry no owner id" in {
      guarded("health", request("GET", "/health"), Some(StatusCodes.OK))
    }
  }

  "GET /api/uploads/image/:id" should {
    "serve an owner-uploaded image anonymously without the owner id, and 404 unknown and malformed ids" in {
      val svc    = new ImageUploadService(new ImageUploadRepository(ctx), inMemoryFs)
      val upload = awaitDb(svc.upload("PNG-BYTES-1248".getBytes("UTF-8"), "pic.png", owner)).getOrElse(fail("upload failed"))
      // Positive control: the row is really owned by the distinctive id.
      awaitDb(new ImageUploadRepository(ctx).findById(upload.id)).map(_.ownerId) shouldBe Some(owner.id)
      guarded("owner image, anonymous", request("GET", s"/api/uploads/image/${upload.id.value}"), Some(StatusCodes.OK))
      request("GET", s"/api/uploads/image/${upload.id.value}") ~> routes ~> check { responseAs[String] shouldBe "PNG-BYTES-1248" }
      guarded("owner image, stranger", request("GET", s"/api/uploads/image/${upload.id.value}", Some(strangerId)), Some(StatusCodes.OK))
      guarded("unknown id", request("GET", s"/api/uploads/image/${UUID.randomUUID()}"), Some(StatusCodes.NotFound))
      guarded("malformed id", request("GET", "/api/uploads/image/not-a-uuid"), Some(StatusCodes.NotFound))
    }
  }

  "GET and POST /api/connectors/completion" should {
    "carry no owner id for missing, unknown, expired, completed, stranger and valid-token cases" in {
      val connectorRepo = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
      val tokenRepo     = new ConnectorCompletionTokenRepository(ctx)
      def pending(): Connector =
        awaitDb(connectorRepo.createPending(owner.id, s"c-${UUID.randomUUID()}", "rest_api", "http://example.invalid", """{"authType":"bearer"}"""))
      def mint(c: Connector, expiresAt: Instant): String = {
        val raw = ConnectorCompletionService.generateRawToken()
        awaitDb(tokenRepo.mintSupersedingPrior(c.id, owner.id, TokenHashing.sha256Hex(raw), expiresAt))
        raw
      }
      val live      = pending()
      val liveTok   = mint(live, Instant.now().plusSeconds(3600))
      val expired   = pending()
      val expiredTok = mint(expired, Instant.now().minusSeconds(60))
      val done      = pending()
      val doneTok   = mint(done, Instant.now().plusSeconds(3600))
      val credId    = UUID.randomUUID().toString
      awaitDb(db.run(DBIO.seq(
        sqlu"""INSERT INTO connector_credentials (id, user_id, name, key_id, wrapped_data_key, nonce_dek, ciphertext, nonce_value)
                 VALUES ($credId::uuid, ${ownerId}::uuid, 'c', 'k', decode('00','hex'), decode('00','hex'), decode('00','hex'), decode('00','hex'))""",
        sqlu"""UPDATE connectors SET credential_id = $credId::uuid WHERE id = ${done.id.value}::uuid"""
      )))
      // Positive controls: every connector is owned by the distinctive id; pending/completed as intended.
      awaitDb(connectorRepo.findByIdUnscoped(live.id)).map(c => (c.ownerId, c.isPending)) shouldBe Some((owner.id, true))
      awaitDb(connectorRepo.findByIdUnscoped(done.id)).map(c => (c.ownerId, c.isPending)) shouldBe Some((owner.id, false))
      awaitDb(tokenRepo.findByHash(TokenHashing.sha256Hex(liveTok))).isDefined shouldBe true

      def post(token: String, credential: String = "secret-credential", as: Option[String] = None): HttpRequest =
        request("POST", "/api/connectors/completion", as, Some(JsObject("token" -> JsString(token), "credential" -> JsString(credential))))
      val refusal = Some(StatusCodes.BadRequest)
      guarded("GET no token", request("GET", "/api/connectors/completion"))
      guarded("GET unknown token", request("GET", "/api/connectors/completion?token=nope"), refusal)
      guarded("GET valid token, anonymous", request("GET", s"/api/connectors/completion?token=$liveTok"), Some(StatusCodes.OK))
      guarded("GET valid token, stranger", request("GET", s"/api/connectors/completion?token=$liveTok", Some(strangerId)), refusal)
      guarded("GET expired token", request("GET", s"/api/connectors/completion?token=$expiredTok"), refusal)
      guarded("GET completed connector", request("GET", s"/api/connectors/completion?token=$doneTok"), refusal)
      guarded("POST unknown token", post("nope"), refusal)
      guarded("POST empty token", post(""), refusal)
      guarded("POST valid token, stranger", post(liveTok, as = Some(strangerId)), refusal)
      guarded("POST expired token", post(expiredTok), refusal)
      guarded("POST completed connector", post(doneTok), refusal)
      guarded("POST empty credential", post(liveTok, credential = ""), refusal)
    }
  }

  "The /api/auth/* error bodies" should {
    "carry no owner id for the owner's email, in either case, on every public auth route" in {
      val users = new UserRepository(db)
      // Positive control: the account behind the email IS the distinctive id (a register-minted id would be random).
      awaitDb(users.findByEmail("OWNER@Example.Test")).map(_.id) shouldBe Some(owner.id)
      val mfaRepo = new MfaRepository(db)
      awaitDb(mfaRepo.upsertUserMfa(UserMfa(owner.id, TotpSupport.generateSecret(), enabled = true, lastUsedStep = 0L, createdAt = Instant.now(), verifiedAt = Some(Instant.now()))))
      awaitDb(mfaRepo.findUserMfa(owner.id)).map(_.enabled) shouldBe Some(true)

      def login(email: String, password: String): HttpRequest =
        request("POST", "/api/auth/login", body = Some(JsObject("email" -> JsString(email), "password" -> JsString(password))))
      def register(email: String): HttpRequest =
        request("POST", "/api/auth/register", body = Some(JsObject("email" -> JsString(email), "password" -> JsString("password-1248"))))
      def verify(challenge: String, code: String): HttpRequest =
        request("POST", "/api/auth/mfa/verify", body = Some(JsObject("challengeToken" -> JsString(challenge), "code" -> JsString(code))))

      guarded("login wrong password", login(ownerEmail, "wrong-password"), Some(StatusCodes.Unauthorized))
      guarded("login wrong password, case variant", login("OWNER@Example.Test", "wrong-password"), Some(StatusCodes.Unauthorized))
      guarded("login unknown email", login("nobody@example.test", "wrong-password"), Some(StatusCodes.Unauthorized))
      guarded("register duplicate", register(ownerEmail), Some(StatusCodes.Conflict))
      guarded("register duplicate, case variant", register("OWNER@Example.Test"), Some(StatusCodes.Conflict))

      // Positive control: a correct-password login reaches the owner's MFA challenge (so the hash is wired to the id).
      val challenge = login(ownerEmail, ownerPassword) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("challengeToken").convertTo[String]
      }
      guarded("mfa verify unknown challenge", verify("no-such-challenge", "000000"), Some(StatusCodes.Unauthorized))
      guarded("mfa verify valid challenge, bad code", verify(challenge, "000000"), Some(StatusCodes.Unauthorized))
      guarded("mfa verify valid challenge, bad backup code", verify(challenge, "not-a-code"), Some(StatusCodes.Unauthorized))

      guarded("google start", request("GET", "/api/auth/google"), Some(StatusCodes.Found))
      guarded("google callback, bad state", request("GET", "/api/auth/google/callback?state=forged&code=x"), Some(StatusCodes.BadRequest))
      guarded("google callback, missing state", request("GET", "/api/auth/google/callback"), Some(StatusCodes.BadRequest))
    }
  }
}
