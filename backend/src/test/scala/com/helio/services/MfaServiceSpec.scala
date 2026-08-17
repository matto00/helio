package com.helio.services

import com.helio.api.protocols.{MfaConfirmRequest, MfaReauthRequest, MfaVerifyRequest}
import com.helio.domain.{AuthenticatedUser, User, UserId}
import com.helio.infrastructure.{MfaRepository, TokenHashing, UserRepository}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-702 — enrollment lifecycle, backup-code single-use + regeneration,
 *  login-challenge TTL/attempt-cap/generic-error behavior, and disable
 *  re-auth. Real embedded Postgres (matches `AlertEventServiceSpec`'s
 *  precedent) since `MfaService` composes `MfaRepository` + `UserRepository`
 *  end to end. */
class MfaServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var userRepo: UserRepository           = _
  private var mfaRepo: MfaRepository             = _
  private var service: MfaService                = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db       = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    userRepo = new UserRepository(db)
    mfaRepo  = new MfaRepository(db)
    service  = new MfaService(mfaRepo, userRepo)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM mfa_login_challenges"))
    await(db.run(sqlu"DELETE FROM mfa_backup_codes"))
    await(db.run(sqlu"DELETE FROM user_mfa"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private def seedUser(): AuthenticatedUser = {
    val id   = UUID.randomUUID().toString
    val user = User(id = UserId(id), email = s"$id@helio.test", displayName = None, createdAt = Instant.now())
    await(userRepo.insert(user, Some("dummy-hash")))
    AuthenticatedUser(user.id)
  }

  /** Computes the current valid TOTP code for `secret` directly via
   *  `java-otp` — independent of `MfaService`'s own verification path, so
   *  enrollment/verify tests are genuine round-trips. Local, single-use
   *  imports per CONTRIBUTING's documented exception. */
  private def totpCodeFor(secret: String): String = {
    import com.eatthepath.otp.TimeBasedOneTimePasswordGenerator
    import org.apache.commons.codec.binary.Base32
    import javax.crypto.spec.SecretKeySpec

    val totp = new TimeBasedOneTimePasswordGenerator()
    val key  = new SecretKeySpec(new Base32().decode(secret), totp.getAlgorithm)
    totp.generateOneTimePasswordString(key, Instant.now())
  }

  /** Enrolls + confirms MFA for `user`, returning the confirmed secret and
   *  the plaintext backup codes issued at confirmation.
   *
   *  Root cause note (systematic-debugging): confirming enrollment consumes
   *  the CURRENT TOTP step as `last_used_step` (the replay guard applies to
   *  enrollment confirmation too — `mfa-login-gate` spec). A test that then
   *  immediately calls `totpCodeFor(secret)` again, within the same
   *  wall-clock 30s window, recomputes a code for that SAME already-used
   *  step and gets correctly replay-rejected — confirmed via a probe
   *  (`lastUsedStep after enableMfa == currentStep`, both `59564646`, before
   *  this fix). Rather than sleeping up to 30 real seconds per test, reset
   *  the watermark back to `-1` here, simulating "enough time has passed
   *  since enrollment" for every test that needs an independent TOTP
   *  verification afterward — the replay guard itself is covered directly
   *  and deterministically by `TotpSupportSpec`. */
  private def enableMfa(user: AuthenticatedUser): (String, Vector[String]) = {
    val enrollResp  = await(service.startEnrollment(user)).toOption.get
    val confirmResp = await(service.confirmEnrollment(MfaConfirmRequest(totpCodeFor(enrollResp.secret)), user)).toOption.get
    resetLastUsedStep(user.id)
    (enrollResp.secret, confirmResp.backupCodes)
  }

  private def resetLastUsedStep(userId: UserId): Unit = {
    import PostgresProfile.api._
    val uuid = userId.value
    await(db.run(sqlu"UPDATE user_mfa SET last_used_step = -1 WHERE user_id = $uuid::uuid"))
  }

  private def expireChallenge(token: String): Unit = {
    import PostgresProfile.api._
    val hash = TokenHashing.sha256Hex(token)
    await(db.run(sqlu"UPDATE mfa_login_challenges SET expires_at = now() - interval '1 minute' WHERE token_hash = $hash"))
  }

  "startEnrollment" should {
    "generate a Base32 secret and matching otpauth URI without enabling MFA" in {
      cleanDb()
      val user = seedUser()
      val resp = await(service.startEnrollment(user)).toOption.get
      resp.secret should have length 32
      resp.otpauthUri should include(s"secret=${resp.secret}")
      await(mfaRepo.findUserMfa(user.id)).get.enabled shouldBe false
    }

    "replace an unconfirmed secret when called again" in {
      cleanDb()
      val user  = seedUser()
      val first  = await(service.startEnrollment(user)).toOption.get
      val second = await(service.startEnrollment(user)).toOption.get
      second.secret should not equal first.secret
      await(mfaRepo.findUserMfa(user.id)).get.totpSecret shouldBe second.secret
    }

    "return 409 Conflict when MFA is already enabled" in {
      cleanDb()
      val user = seedUser()
      enableMfa(user)
      val result = await(service.startEnrollment(user))
      result.isLeft shouldBe true
      result.swap.toOption.get shouldBe a[ServiceError.Conflict]
    }
  }

  "confirmEnrollment" should {
    "enable MFA and return 10 unique backup codes on a valid code" in {
      cleanDb()
      val user   = seedUser()
      val enroll = await(service.startEnrollment(user)).toOption.get
      val result = await(service.confirmEnrollment(MfaConfirmRequest(totpCodeFor(enroll.secret)), user))
      val codes  = result.toOption.get.backupCodes
      codes should have size 10
      codes.toSet should have size 10
      val mfa = await(mfaRepo.findUserMfa(user.id)).get
      mfa.enabled shouldBe true
      mfa.verifiedAt shouldBe defined
    }

    "reject an invalid code without enabling MFA" in {
      cleanDb()
      val user = seedUser()
      await(service.startEnrollment(user))
      val result = await(service.confirmEnrollment(MfaConfirmRequest("000000"), user))
      result.isLeft shouldBe true
      await(mfaRepo.findUserMfa(user.id)).get.enabled shouldBe false
    }
  }

  "login challenge + verifyLogin" should {
    "return no challenge for an account without MFA enabled" in {
      cleanDb()
      val user = seedUser()
      val profile = await(userRepo.findById(user.id)).get
      await(service.createLoginChallenge(profile)) shouldBe None
    }

    "verify with a valid TOTP code, deleting the challenge on success" in {
      cleanDb()
      val user           = seedUser()
      val (secret, _)    = enableMfa(user)
      val profile        = await(userRepo.findById(user.id)).get
      val challengeToken = await(service.createLoginChallenge(profile)).get

      val result = await(service.verifyLogin(MfaVerifyRequest(challengeToken, totpCodeFor(secret))))
      result.isRight shouldBe true
      await(mfaRepo.findChallengeByToken(challengeToken)) shouldBe None
    }

    "verify with an unused backup code, marking it used" in {
      cleanDb()
      val user           = seedUser()
      val (_, codes)     = enableMfa(user)
      val profile        = await(userRepo.findById(user.id)).get
      val challengeToken = await(service.createLoginChallenge(profile)).get

      val result = await(service.verifyLogin(MfaVerifyRequest(challengeToken, codes.head)))
      result.isRight shouldBe true
      await(mfaRepo.countUnusedBackupCodes(user.id)) shouldBe 9
    }

    "reject a previously-used backup code (single-use)" in {
      cleanDb()
      val user       = seedUser()
      val (_, codes) = enableMfa(user)
      val profile    = await(userRepo.findById(user.id)).get
      val usedCode   = codes.head

      val firstToken = await(service.createLoginChallenge(profile)).get
      await(service.verifyLogin(MfaVerifyRequest(firstToken, usedCode))).isRight shouldBe true

      val secondToken = await(service.createLoginChallenge(profile)).get
      val secondResult = await(service.verifyLogin(MfaVerifyRequest(secondToken, usedCode)))
      secondResult.isLeft shouldBe true
    }

    "increment attempts on a wrong code and generically reject an unknown challenge token" in {
      cleanDb()
      val user           = seedUser()
      enableMfa(user)
      val profile        = await(userRepo.findById(user.id)).get
      val challengeToken = await(service.createLoginChallenge(profile)).get

      await(service.verifyLogin(MfaVerifyRequest(challengeToken, "000000"))).isLeft shouldBe true
      await(mfaRepo.findChallengeByToken(challengeToken)).get.attempts shouldBe 1

      await(service.verifyLogin(MfaVerifyRequest("not-a-real-token", "000000"))).isLeft shouldBe true
    }

    "reject even a correct code once the attempt cap is reached" in {
      cleanDb()
      val user           = seedUser()
      val (secret, _)    = enableMfa(user)
      val profile        = await(userRepo.findById(user.id)).get
      val challengeToken = await(service.createLoginChallenge(profile)).get

      (1 to MfaService.MaxAttempts).foreach { _ =>
        await(service.verifyLogin(MfaVerifyRequest(challengeToken, "000000")))
      }

      val result = await(service.verifyLogin(MfaVerifyRequest(challengeToken, totpCodeFor(secret))))
      result.isLeft shouldBe true
    }

    "reject an expired challenge even with the correct code" in {
      cleanDb()
      val user           = seedUser()
      val (secret, _)    = enableMfa(user)
      val profile        = await(userRepo.findById(user.id)).get
      val challengeToken = await(service.createLoginChallenge(profile)).get
      expireChallenge(challengeToken)

      val result = await(service.verifyLogin(MfaVerifyRequest(challengeToken, totpCodeFor(secret))))
      result.isLeft shouldBe true
    }
  }

  "regenerateBackupCodes" should {
    "replace the set with a fresh one on a valid current code, invalidating old codes" in {
      cleanDb()
      val user            = seedUser()
      val (secret, oldCodes) = enableMfa(user)

      val newCodes = await(service.regenerateBackupCodes(MfaReauthRequest(totpCodeFor(secret)), user)).toOption.get.backupCodes
      newCodes should have size 10
      newCodes.toSet.intersect(oldCodes.toSet) shouldBe empty
      await(mfaRepo.countUnusedBackupCodes(user.id)) shouldBe 10

      // An old (now-deleted) code no longer works as re-auth.
      val disableResult = await(service.disable(MfaReauthRequest(oldCodes.head), user))
      disableResult.isLeft shouldBe true
    }

    "reject an invalid code and leave existing codes untouched" in {
      cleanDb()
      val user = seedUser()
      enableMfa(user)

      val result = await(service.regenerateBackupCodes(MfaReauthRequest("000000"), user))
      result.isLeft shouldBe true
      await(mfaRepo.countUnusedBackupCodes(user.id)) shouldBe 10
    }
  }

  "disable" should {
    "delete the enrollment and all backup codes on a valid current code" in {
      cleanDb()
      val user        = seedUser()
      val (secret, _) = enableMfa(user)

      val result = await(service.disable(MfaReauthRequest(totpCodeFor(secret)), user))
      result.isRight shouldBe true
      await(mfaRepo.findUserMfa(user.id)) shouldBe None
      await(mfaRepo.countUnusedBackupCodes(user.id)) shouldBe 0
    }

    "reject an invalid code and leave MFA enabled" in {
      cleanDb()
      val user = seedUser()
      enableMfa(user)

      val result = await(service.disable(MfaReauthRequest("000000"), user))
      result.isLeft shouldBe true
      await(mfaRepo.findUserMfa(user.id)).get.enabled shouldBe true
    }

    "reject when MFA is not enabled at all" in {
      cleanDb()
      val user = seedUser()
      val result = await(service.disable(MfaReauthRequest("000000"), user))
      result.isLeft shouldBe true
    }
  }

  "status" should {
    "report the un-enrolled default for a user with no MFA row" in {
      cleanDb()
      val user = seedUser()
      val resp = await(service.status(user)).toOption.get
      resp.enabled shouldBe false
      resp.verifiedAt shouldBe None
      resp.backupCodesRemaining shouldBe 0
    }

    "report enabled=true with the correct remaining backup-code count" in {
      cleanDb()
      val user = seedUser()
      enableMfa(user)
      val resp = await(service.status(user)).toOption.get
      resp.enabled shouldBe true
      resp.verifiedAt shouldBe defined
      resp.backupCodesRemaining shouldBe 10
    }
  }
}
