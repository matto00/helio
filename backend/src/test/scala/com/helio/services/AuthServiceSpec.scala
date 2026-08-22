package com.helio.services

import com.helio.services.auth.{AuthResult, AuthService, LoginOutcome, UserTierConfig}
import com.helio.api.protocols.auth.{LoginRequest, RegisterRequest}
import com.helio.infrastructure.persistence.auth.UserRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-703 tasks.md 6.2 (design.md D4) — `AuthService.register`/`login`'s owner-email allowlist
 *  behavior: default-free assignment, allowlist-match assignment/promotion, case-insensitivity,
 *  no-op on an unset/non-matching allowlist, and no demotion. Service-level (not HTTP) so each
 *  test can inject its own `UserTierConfig` directly (design.md D4 — "specs inject their own",
 *  never `fromEnv()`), mirroring `GoogleOAuthRoutesSpec`'s real-Postgres-plus-Flyway harness for
 *  the OAuth path's equivalent behavior. */
class AuthServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

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

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    userRepo = new UserRepository(db)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE user_sessions, users RESTART IDENTITY CASCADE"))
  }

  private def serviceWith(ownerEmails: Set[String]): AuthService =
    new AuthService(userRepo, UserTierConfig(ownerEmails, UserTierConfig.DefaultBetaDailyMessageLimit))

  private def register(service: AuthService, email: String, password: String = "password123"): AuthResult =
    await(service.register(RegisterRequest(email, password, None))) match {
      case Right(result) => result
      case Left(err)     => fail(s"register failed: $err")
    }

  // HEL-702 merge: `AuthService.login` now returns `LoginOutcome` (MFA gate) instead of `AuthResult`
  // directly. None of these tests enable MFA (`serviceWith` never passes an `MfaService`), so the
  // outcome is always `SessionEstablished` — unwrap it, failing loudly if that ever stops holding.
  private def login(service: AuthService, email: String, password: String = "password123"): AuthResult =
    await(service.login(LoginRequest(email, password))) match {
      case Right(LoginOutcome.SessionEstablished(result)) => result
      case Right(other)                                   => fail(s"expected SessionEstablished, got: $other")
      case Left(err)                                       => fail(s"login failed: $err")
    }

  private def storedTier(email: String): String = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sql"SELECT tier FROM users WHERE email = $email".as[String].head))
  }

  "AuthService.register" should {

    "assigns tier = free to a non-allowlisted email" in {
      cleanDb()
      val result = register(serviceWith(Set.empty), "plain@example.com")
      result.response.user.tier shouldBe "free"
      storedTier("plain@example.com") shouldBe "free"
    }

    "assigns tier = owner to an allowlisted email at registration, not free-then-promoted" in {
      cleanDb()
      val result = register(serviceWith(Set("owner@example.com")), "owner@example.com")
      result.response.user.tier shouldBe "owner"
      storedTier("owner@example.com") shouldBe "owner"
    }

    "matches the allowlist case-insensitively" in {
      cleanDb()
      val result = register(serviceWith(Set("Owner@Example.com")), "owner@example.com")
      result.response.user.tier shouldBe "owner"
    }

    "an unset (empty) allowlist never assigns owner" in {
      cleanDb()
      val result = register(serviceWith(Set.empty), "anyone@example.com")
      result.response.user.tier shouldBe "free"
    }
  }

  "AuthService.login" should {

    "promotes a free-tier user to owner when their email is now on the allowlist, persisting it" in {
      cleanDb()
      register(serviceWith(Set.empty), "promote-me@example.com")
      storedTier("promote-me@example.com") shouldBe "free"

      val result = login(serviceWith(Set("promote-me@example.com")), "promote-me@example.com")

      result.response.user.tier shouldBe "owner"
      storedTier("promote-me@example.com") shouldBe "owner"
    }

    "case-insensitive allowlist match promotes at login" in {
      cleanDb()
      register(serviceWith(Set.empty), "case-test@example.com")

      val result = login(serviceWith(Set("Case-Test@Example.COM")), "case-test@example.com")

      result.response.user.tier shouldBe "owner"
      storedTier("case-test@example.com") shouldBe "owner"
    }

    "an unset (empty) allowlist leaves an existing free-tier user unchanged, no error" in {
      cleanDb()
      register(serviceWith(Set.empty), "untouched@example.com")

      val result = login(serviceWith(Set.empty), "untouched@example.com")

      result.response.user.tier shouldBe "free"
      storedTier("untouched@example.com") shouldBe "free"
    }

    "never demotes -- an owner whose email leaves the allowlist stays owner on the next login" in {
      cleanDb()
      register(serviceWith(Set("was-owner@example.com")), "was-owner@example.com")
      storedTier("was-owner@example.com") shouldBe "owner"

      // The allowlist no longer contains this email.
      val result = login(serviceWith(Set.empty), "was-owner@example.com")

      result.response.user.tier shouldBe "owner"
      storedTier("was-owner@example.com") shouldBe "owner"
    }

    "does not re-promote (no-op, not an error) a login for an already-owner user still on the allowlist" in {
      cleanDb()
      val config = serviceWith(Set("still-owner@example.com"))
      register(config, "still-owner@example.com")

      val result = login(config, "still-owner@example.com")

      result.response.user.tier shouldBe "owner"
      storedTier("still-owner@example.com") shouldBe "owner"
    }
  }
}
