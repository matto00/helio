package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.routes.AuthRoutes
import com.helio.infrastructure.UserRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
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
    embeddedPostgres = EmbeddedPostgres.start()

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
      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

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
      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

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
      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

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
      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

      Get("/api/auth/google/callback?code=some-code") ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("state")
      }
    }

    "return 400 when state is invalid" in {
      cleanDb()
      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback")
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

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
      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-abc")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(profile)
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

      var stateParam = ""
      Get("/api/auth/google") ~> route ~> check {
        val location = header("Location").map(_.value()).getOrElse("")
        stateParam = location.split("state=").last.split("&").head
      }

      Get(s"/api/auth/google/callback?code=auth-code-123&state=$stateParam") ~> route ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AuthResponse]
        resp.token should not be empty
        resp.expiresAt should not be empty
        resp.user.email shouldBe "alice@example.com"
        resp.user.displayName shouldBe Some("Alice")
        resp.user.avatarUrl shouldBe Some("https://pic.url/alice")
      }
    }

    "return 200 with same user on second login (returning Google user)" in {
      cleanDb()

      val profile = GoogleProfile("google-sub-002", Some("bob@example.com"), Some("Bob"), Some("https://pic.url/bob"))

      def makeAuthRoutes() = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.successful("access-token-xyz")
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(profile)
      }

      // First login — creates user
      var firstUserId = ""
      val routes1     = makeAuthRoutes()
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
      val routes2     = makeAuthRoutes()
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

      val authRoutes = new AuthRoutes(userRepo, "test-client-id", "test-secret", "http://localhost/callback") {
        override protected def exchangeCodeForTokenImpl(code: String): Future[String] =
          Future.failed(new RuntimeException("Google token exchange failed: 400 Bad Request"))
        override protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] =
          Future.successful(GoogleProfile("x", None, None, None))
      }
      val route: Route = pathPrefix("api") { pathPrefix("auth") { authRoutes.routes } }

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
}
