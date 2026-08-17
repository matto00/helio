package com.helio.api

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.`Set-Cookie`
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.routes.OAuthRoutes
import com.helio.domain.{UserId, UserMfa}
import com.helio.infrastructure.{MfaRepository, UserRepository}
import com.helio.services.{AuthService, MfaService}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend

import java.time.Instant
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** Tests for GET /api/auth/google and GET /api/auth/google/callback.
  *
  * Google HTTP calls are replaced by a subclass of AuthRoutes that overrides
  * `exchangeCodeForToken` and `fetchGoogleProfile` so no real network requests
  * are made. The DB layer (user insert/upsert) uses a real embedded Postgres
  * instance to exercise the full repository path.
  */
class GoogleOAuthRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with Directives
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var userRepo: UserRepository           = _
  private var mfaRepo: MfaRepository             = _

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

    userRepo = new UserRepository(db)(typedSystem.executionContext)
    mfaRepo  = new MfaRepository(db)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  // HEL-702: defaulted so every existing `makeAuthService()` call site (this
  // whole file, pre-HEL-702) compiles and behaves exactly as before —
  // `AuthService`'s own defaulted `mfaService` ctor param is the thing doing
  // the work here, this helper just forwards it.
  private def makeAuthService(mfaService: Option[MfaService] = None): AuthService =
    new AuthService(userRepo, mfaService)(typedSystem.executionContext)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE mfa_login_challenges, mfa_backup_codes, user_mfa, user_sessions, users RESTART IDENTITY CASCADE"))
  }

  // ─── Configurable stub for Google HTTP calls ──────────────────────────────

  // Helper to extract the state param from a redirect URL
  private def extractStateFromLocation(location: String): String =
    location.split("state=").last.split("&").head

  // ─── Tests ────────────────────────────────────────────────────────────────

  "GET /api/auth/google" should {

    "redirect to Google consent URL" in {
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      Get("/api/auth/google") ~> route ~> check {
        status shouldBe StatusCodes.Found
        val location = header("Location").map(_.value()).getOrElse("")
        location should include("accounts.google.com")
        location should include("test-client-id")
        location should include("state=")
      }
    }
  }

  "GET /api/auth/google/callback" should {

    "return 400 when error=access_denied" in {
      cleanDb()
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      // First get a valid state by hitting the initiation route
      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam = location.split("state=").last.split("&").head
      }

      Get(s"/api/auth/google/callback?error=access_denied&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message shouldBe "OAuth access denied"
      }
    }

    "return 400 when error is another value" in {
      cleanDb()
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam = location.split("state=").last.split("&").head
      }

      Get(s"/api/auth/google/callback?error=server_error&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message shouldBe "OAuth error: server_error"
      }
    }

    "return 400 when state is missing" in {
      cleanDb()
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      Get("/api/auth/google/callback?code=some-code") ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("state")
      }
    }

    "return 400 when state is invalid" in {
      cleanDb()
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      Get("/api/auth/google/callback?code=some-code&state=bad-state") ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("state")
      }
    }
  }

  "GET /api/auth/google/callback happy path" should {

    "return 200 with AuthResponse for a new Google user" in {
      cleanDb()

      val profile    = GoogleProfile("google-sub-001", Some("alice@example.com"), Some("Alice"), Some("https://pic.url/alice"))
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-abc")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(profile)
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam = location.split("state=").last.split("&").head
      }

      Get(s"/api/auth/google/callback?code=auth-code-123&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AuthResponse]
        resp.expiresAt should not be empty
        resp.user.email shouldBe "alice@example.com"
        resp.user.displayName shouldBe Some("Alice")
        resp.user.avatarUrl shouldBe Some("https://pic.url/alice")
        // HEL-287 CodeQL #8: the session token is delivered via `Set-Cookie`
        // only — never in the JSON body.
        header[`Set-Cookie`].map(_.cookie.name) shouldBe Some("helio_session")
        header[`Set-Cookie`].map(_.cookie.value) should not be Some("")
      }
    }

    "return 200 with same user on second login (returning Google user)" in {
      cleanDb()

      val profile = GoogleProfile("google-sub-002", Some("bob@example.com"), Some("Bob"), Some("https://pic.url/bob"))

      def makeOAuthRoutes() = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-xyz")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(profile)
      }

      // First login — creates user
      var firstUserId = ""
      val routes1     = makeOAuthRoutes()
      val route1: Route = pathPrefix("api") { pathPrefix("auth") { routes1.routes } }

      var stateParam1 = ""
      Get("/api/auth/google") ~> route1 ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam1 = location.split("state=").last.split("&").head
      }
      Get(s"/api/auth/google/callback?code=code-first&state=$stateParam1") ~> route1 ~> check {
        status shouldBe StatusCodes.OK
        firstUserId = responseAs[AuthResponse].user.id
      }

      // Second login — same google_id, should return same user ID, no duplicate
      val routes2     = makeOAuthRoutes()
      val route2: Route = pathPrefix("api") { pathPrefix("auth") { routes2.routes } }

      var stateParam2 = ""
      Get("/api/auth/google") ~> route2 ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam2 = location.split("state=").last.split("&").head
      }
      Get(s"/api/auth/google/callback?code=code-second&state=$stateParam2") ~> route2 ~> check {
        status shouldBe StatusCodes.OK
        val secondUserId = responseAs[AuthResponse].user.id
        secondUserId shouldBe firstUserId
      }

      // Confirm no duplicate records in DB
      import slick.jdbc.PostgresProfile.api._
      val count = await(db.run(sql"SELECT COUNT(*) FROM users WHERE google_id = 'google-sub-002'".as[Int].head))
      count shouldBe 1
    }
  }

  "GET /api/auth/google/callback token-exchange failure" should {

    "return 502 when Google token exchange fails" in {
      cleanDb()

      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.failed(new RuntimeException("Google token exchange failed: 400 Bad Request"))
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(GoogleProfile("x", None, None, None))
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam = location.split("state=").last.split("&").head
      }

      Get(s"/api/auth/google/callback?code=bad-code&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.BadGateway
        responseAs[ErrorResponse].message shouldBe "Failed to exchange authorization code"
      }
    }
  }

  "GET /api/auth/google/callback unexpected internal failure" should {

    // HEL-311: any Failure that isn't a recognized upstream OAuth error must
    // return a generic 500 body — never `ex.getMessage` — with the exception
    // detail logged server-side (full exception + stack trace).
    "return a generic 500 without leaking the exception message, and log the detail" in {
      cleanDb()

      val secret = "leaky-internal-detail-should-not-surface-hel311"
      val oauthRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-abc")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.failed(new RuntimeException(secret))
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      val logbackLogger = LoggerFactory.getLogger(oauthRoutes.getClass).asInstanceOf[LogbackLogger]
      val appender       = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        var stateParam = ""
        Get("/api/auth/google") ~> route ~> check {
          val location = header("Location").map(_.value()).getOrElse("")
          stateParam = location.split("state=").last.split("&").head
        }

        Get(s"/api/auth/google/callback?code=some-code&state=$stateParam") ~> route ~> check {
          status shouldBe StatusCodes.InternalServerError
          val body = responseAs[String]
          body should not include secret
          body should include("Internal server error")
        }

        // The full exception (with the secret detail) must be logged server-side.
        import scala.jdk.CollectionConverters._
        val events = appender.list.asScala.toSeq
        events should not be empty
        val logged = events.find(e => Option(e.getThrowableProxy).exists(_.getMessage == secret))
        logged shouldBe defined
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }

  "GET /api/auth/google/callback with MFA enabled (HEL-702)" should {

    "return 200 {mfaRequired, challengeToken} with no Set-Cookie, instead of a session" in {
      cleanDb()

      val profile = GoogleProfile("google-sub-mfa", Some("mfa-oauth@example.com"), Some("MFA User"), None)

      // First callback (no MFA yet) creates the user — same happy-path
      // AuthService every other test in this file uses.
      val firstRoutes = new OAuthRoutes(makeAuthService(), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] = Future.successful("access-token-mfa-1")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] = Future.successful(profile)
      }
      val firstRoute: Route = pathPrefix("api") { pathPrefix("auth") { firstRoutes.routes } }

      var stateParam1 = ""
      Get("/api/auth/google") ~> firstRoute ~> check {
        stateParam1 = extractStateFromLocation(header("Location").map(_.value()).getOrElse(""))
      }
      var userId = ""
      Get(s"/api/auth/google/callback?code=mfa-code-1&state=$stateParam1") ~> firstRoute ~> check {
        status shouldBe StatusCodes.OK
        userId = responseAs[AuthResponse].user.id
      }

      // Enable MFA directly for that user (bypassing the enrollment HTTP
      // surface, which is out of scope for this OAuth-focused spec).
      val now = Instant.now()
      await(mfaRepo.upsertUserMfa(UserMfa(UserId(userId), "AAAAAAAAAAAAAAAA", enabled = false, 0L, now, None)))
      await(mfaRepo.confirmEnrollment(UserId(userId), 0L, now))

      // Second callback, this time through an MFA-aware AuthService — same
      // returning-Google-user path as "return 200 with same user on second
      // login" above, but now gated.
      val mfaService  = new MfaService(mfaRepo, userRepo)(typedSystem.executionContext)
      val secondRoutes = new OAuthRoutes(makeAuthService(Some(mfaService)), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] = Future.successful("access-token-mfa-2")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] = Future.successful(profile)
      }
      val secondRoute: Route = pathPrefix("api") { pathPrefix("auth") { secondRoutes.routes } }

      var stateParam2 = ""
      Get("/api/auth/google") ~> secondRoute ~> check {
        stateParam2 = extractStateFromLocation(header("Location").map(_.value()).getOrElse(""))
      }
      Get(s"/api/auth/google/callback?code=mfa-code-2&state=$stateParam2") ~> secondRoute ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MfaRequiredResponse]
        resp.mfaRequired shouldBe true
        resp.challengeToken should not be empty
        header[`Set-Cookie`] shouldBe None
        val body = responseAs[String]
        body should not include "\"user\""
      }
    }
  }
}
