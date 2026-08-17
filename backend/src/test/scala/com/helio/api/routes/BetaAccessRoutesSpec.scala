package com.helio.api.routes

import com.helio.api.{JsonProtocols, UserResponse}
import com.helio.domain.{AuthenticatedUser, UserId}
import com.helio.email.EmailSender
import com.helio.infrastructure.{DbContext, InviteCodeRepository, TokenHashing, UserRepository}
import com.helio.services.{BetaAccessService, UserTierConfig}
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContextExecutor, Future}

/** HEL-704 tasks.md 7.4 — HTTP-shell coverage for `POST /api/beta-access/request` +
 *  `POST /api/beta-access/redeem`: status codes per the `beta-access-request`/
 *  `invite-code-redemption` spec scenarios. Business-logic depth belongs to
 *  `BetaAccessServiceSpec` (stub `EmailSender`, no real network call anywhere in this suite
 *  either); this spec only exercises the HTTP + request-validation + real-persistence wiring
 *  `BetaAccessRoutes` composes. Mirrors `AssistantConversationRoutesSpec`'s dual-pool harness. */
class BetaAccessRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var privilegedDb: JdbcBackend.Database   = _ // postgres superuser
  private var appDb: JdbcBackend.Database           = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                        = _
  private var userRepo: UserRepository              = _
  private var inviteCodeRepo: InviteCodeRepository  = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx            = new DbContext(appDb, privilegedDb)
    userRepo       = new UserRepository(appDb)(routeEc)
    inviteCodeRepo = new InviteCodeRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def cleanDb(): Unit =
    await(ctx.withSystemContext(sqlu"TRUNCATE TABLE invite_codes, user_sessions, users RESTART IDENTITY CASCADE"))

  private def newUser(tier: String = "free"): AuthenticatedUser = {
    val id = UserId(UUID.randomUUID().toString)
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES (${id.value}::uuid, ${s"${id.value}@test.local"}, now(), $tier)"""
    ))
    AuthenticatedUser(id)
  }

  private def issueCode(recipient: UserId, code: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO invite_codes (id, code_hash, user_id, created_at, redeemed_at)
             VALUES (${UUID.randomUUID().toString}::uuid, ${TokenHashing.sha256Hex(code)},
                     ${recipient.value}::uuid, now(), NULL)"""
    ))

  /** Never makes a real HTTP call -- `result` is returned verbatim from every `send`. */
  final class StubEmailSender(result: Either[String, Unit] = Right(())) extends EmailSender {
    override def send(to: Seq[String], subject: String, text: String): Future[Either[String, Unit]] =
      Future.successful(result)
  }

  private def routesFor(
      user: AuthenticatedUser,
      emailSender: Option[EmailSender],
      ownerEmails: Set[String] = Set("owner@example.com")
  ): Route = {
    val service = new BetaAccessService(
      inviteCodeRepo,
      userRepo,
      UserTierConfig(ownerEmails, UserTierConfig.DefaultBetaDailyMessageLimit),
      emailSender
    )(routeEc)
    new BetaAccessRoutes(service, user)(typedSystem).routes
  }

  private def jsonEntity(json: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, json)

  "POST /beta-access/request" should {

    "returns 204 for an eligible free user with email configured" in {
      cleanDb()
      val user = newUser("free")
      Post("/beta-access/request") ~> routesFor(user, Some(new StubEmailSender())) ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }

    "returns 409 for a non-free (already-granted) user" in {
      cleanDb()
      val user = newUser("beta")
      Post("/beta-access/request") ~> routesFor(user, Some(new StubEmailSender())) ~> check {
        status shouldBe StatusCodes.Conflict
      }
    }

    "returns 503 when email is unconfigured" in {
      cleanDb()
      val user = newUser("free")
      Post("/beta-access/request") ~> routesFor(user, None) ~> check {
        status shouldBe StatusCodes.ServiceUnavailable
      }
    }

    "returns 502 when the provider rejects the send" in {
      cleanDb()
      val user = newUser("free")
      Post("/beta-access/request") ~> routesFor(user, Some(new StubEmailSender(Left("boom")))) ~> check {
        status shouldBe StatusCodes.BadGateway
      }
    }

    "returns 429 on a repeat request within the cooldown window" in {
      cleanDb()
      val user  = newUser("free")
      val route = routesFor(user, Some(new StubEmailSender()))

      Post("/beta-access/request") ~> route ~> check { status shouldBe StatusCodes.NoContent }
      Post("/beta-access/request") ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }
  }

  "POST /beta-access/redeem" should {

    "returns 200 with the updated user (tier beta) for a valid code" in {
      cleanDb()
      val user = newUser("free")
      issueCode(user.id, "valid-code")

      Post("/beta-access/redeem", jsonEntity("""{"code":"valid-code"}""")) ~> routesFor(user, None) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[UserResponse].tier shouldBe "beta"
      }
    }

    "returns 400 with a clear invalid-or-used message for an unknown code" in {
      cleanDb()
      val user = newUser("free")

      Post("/beta-access/redeem", jsonEntity("""{"code":"does-not-exist"}""")) ~> routesFor(user, None) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("Invalid or already-used invite code")
      }
    }

    "returns 400 for a blank code (request-shape validation, before any repository call)" in {
      cleanDb()
      val user = newUser("free")

      Post("/beta-access/redeem", jsonEntity("""{"code":"   "}""")) ~> routesFor(user, None) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "returns 409 for a non-free (already-granted) caller" in {
      cleanDb()
      val user = newUser("owner")

      Post("/beta-access/redeem", jsonEntity("""{"code":"whatever"}""")) ~> routesFor(user, None) ~> check {
        status shouldBe StatusCodes.Conflict
      }
    }
  }
}
