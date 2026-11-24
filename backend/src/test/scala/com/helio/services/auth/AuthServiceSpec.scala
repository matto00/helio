package com.helio.services.auth

import com.helio.services.auth.{AuthResult, AuthService, LoginOutcome, UserTierConfig}
import com.helio.api.protocols.auth.{AuthProtocol, DashboardTabPref, DashboardTabsPref, GoogleProfile, LoginRequest, RegisterRequest}
import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.{User, UserId, UserTier}
import com.helio.services.ServiceError
import spray.json._
import com.helio.domain.util.SystemClock
import com.helio.infrastructure.persistence.auth.{OAuthStateRepository, PreferencesPatch, UserPreferenceRepository, UserRepository}
import com.helio.infrastructure.persistence.telemetry.ProductEventRepository
import com.helio.services.telemetry.{ProductEventService, ValidatedProductEvent}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import scala.concurrent.duration.DurationInt
import scala.util.Success
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
  private var oauthStateStore: OAuthStateRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    userRepo = new UserRepository(db)
    // HEL-1019: this spec doesn't exercise OAuth, but `AuthService` now requires a real
    // `OAuthStateStore` collaborator — the embedded superuser connection stands in for both
    // pools here, matching every other single-pool test fixture in this codebase.
    oauthStateStore = new OAuthStateRepository(new DbContext(db, db))
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

  private def serviceWith(ownerEmails: Set[String], productEvents: Option[ProductEventService] = None): AuthService =
    new AuthService(
      userRepo,
      UserTierConfig(ownerEmails, UserTierConfig.DefaultBetaDailyMessageLimit),
      stateStore = oauthStateStore,
      productEventService = productEvents
    )

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

  // HEL-1852: Google's userinfo response is STUBBED as JSON and read through the production reader
  // (`googleProfileFormat`), so `email_verified` handling is exercised exactly as `OAuthRoutes`
  // would; no live OAuth. `verified = None` omits the field entirely.
  private val protocol = new AuthProtocol {}
  private def googleProfile(sub: String, email: String, verified: Option[JsValue], name: Option[String] = None): GoogleProfile = {
    val fields = Map("sub" -> JsString(sub), "email" -> JsString(email)) ++
      verified.map("email_verified" -> _) ++ name.map(n => "name" -> JsString(n))
    protocol.googleProfileFormat.read(JsObject(fields))
  }
  private def oauthUser(service: AuthService, profile: GoogleProfile) =
    await(service.completeOAuth(profile)).asInstanceOf[LoginOutcome.SessionEstablished].result.response.user

  /** The "manual DB grant" path (HEL-1852 ticket AC): an explicit tier write, not an allowlist side effect. */
  private def grantTier(email: String, tier: UserTier): Unit =
    await(userRepo.findByEmail(email).flatMap(u => userRepo.updateTier(u.get.id, tier)))

  private def userCount(): Int = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM users".as[Int].head))
  }

  private def storedEmails(): Vector[String] = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sql"SELECT email FROM users ORDER BY created_at".as[String])).toVector
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

    "HEL-1852: assigns tier = free to an allowlisted email (password signup never grants owner)" in {
      cleanDb()
      val result = register(serviceWith(Set("owner@example.test")), "owner@example.test")
      result.response.user.tier shouldBe "free"
      storedTier("owner@example.test") shouldBe "free"
    }

    "HEL-1852: a case-variant of an allowlisted email registers as free, and never as owner" in {
      cleanDb()
      val result = register(serviceWith(Set("Owner@Example.test")), "OWNER@example.TEST")
      result.response.user.tier shouldBe "free"
      storedTier("owner@example.test") shouldBe "free"
    }

    "HEL-1852: a case-variant of an existing email is a 409 Conflict and creates no second row" in {
      cleanDb()
      val service = serviceWith(Set.empty)
      register(service, "user@example.test")
      await(service.register(RegisterRequest("USER@Example.test", "password123", None))) match {
        case Left(ServiceError.Conflict(_)) => succeed
        case other                          => fail(s"expected Conflict, got: $other")
      }
      userCount() shouldBe 1
    }

    "HEL-1852: trims and lowercases the email on register, including tab/newline padding" in {
      cleanDb()
      val result = register(serviceWith(Set.empty), " \t\n New.User@Example.TEST \n\t")
      result.response.user.email shouldBe "new.user@example.test"
      storedEmails() shouldBe Vector("new.user@example.test")
    }

    "HEL-1852: rejects (400) a registration email with internal whitespace after trimming" in {
      cleanDb()
      val service = serviceWith(Set.empty)
      Seq("a b@example.test", "a\tb@example.test", "a@exa\nmple.test", "a\u0007b@example.test").foreach { email =>
        await(service.register(RegisterRequest(email, "password123", None))) match {
          case Left(ServiceError.BadRequest(_)) => succeed
          case other                            => fail(s"expected BadRequest for ${email.toList}, got: $other")
        }
      }
      userCount() shouldBe 0
    }

    "HEL-1852: a register that races past the existence check and hits the unique index is Conflict, not a failed Future" in {
      cleanDb()
      register(serviceWith(Set.empty), "race@example.test")
      // findByEmail always misses, so the insert itself collides on the database constraint.
      val blind = new UserRepository(db) {
        override def findByEmail(email: String): Future[Option[User]] = Future.successful(None)
      }
      val racing = new AuthService(blind, UserTierConfig(Set.empty, UserTierConfig.DefaultBetaDailyMessageLimit), stateStore = oauthStateStore)
      await(racing.register(RegisterRequest("race@example.test", "password123", None))) match {
        case Left(ServiceError.Conflict(_)) => succeed
        case other                          => fail(s"expected Conflict, got: $other")
      }
      userCount() shouldBe 1
    }

    "records exactly one signup_completed event for the new user" in {
      cleanDb()
      val events = new ProductEventService(new ProductEventRepository(new DbContext(db, db)), SystemClock)
      val result = register(serviceWith(Set.empty, Some(events)), "tracked@example.com")
      import slick.jdbc.PostgresProfile.api._
      val id = result.response.user.id
      await(db.run(sql"SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed' AND user_id = $id::uuid".as[Int].head)) shouldBe 1
    }

    "records signup_completed for a Google-created user, but not for a returning Google login" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._
      val events  = new ProductEventService(new ProductEventRepository(new DbContext(db, db)), SystemClock)
      val service = serviceWith(Set.empty, Some(events))
      val profile = GoogleProfile("google-sub-1", Some("g@example.com"), Some("G"), None)
      def signups() = await(db.run(sql"SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed'".as[Int].head))
      await(service.completeOAuth(profile))
      signups() shouldBe 1
      await(service.completeOAuth(profile))
      signups() shouldBe 1
    }

    "still completes a Google signup when recording the event fails" in {
      cleanDb()
      val failing = new ProductEventRepository(new DbContext(db, db)) {
        override def insertBatch(userId: UserId, events: Seq[ValidatedProductEvent]): Future[Int] =
          Future.failed(new RuntimeException("telemetry store down"))
      }
      val service = serviceWith(Set.empty, Some(new ProductEventService(failing, SystemClock)))
      await(service.completeOAuth(GoogleProfile("google-sub-2", Some("g2@example.com"), None, None))) should not be null
    }

    "still succeeds when recording the signup event fails" in {
      cleanDb()
      val failing = new ProductEventRepository(new DbContext(db, db)) {
        override def insertBatch(userId: UserId, events: Seq[ValidatedProductEvent]): Future[Int] =
          Future.failed(new RuntimeException("telemetry store down"))
      }
      val result = register(serviceWith(Set.empty, Some(new ProductEventService(failing, SystemClock))), "resilient@example.com")
      result.response.user.email shouldBe "resilient@example.com"
      storedTier("resilient@example.com") shouldBe "free"
    }

    "an unset (empty) allowlist never assigns owner" in {
      cleanDb()
      val result = register(serviceWith(Set.empty), "anyone@example.com")
      result.response.user.tier shouldBe "free"
    }
  }

  "AuthService.login" should {

    "HEL-1852: never promotes -- an allowlisted free account stays free after a password login" in {
      cleanDb()
      register(serviceWith(Set.empty), "promote-me@example.test")
      storedTier("promote-me@example.test") shouldBe "free"

      val result = login(serviceWith(Set("promote-me@example.test")), "promote-me@example.test")

      result.response.user.tier shouldBe "free"
      storedTier("promote-me@example.test") shouldBe "free"
    }

    "HEL-1852: a case-variant allowlist entry does not promote at password login either" in {
      cleanDb()
      register(serviceWith(Set.empty), "case-test@example.test")

      val result = login(serviceWith(Set("Case-Test@Example.TEST")), "case-test@example.test")

      result.response.user.tier shouldBe "free"
      storedTier("case-test@example.test") shouldBe "free"
    }

    "HEL-1852: logs in with a differently-cased, padded email" in {
      cleanDb()
      register(serviceWith(Set.empty), "user@example.test")
      val result = login(serviceWith(Set.empty), "  USER@Example.Test\n")
      result.response.user.email shouldBe "user@example.test"
    }

    "HEL-1852: finds an account whose stored email is mixed-case (written by a raw writer), by the normalised email" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._
      await(db.run(sqlu"INSERT INTO users (id, email, password_hash) VALUES (gen_random_uuid(), 'Raw.Writer@Example.test', 'x')"))
      await(userRepo.findByEmail("raw.writer@example.test")).map(_.email) shouldBe Some("Raw.Writer@Example.test")
      await(userRepo.findByEmail("  RAW.WRITER@example.TEST ")).map(_.email) shouldBe Some("Raw.Writer@Example.test")
    }

    "an unset (empty) allowlist leaves an existing free-tier user unchanged, no error" in {
      cleanDb()
      register(serviceWith(Set.empty), "untouched@example.test")

      val result = login(serviceWith(Set.empty), "untouched@example.test")

      result.response.user.tier shouldBe "free"
      storedTier("untouched@example.test") shouldBe "free"
    }

    "never demotes -- an owner (manually granted) whose email is off the allowlist stays owner on the next login" in {
      cleanDb()
      register(serviceWith(Set.empty), "was-owner@example.test")
      grantTier("was-owner@example.test", UserTier.Owner)

      val result = login(serviceWith(Set.empty), "was-owner@example.test")

      result.response.user.tier shouldBe "owner"
      storedTier("was-owner@example.test") shouldBe "owner"
    }

    "keeps owner for a manually granted owner still on the allowlist (no-op, not an error)" in {
      cleanDb()
      val config = serviceWith(Set("still-owner@example.test"))
      register(config, "still-owner@example.test")
      grantTier("still-owner@example.test", UserTier.Owner)

      val result = login(config, "still-owner@example.test")

      result.response.user.tier shouldBe "owner"
      storedTier("still-owner@example.test") shouldBe "owner"
    }
  }

  "AuthService.completeOAuth (HEL-1852 verified-email owner grant)" should {
    val T = JsBoolean(true)

    "assign owner to a NEW user whose allowlisted email is reported verified" in {
      cleanDb()
      val user = oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-new-owner", "owner@example.test", Some(T)))
      user.tier shouldBe "owner"
      storedTier("owner@example.test") shouldBe "owner"
    }

    "promote a RETURNING user whose allowlisted email is reported verified, and persist it" in {
      cleanDb()
      oauthUser(serviceWith(Set.empty), googleProfile("g-ret", "owner@example.test", Some(T))).tier shouldBe "free"
      val user = oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-ret", "owner@example.test", Some(T)))
      user.tier shouldBe "owner"
      storedTier("owner@example.test") shouldBe "owner"
    }

    "match the allowlist case-insensitively and store the normalised email" in {
      cleanDb()
      val user = oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-case", " Owner@Example.TEST\n", Some(T)))
      user.tier shouldBe "owner"
      user.email shouldBe "owner@example.test"
      storedEmails() shouldBe Vector("owner@example.test")
    }

    "accept the string \"true\" form of email_verified" in {
      cleanDb()
      oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-str", "owner@example.test", Some(JsString("true")))).tier shouldBe "owner"
    }

    "NOT grant owner to a new allowlisted user when email_verified is false" in {
      cleanDb()
      val user = oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-unv", "owner@example.test", Some(JsBoolean(false))))
      user.tier shouldBe "free"
      storedTier("owner@example.test") shouldBe "free"
    }

    "NOT grant owner when email_verified is missing, and does not crash" in {
      cleanDb()
      val user = oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-missing", "owner@example.test", None))
      user.tier shouldBe "free"
    }

    "NOT grant owner for a malformed email_verified (number, null, other string)" in {
      cleanDb()
      val svc = serviceWith(Set("owner@example.test"))
      Seq[JsValue](JsNumber(1), JsNull, JsString("yes"), JsString("TRUE ")).zipWithIndex.foreach { case (v, i) =>
        cleanDb()
        oauthUser(svc, googleProfile(s"g-bad-$i", "owner@example.test", Some(v))).tier shouldBe "free"
      }
    }

    "NOT promote a RETURNING free user when the email is unverified" in {
      cleanDb()
      oauthUser(serviceWith(Set.empty), googleProfile("g-ret-unv", "owner@example.test", Some(T))).tier shouldBe "free"
      val user = oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-ret-unv", "owner@example.test", Some(JsBoolean(false))))
      user.tier shouldBe "free"
      storedTier("owner@example.test") shouldBe "free"
    }

    "never demote an existing owner on an unverified sign-in" in {
      cleanDb()
      oauthUser(serviceWith(Set("owner@example.test")), googleProfile("g-keep", "owner@example.test", Some(T))).tier shouldBe "owner"
      oauthUser(serviceWith(Set.empty), googleProfile("g-keep", "owner@example.test", Some(JsBoolean(false)))).tier shouldBe "owner"
    }

    "never treat the synthetic google:<sub>@helio.invalid address as owner-eligible" in {
      cleanDb()
      val noEmail = protocol.googleProfileFormat.read(JsObject("sub" -> JsString("g-noemail"), "email_verified" -> T))
      oauthUser(serviceWith(Set("google:g-noemail@helio.invalid")), noEmail).tier shouldBe "free"
    }

    "fail (not create a duplicate) when a Google first sign-in collides with an existing password account's email" in {
      cleanDb()
      val svc = serviceWith(Set.empty)
      register(svc, "shared@example.test")
      val outcome = await(svc.completeOAuth(googleProfile("g-collide", "Shared@Example.test", Some(T))).transform(Success(_)))
      outcome.isFailure shouldBe true
      userCount() shouldBe 1
    }
  }

  // HEL-1574: every session-returning response carries the user's saved preferences.
  "AuthService responses with a preference repository" should {

    def withPrefs(): AuthService =
      new AuthService(
        userRepo,
        UserTierConfig(Set.empty, UserTierConfig.DefaultBetaDailyMessageLimit),
        stateStore = oauthStateStore,
        preferenceRepo = Some(new UserPreferenceRepository(db))
      )

    "carry the shell preferences in the register, login and OAuth responses" in {
      cleanDb()
      val service = withPrefs()
      val prefs   = new UserPreferenceRepository(db)

      val registered = register(service, "prefs@example.com")
      registered.response.user.preferences.map(_.contextListWidth) shouldBe Some(None)

      registered.response.user.preferences.map(_.dashboardTabs) shouldBe Some(None)

      val savedTabs = DashboardTabsPref(Vector(DashboardTabPref("d1", Some("2026-10-15T10:00:00Z"), None)), Some("d1"))
      await(prefs.patchPrefs(UserId(registered.response.user.id), PreferencesPatch(Some(320), Some(true), Some("serif"), Some("compact"), Some(Some("off")), Some(savedTabs))))
      val loggedIn = login(service, "prefs@example.com").response.user.preferences.get
      loggedIn.contextListWidth shouldBe Some(320)
      loggedIn.typeStyle shouldBe Some("serif")
      loggedIn.density shouldBe Some("compact")
      loggedIn.motion shouldBe Some("off")
      loggedIn.contextListCollapsed shouldBe Some(true)
      loggedIn.dashboardTabs shouldBe Some(savedTabs)

      val oauthOutcome = await(service.completeOAuth(GoogleProfile("g-prefs", Some("g-prefs@example.com"), None, None)))
      val oauthUser    = oauthOutcome.asInstanceOf[LoginOutcome.SessionEstablished].result.response.user
      await(prefs.patchPrefs(UserId(oauthUser.id), PreferencesPatch(Some(250), None)))
      val oauthAgain = await(service.completeOAuth(GoogleProfile("g-prefs", Some("g-prefs@example.com"), None, None)))
      oauthAgain.asInstanceOf[LoginOutcome.SessionEstablished].result.response.user.preferences.get.contextListWidth shouldBe Some(250)
    }

    "keep the preference-less shape when no repository is wired" in {
      cleanDb()
      register(serviceWith(Set.empty), "nopref@example.com").response.user.preferences shouldBe None
    }
  }
}
