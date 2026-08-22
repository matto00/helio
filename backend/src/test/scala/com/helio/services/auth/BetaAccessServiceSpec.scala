package com.helio.services.auth

import com.helio.services.auth.{BetaAccessError, BetaAccessService, UserTierConfig}
import com.helio.domain.model.{AuthenticatedUser, UserId, UserTier}
import com.helio.email.EmailSender
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{InviteCodeRepository, UserRepository}
import com.helio.infrastructure.crypto.TokenHashing
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-704 tasks.md 7.2 -- `BetaAccessService`'s request-access and redeem flows (design.md
 *  D4/D5) against a stub [[StubEmailSender]] -- NEVER a live Resend call (systematic-debugging /
 *  design.md instruction). Real Postgres (embedded + Flyway) backs `UserRepository`/
 *  `InviteCodeRepository`, mirroring `AuthServiceSpec`'s harness, since `BetaAccessService`
 *  depends on the concrete repository classes directly (no repository interface to mock). Both
 *  `DbContext` pools point at the same superuser connection here -- RLS enforcement itself is
 *  `InviteCodeRepositorySpec`'s job; this spec exercises the service's own orchestration (tier
 *  checks, cooldown, email-outcome mapping). */
class BetaAccessServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var userRepo: UserRepository              = _
  private var inviteCodeRepo: InviteCodeRepository  = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    userRepo       = new UserRepository(db)
    inviteCodeRepo = new InviteCodeRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit =
    await(db.run(sqlu"TRUNCATE TABLE invite_codes, user_sessions, users RESTART IDENTITY CASCADE"))

  private def newUser(tier: String = "free"): AuthenticatedUser = {
    val id = UserId(UUID.randomUUID().toString)
    await(db.run(
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES (${id.value}::uuid, ${s"${id.value}@test.local"}, now(), $tier)"""
    ))
    AuthenticatedUser(id)
  }

  /** `alreadyRedeemed = true` seeds a code whose `redeemed_at` is already set -- simulates a
   *  prior successful redemption directly at the SQL layer (not via the service), so a test can
   *  exercise the "already-used" repository outcome for a caller whose tier is STILL `free`
   *  (isolating it from the separate `NotEligible` tier-precheck branch). `#$` is a literal
   *  (non-bind-parameter) substitution -- test-only, never user input. */
  private def issueCode(recipient: UserId, code: String, alreadyRedeemed: Boolean = false): Unit = {
    val redeemedAtClause = if (alreadyRedeemed) "now()" else "NULL"
    await(db.run(
      sqlu"""INSERT INTO invite_codes (id, code_hash, user_id, created_at, redeemed_at)
             VALUES (${UUID.randomUUID().toString}::uuid, ${TokenHashing.sha256Hex(code)},
                     ${recipient.value}::uuid, now(), #$redeemedAtClause)"""
    ))
  }

  /** Records every `send` call; `outcome` is invoked fresh per call to decide what `Future` it
   *  resolves to. Default always succeeds; `failingSender()` below always rejects. Never makes a
   *  real HTTP call. */
  final class StubEmailSender(outcome: () => Either[String, Unit]) extends EmailSender {
    var calls: Vector[(Seq[String], String, String)] = Vector.empty
    override def send(to: Seq[String], subject: String, text: String): Future[Either[String, Unit]] = {
      calls = calls :+ ((to, subject, text))
      Future.successful(outcome())
    }
  }

  private def okSender(): StubEmailSender      = new StubEmailSender(() => Right(()))
  private def failingSender(): StubEmailSender = new StubEmailSender(() => Left("provider rejected"))

  private def serviceWith(
      emailSender: Option[EmailSender],
      ownerEmails: Set[String] = Set("owner@example.com")
  ): BetaAccessService =
    new BetaAccessService(
      inviteCodeRepo,
      userRepo,
      UserTierConfig(ownerEmails, UserTierConfig.DefaultBetaDailyMessageLimit),
      emailSender
    )

  "BetaAccessService.requestAccess" should {

    "sends one email to every configured owner recipient, identifying the requester" in {
      cleanDb()
      val user    = newUser(tier = "free")
      val sender  = okSender()
      val service = serviceWith(Some(sender), ownerEmails = Set("owner1@example.com", "owner2@example.com"))

      await(service.requestAccess(user)) shouldBe Right(())

      sender.calls should have size 1
      val (to, _, body) = sender.calls.head
      to.toSet shouldBe Set("owner1@example.com", "owner2@example.com")
      body should include(user.id.value)
    }

    "rejects a non-free caller with NotEligible, sending no email" in {
      cleanDb()
      val user   = newUser(tier = "beta")
      val sender = okSender()

      await(serviceWith(Some(sender)).requestAccess(user)) match {
        case Left(_: BetaAccessError.NotEligible) => succeed
        case other                                 => fail(s"expected NotEligible, got $other")
      }
      sender.calls shouldBe empty
    }

    "returns EmailUnconfigured (no send attempted) when no EmailSender is configured" in {
      cleanDb()
      val user = newUser(tier = "free")

      await(serviceWith(None).requestAccess(user)) match {
        case Left(_: BetaAccessError.EmailUnconfigured) => succeed
        case other                                       => fail(s"expected EmailUnconfigured, got $other")
      }
    }

    "returns EmailUnconfigured when HELIO_OWNER_EMAILS resolves to no recipients" in {
      cleanDb()
      val user   = newUser(tier = "free")
      val sender = okSender()

      await(serviceWith(Some(sender), ownerEmails = Set.empty).requestAccess(user)) match {
        case Left(_: BetaAccessError.EmailUnconfigured) => succeed
        case other                                       => fail(s"expected EmailUnconfigured, got $other")
      }
      sender.calls shouldBe empty
    }

    "returns SendFailed, without recording a cooldown, when the provider rejects the send" in {
      cleanDb()
      val user    = newUser(tier = "free")
      val sender  = failingSender()
      val service = serviceWith(Some(sender))

      await(service.requestAccess(user)) match {
        case Left(_: BetaAccessError.SendFailed) => succeed
        case other                                => fail(s"expected SendFailed, got $other")
      }
      sender.calls should have size 1

      // A failed send must not consume the cooldown -- an immediate retry attempts a real send.
      await(service.requestAccess(user))
      sender.calls should have size 2
    }

    "a second request within the cooldown window returns Cooldown without sending another email" in {
      cleanDb()
      val user    = newUser(tier = "free")
      val sender  = okSender()
      val service = serviceWith(Some(sender))

      await(service.requestAccess(user)) shouldBe Right(())
      await(service.requestAccess(user)) match {
        case Left(_: BetaAccessError.Cooldown) => succeed
        case other                              => fail(s"expected Cooldown, got $other")
      }
      sender.calls should have size 1
    }
  }

  "BetaAccessService.redeem" should {

    "upgrades a free user's tier and returns the updated user" in {
      cleanDb()
      val user = newUser(tier = "free")
      issueCode(user.id, "plaintext-code-1")

      await(serviceWith(None).redeem(user, "plaintext-code-1")) match {
        case Right(updated) => updated.tier shouldBe UserTier.Beta
        case other           => fail(s"expected Right, got $other")
      }
    }

    "rejects an already-granted (non-free) caller with NotEligible, before touching any code" in {
      cleanDb()
      val user = newUser(tier = "owner")

      await(serviceWith(None).redeem(user, "irrelevant-code")) match {
        case Left(_: BetaAccessError.NotEligible) => succeed
        case other                                 => fail(s"expected NotEligible, got $other")
      }
    }

    "rejects an unknown code with InvalidCode" in {
      cleanDb()
      val user = newUser(tier = "free")

      await(serviceWith(None).redeem(user, "never-issued")) match {
        case Left(_: BetaAccessError.InvalidCode) => succeed
        case other                                 => fail(s"expected InvalidCode, got $other")
      }
    }

    "rejects a code issued for a different user with InvalidCode" in {
      cleanDb()
      val recipient = newUser(tier = "free")
      val impostor   = newUser(tier = "free")
      issueCode(recipient.id, "foreign-code")

      await(serviceWith(None).redeem(impostor, "foreign-code")) match {
        case Left(_: BetaAccessError.InvalidCode) => succeed
        case other                                 => fail(s"expected InvalidCode, got $other")
      }
    }

    "rejects an already-used code with InvalidCode, for a caller whose tier is still free" in {
      cleanDb()
      val user = newUser(tier = "free")
      issueCode(user.id, "already-used-code", alreadyRedeemed = true)

      await(serviceWith(None).redeem(user, "already-used-code")) match {
        case Left(_: BetaAccessError.InvalidCode) => succeed
        case other                                 => fail(s"expected InvalidCode, got $other")
      }
    }
  }
}
