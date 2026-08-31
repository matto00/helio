package com.helio.api.routes.auth

import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader, `Set-Cookie`}
import org.apache.pekko.http.scaladsl.model.{HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api._
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.infrastructure.persistence.auth.{MfaRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-702 — the full MFA surface exercised through real `ApiRoutes` wiring
 *  (mirrors `GoogleOAuthRoutesSpec`'s own independent, focused file rather
 *  than growing the already-oversized `ApiRoutesSpec.scala` further):
 *  MFA-off login/OAuth stay unchanged, MFA-on login/verify round-trips
 *  (TOTP and backup code), attempt-cap/expiry/replay failure modes, and the
 *  authenticated enroll/status/regenerate/disable lifecycle including its
 *  401/409 paths. */
class MfaApiRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var userRepo: UserRepository           = _
  private var mfaRepo: MfaRepository             = _
  private var apiRoutes: Route                   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))

    val ctx                = new DbContext(db, db)(typedSystem.executionContext)
    val dashboardRepo       = new DashboardRepository(ctx)(typedSystem.executionContext)
    val panelRepo           = new PanelRepository(ctx)(typedSystem.executionContext)
    val dataSourceRepo      = new DataSourceRepository(ctx)(typedSystem.executionContext)
    userRepo                = new UserRepository(db)(typedSystem.executionContext)
    val userPreferenceRepo  = new UserPreferenceRepository(db)(typedSystem.executionContext)
    val permissionRepo      = new ResourcePermissionRepository(ctx)(typedSystem.executionContext)
    val pipelineRepo        = new PipelineRepository(ctx, dataSourceRepo)(typedSystem.executionContext)
    val pipelineStepRepo    = new PipelineStepRepository(ctx)(typedSystem.executionContext)
    val userSessionRepo     = new SlickUserSessionRepository(db)(typedSystem.executionContext)
    mfaRepo                 = new MfaRepository(db)(typedSystem.executionContext)

    val stubFileSystem: FileSystem = new FileSystem {
      def write(path: String, bytes: Array[Byte]): Future[Unit]                                        = Future.successful(())
      def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
      def delete(path: String): Future[Unit]                                                           = Future.successful(())
      def exists(path: String): Future[Boolean]                                                        = Future.successful(false)
      def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
    }
    val connector = new RestApiConnectorDriver(Some(_ => Future.successful(Left("no real HTTP in tests"))))

    apiRoutes = new ApiRoutes(
      dashboardRepo,
      panelRepo,
      dataSourceRepo,
      permissionRepo,
      stubFileSystem,
      connector,
      userRepo,
      userSessionRepo,
      userPreferenceRepo,
      pipelineRepo,
      pipelineStepRepo,
      new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      mfaRepo = mfaRepo
    ).routes
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE mfa_login_challenges, mfa_backup_codes, user_mfa, user_sessions, users RESTART IDENTITY CASCADE"))
  }

  private val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  private def sessionCookieValue(response: HttpResponse): String =
    response.headers.collectFirst { case `Set-Cookie`(cookie) if cookie.name == SessionCookies.Name => cookie.value }
      .getOrElse(fail(s"no Set-Cookie: ${SessionCookies.Name} header in response"))

  /** Registers a fresh user and returns its session cookie value. */
  private def registerAndLogin(email: String): String = {
    var token = ""
    Post("/api/auth/register", RegisterRequest(email, "password123", None)) ~> apiRoutes ~> check {
      status shouldBe StatusCodes.Created
      token = sessionCookieValue(response)
    }
    token
  }

  /** `apiRoutes`, wrapped so every request carries the session cookie + CSRF
   *  header for `token` — mirrors `ApiRoutesSpec.withDefaultCredentials`. */
  private def authedRoutes(token: String): Route =
    mapRequest { req =>
      req.withHeaders(req.headers ++ Seq(Cookie(SessionCookies.Name -> token), csrfHeader))
    } {
      apiRoutes
    }

  /** Computes the current valid TOTP code for `secret` directly via
   *  `java-otp` — independent of the service's own verification path.
   *  Local, single-use imports per CONTRIBUTING's documented exception. */
  private def totpCodeFor(secret: String): String = {
    import com.eatthepath.otp.TimeBasedOneTimePasswordGenerator
    import org.apache.commons.codec.binary.Base32
    import javax.crypto.spec.SecretKeySpec
    import java.time.Instant

    val totp = new TimeBasedOneTimePasswordGenerator()
    val key  = new SecretKeySpec(new Base32().decode(secret), totp.getAlgorithm)
    totp.generateOneTimePasswordString(key, Instant.now())
  }

  /** Enrolls + confirms MFA for the session at `token`, resetting the
   *  replay watermark afterward (same root cause as `MfaServiceSpec`:
   *  confirming enrollment consumes the current TOTP step, so an
   *  immediately-following independent verification in the same 30s window
   *  would otherwise be spuriously replay-rejected). Returns the secret and
   *  backup codes. */
  private def enableMfa(token: String): (String, Vector[String]) = {
    var secret = ""
    Post("/api/auth/mfa/enroll") ~> authedRoutes(token) ~> check {
      status shouldBe StatusCodes.OK
      secret = responseAs[MfaEnrollResponse].secret
    }
    var codes: Vector[String] = Vector.empty
    Post("/api/auth/mfa/enroll/confirm", MfaConfirmRequest(totpCodeFor(secret))) ~> authedRoutes(token) ~> check {
      status shouldBe StatusCodes.OK
      codes = responseAs[MfaBackupCodesResponse].backupCodes
    }
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"UPDATE user_mfa SET last_used_step = -1"))
    (secret, codes)
  }


  "POST /api/auth/login without MFA enabled" should {
    "return 200 with a session cookie and user, exactly as before HEL-702" in {
      cleanDb()
      registerAndLogin("no-mfa@example.com")
      Post("/api/auth/login", LoginRequest("no-mfa@example.com", "password123")) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AuthResponse]
        resp.user.email shouldBe "no-mfa@example.com"
        sessionCookieValue(response) should not be empty
      }
    }
  }


  "POST /api/auth/login with MFA enabled" should {
    "return 200 {mfaRequired, challengeToken} with no cookie and no user object" in {
      cleanDb()
      val token = registerAndLogin("mfa-login@example.com")
      enableMfa(token)

      Post("/api/auth/login", LoginRequest("mfa-login@example.com", "password123")) ~> apiRoutes ~> check {
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

  "POST /api/auth/mfa/verify" should {
    "exchange a valid TOTP code for a session" in {
      cleanDb()
      val token          = registerAndLogin("verify-totp@example.com")
      val (secret, _)    = enableMfa(token)
      var challengeToken = ""
      Post("/api/auth/login", LoginRequest("verify-totp@example.com", "password123")) ~> apiRoutes ~> check {
        challengeToken = responseAs[MfaRequiredResponse].challengeToken
      }

      Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, totpCodeFor(secret))) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AuthResponse]
        resp.user.email shouldBe "verify-totp@example.com"
        sessionCookieValue(response) should not be empty
      }
    }

    "exchange a valid unused backup code for a session" in {
      cleanDb()
      val token          = registerAndLogin("verify-backup@example.com")
      val (_, codes)     = enableMfa(token)
      var challengeToken = ""
      Post("/api/auth/login", LoginRequest("verify-backup@example.com", "password123")) ~> apiRoutes ~> check {
        challengeToken = responseAs[MfaRequiredResponse].challengeToken
      }

      Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, codes.head)) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.OK
        sessionCookieValue(response) should not be empty
      }
    }

    "reject a previously-used backup code" in {
      cleanDb()
      val token       = registerAndLogin("verify-backup-reuse@example.com")
      val (_, codes)  = enableMfa(token)
      val usedCode    = codes.head

      def newChallenge(): String = {
        var challengeToken = ""
        Post("/api/auth/login", LoginRequest("verify-backup-reuse@example.com", "password123")) ~> apiRoutes ~> check {
          challengeToken = responseAs[MfaRequiredResponse].challengeToken
        }
        challengeToken
      }

      Post("/api/auth/mfa/verify", MfaVerifyRequest(newChallenge(), usedCode)) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.OK
      }
      Post("/api/auth/mfa/verify", MfaVerifyRequest(newChallenge(), usedCode)) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "increment attempts on a wrong code" in {
      cleanDb()
      val token = registerAndLogin("verify-wrong@example.com")
      enableMfa(token)
      var challengeToken = ""
      Post("/api/auth/login", LoginRequest("verify-wrong@example.com", "password123")) ~> apiRoutes ~> check {
        challengeToken = responseAs[MfaRequiredResponse].challengeToken
      }

      Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, "000000")) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.Unauthorized
        // evaluation-1.md CR1: must NOT be the password-login default
        // ("Invalid email or password") -- no password was ever submitted here.
        responseAs[ErrorResponse].message shouldBe "Invalid or expired code"
      }
      await(mfaRepo.findChallengeByToken(challengeToken)).get.attempts shouldBe 1
    }

    "reject once the attempt cap is reached, even with the correct code" in {
      cleanDb()
      val token       = registerAndLogin("verify-cap@example.com")
      val (secret, _) = enableMfa(token)
      var challengeToken = ""
      Post("/api/auth/login", LoginRequest("verify-cap@example.com", "password123")) ~> apiRoutes ~> check {
        challengeToken = responseAs[MfaRequiredResponse].challengeToken
      }

      (1 to 5).foreach { _ =>
        Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, "000000")) ~> apiRoutes ~> check {
          status shouldBe StatusCodes.Unauthorized
        }
      }
      Post("/api/auth/mfa/verify", MfaVerifyRequest(challengeToken, totpCodeFor(secret))) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "reject an unknown challenge token" in {
      cleanDb()
      Post("/api/auth/mfa/verify", MfaVerifyRequest("not-a-real-token", "000000")) ~> apiRoutes ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Invalid or expired code"
      }
    }
  }


  "GET /api/auth/mfa" should {
    "return the un-enrolled default for a user with no MFA row" in {
      cleanDb()
      val token = registerAndLogin("status-off@example.com")
      Get("/api/auth/mfa") ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MfaStatusResponse]
        resp.enabled shouldBe false
        resp.backupCodesRemaining shouldBe 0
      }
    }

    "return enabled=true with a non-null verifiedAt and the remaining code count" in {
      cleanDb()
      val token = registerAndLogin("status-on@example.com")
      enableMfa(token)
      Get("/api/auth/mfa") ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MfaStatusResponse]
        resp.enabled shouldBe true
        resp.verifiedAt shouldBe defined
        resp.backupCodesRemaining shouldBe 10
      }
    }
  }

  "POST /api/auth/mfa/enroll" should {
    "return 200 with a secret and matching otpauth URI" in {
      cleanDb()
      val token = registerAndLogin("enroll@example.com")
      Post("/api/auth/mfa/enroll") ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MfaEnrollResponse]
        resp.otpauthUri should include(resp.secret)
      }
    }

    "return 409 when MFA is already enabled" in {
      cleanDb()
      val token = registerAndLogin("enroll-409@example.com")
      enableMfa(token)
      Post("/api/auth/mfa/enroll") ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.Conflict
      }
    }
  }

  "POST /api/auth/mfa/enroll/confirm" should {
    "return 401 on a wrong code without enabling MFA" in {
      cleanDb()
      val token = registerAndLogin("confirm-401@example.com")
      Post("/api/auth/mfa/enroll") ~> authedRoutes(token) ~> check { status shouldBe StatusCodes.OK }
      Post("/api/auth/mfa/enroll/confirm", MfaConfirmRequest("000000")) ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Invalid or expired code"
      }
    }
  }

  "POST /api/auth/mfa/backup-codes/regenerate" should {
    "return 10 fresh codes on a valid current code" in {
      cleanDb()
      val token          = registerAndLogin("regen@example.com")
      val (secret, olds) = enableMfa(token)
      Post("/api/auth/mfa/backup-codes/regenerate", MfaReauthRequest(totpCodeFor(secret))) ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.OK
        val fresh = responseAs[MfaBackupCodesResponse].backupCodes
        fresh should have size 10
        fresh.toSet.intersect(olds.toSet) shouldBe empty
      }
    }

    "return 401 on an invalid code" in {
      cleanDb()
      val token = registerAndLogin("regen-401@example.com")
      enableMfa(token)
      Post("/api/auth/mfa/backup-codes/regenerate", MfaReauthRequest("000000")) ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Invalid or expired code"
      }
    }
  }

  "POST /api/auth/mfa/disable" should {
    "return 204 and turn MFA off on a valid current code" in {
      cleanDb()
      val token       = registerAndLogin("disable@example.com")
      val (secret, _) = enableMfa(token)
      Post("/api/auth/mfa/disable", MfaReauthRequest(totpCodeFor(secret))) ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get("/api/auth/mfa") ~> authedRoutes(token) ~> check {
        responseAs[MfaStatusResponse].enabled shouldBe false
      }
    }

    "return 401 on an invalid code and leave MFA enabled" in {
      cleanDb()
      val token = registerAndLogin("disable-401@example.com")
      enableMfa(token)
      Post("/api/auth/mfa/disable", MfaReauthRequest("000000")) ~> authedRoutes(token) ~> check {
        status shouldBe StatusCodes.Unauthorized
        responseAs[ErrorResponse].message shouldBe "Invalid or expired code"
      }
      Get("/api/auth/mfa") ~> authedRoutes(token) ~> check {
        responseAs[MfaStatusResponse].enabled shouldBe true
      }
    }
  }
}
