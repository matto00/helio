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
import com.helio.infrastructure.UserRepository
import com.helio.services.{AuthService, UserTierConfig}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend

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
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  // HEL-703: `tierConfig` defaults to an empty allowlist (no owner emails, default beta cap) so
  // every pre-existing test in this file is unaffected; allowlist-specific tests below pass their
  // own `UserTierConfig` directly (design.md D4 — specs inject their own, never `fromEnv()`).
  private def makeAuthService(tierConfig: UserTierConfig = UserTierConfig(Set.empty, UserTierConfig.DefaultBetaDailyMessageLimit)): AuthService =
    new AuthService(userRepo, tierConfig)(typedSystem.executionContext)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE user_sessions, users RESTART IDENTITY CASCADE"))
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
        // HEL-703: not on the (empty, default) allowlist — defaults to free.
        resp.user.tier shouldBe "free"
        // HEL-287 CodeQL #8: the session token is delivered via `Set-Cookie`
        // only — never in the JSON body.
        header[`Set-Cookie`].map(_.cookie.name) shouldBe Some("helio_session")
        header[`Set-Cookie`].map(_.cookie.value) should not be Some("")
      }
    }

    // HEL-703 tasks.md 6.3 (design.md D4) — first-login creation assigns owner per the allowlist.
    "assigns tier = owner on first-time creation when the email is on the allowlist" in {
      cleanDb()

      val profile = GoogleProfile("google-sub-owner-create", Some("owner-create@example.com"), Some("Owner"), None)
      val tierConfig = UserTierConfig(Set("owner-create@example.com"), UserTierConfig.DefaultBetaDailyMessageLimit)
      val oauthRoutes = new OAuthRoutes(makeAuthService(tierConfig), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-owner-create")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(profile)
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        stateParam = extractStateFromLocation(header("Location").map(_.value()).getOrElse(""))
      }
      Get(s"/api/auth/google/callback?code=some-code&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AuthResponse].user.tier shouldBe "owner"
      }
    }

    // HEL-703 tasks.md 6.3 (design.md D4) — a returning user is promoted when their email joins
    // the allowlist between logins, and the promotion is persisted (not just reflected in this
    // one response).
    "promotes a returning user to owner when their email is on the allowlist, and persists it" in {
      cleanDb()

      val profile = GoogleProfile("google-sub-owner-promote", Some("owner-promote@example.com"), Some("Promotee"), None)

      def routesWith(tierConfig: UserTierConfig): Route = {
        val oauthRoutes = new OAuthRoutes(makeAuthService(tierConfig), "test-client-id", "test-secret", "http://localhost/callback") {
          override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
            Future.successful("access-token-owner-promote")
          override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
            Future.successful(profile)
        }
        pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }
      }

      // First login — not yet on the allowlist, created as free.
      val notYetAllowlisted = routesWith(UserTierConfig(Set.empty, UserTierConfig.DefaultBetaDailyMessageLimit))
      var stateParam1 = ""
      Get("/api/auth/google") ~> notYetAllowlisted ~> check {
        stateParam1 = extractStateFromLocation(header("Location").map(_.value()).getOrElse(""))
      }
      Get(s"/api/auth/google/callback?code=code-1&state=$stateParam1") ~> notYetAllowlisted ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AuthResponse].user.tier shouldBe "free"
      }

      // Second login — now on the allowlist: promoted, and the response reflects it immediately.
      val nowAllowlisted = routesWith(UserTierConfig(Set("owner-promote@example.com"), UserTierConfig.DefaultBetaDailyMessageLimit))
      var stateParam2 = ""
      Get("/api/auth/google") ~> nowAllowlisted ~> check {
        stateParam2 = extractStateFromLocation(header("Location").map(_.value()).getOrElse(""))
      }
      Get(s"/api/auth/google/callback?code=code-2&state=$stateParam2") ~> nowAllowlisted ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AuthResponse].user.tier shouldBe "owner"
      }

      // Persisted — a raw read confirms it, not just this response.
      import slick.jdbc.PostgresProfile.api._
      val storedTier = await(db.run(sql"SELECT tier FROM users WHERE email = 'owner-promote@example.com'".as[String].head))
      storedTier shouldBe "owner"
    }

    // HEL-703 tasks.md 6.3 (design.md D4) — a profile with no `email` falls back to the synthetic
    // `google:<sub>@helio.invalid` address. That shape can never coincidentally match a real
    // admin's allowlist entry, so a user who never shared their email stays `free` even when a
    // (realistic, unrelated) owner email is configured.
    "a profile with no email falls back to google:<sub>@helio.invalid and stays free even with an allowlist configured" in {
      cleanDb()

      val profile = GoogleProfile("google-sub-no-email", None, Some("No Email"), None)
      val tierConfig = UserTierConfig(Set("mattheworr018@gmail.com"), UserTierConfig.DefaultBetaDailyMessageLimit)
      val oauthRoutes = new OAuthRoutes(makeAuthService(tierConfig), "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-no-email")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(profile)
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { oauthRoutes.routes } }

      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        stateParam = extractStateFromLocation(header("Location").map(_.value()).getOrElse(""))
      }
      Get(s"/api/auth/google/callback?code=some-code&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AuthResponse]
        resp.user.email shouldBe "google:google-sub-no-email@helio.invalid"
        resp.user.tier shouldBe "free"
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
}
