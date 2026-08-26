package com.helio.services.auth

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.protocols.auth.{MfaBackupCodesResponse, MfaConfirmRequest, MfaEnrollResponse, MfaReauthRequest, MfaStatusResponse, MfaVerifyRequest}
import com.helio.domain.model.{ApiTokenId, AuditSource, AuthenticatedUser, MfaLoginChallenge, User, UserId, UserMfa}
import com.helio.infrastructure.persistence.auth.{MfaRepository, TotpSupport, UserRepository}
import com.helio.infrastructure.crypto.TokenHashing
import spray.json.{JsObject, JsString}

import java.security.SecureRandom
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** TOTP MFA lifecycle (HEL-702): status, enrollment (start/confirm), backup
 *  codes, disable, and the login-time challenge (`createLoginChallenge` /
 *  `verifyLogin`) that [[AuthService.finishLogin]] and the public
 *  `POST /api/auth/mfa/verify` route delegate to. Never depends on
 *  `AuthService` — see [[AuthResult.of]] — so the two services can wire in
 *  either direction without a cycle. */
final class MfaService(
    mfaRepo: MfaRepository,
    userRepo: UserRepository,
    // HEL-477: nullable-optional wiring mirrors the rest of this ticket's DI.
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  import MfaService._

  private def audit(
      actorUserId: Option[UserId],
      action: String,
      metadata: JsObject = JsObject.empty,
      source: AuditSource = AuditSource.Ui,
      tokenId: Option[ApiTokenId] = None
  ): Unit =
    if (auditService != null)
      auditService.record(actorUserId, tokenId, source, action, "user", actorUserId.map(_.value), metadata)

  // ── Status ────────────────────────────────────────────────────────────────

  def status(user: AuthenticatedUser): Future[Either[ServiceError, MfaStatusResponse]] =
    mfaRepo.findUserMfa(user.id).flatMap {
      case None =>
        Future.successful(Right(MfaStatusResponse(enabled = false, verifiedAt = None, backupCodesRemaining = 0)))
      case Some(mfa) =>
        mfaRepo.countUnusedBackupCodes(user.id).map { remaining =>
          Right(
            MfaStatusResponse(
              enabled              = mfa.enabled,
              verifiedAt           = mfa.verifiedAt.map(_.toString),
              backupCodesRemaining = remaining
            )
          )
        }
    }

  // ── Enrollment ───────────────────────────────────────────────────────────

  /** 409 if already enabled; otherwise generates a fresh secret and upserts
   *  a disabled row (re-issuing replaces any prior unconfirmed secret —
   *  `totp-mfa-enrollment` spec). */
  def startEnrollment(user: AuthenticatedUser): Future[Either[ServiceError, MfaEnrollResponse]] =
    mfaRepo.findUserMfa(user.id).flatMap {
      case Some(existing) if existing.enabled =>
        Future.successful(Left(ServiceError.Conflict("MFA is already enabled")))
      case existing =>
        userRepo.findById(user.id).flatMap {
          case None => Future.successful(Left(InvalidCode))
          case Some(profile) =>
            val secret = TotpSupport.generateSecret()
            val mfa = UserMfa(
              userId       = user.id,
              totpSecret   = secret,
              enabled      = false,
              lastUsedStep = 0L,
              createdAt    = existing.map(_.createdAt).getOrElse(Instant.now()),
              verifiedAt   = None
            )
            mfaRepo.upsertUserMfa(mfa).map { _ =>
              Right(MfaEnrollResponse(secret = secret, otpauthUri = TotpSupport.otpauthUri(secret, profile.email)))
            }
        }
    }

  /** Verifies `code` against the pending (unconfirmed) secret; on success
   *  enables MFA and issues a fresh set of backup codes, returned in
   *  plaintext exactly once. */
  def confirmEnrollment(req: MfaConfirmRequest, user: AuthenticatedUser): Future[Either[ServiceError, MfaBackupCodesResponse]] =
    mfaRepo.findUserMfa(user.id).flatMap {
      case Some(mfa) if !mfa.enabled =>
        TotpSupport.verify(mfa.totpSecret, req.code, mfa.lastUsedStep) match {
          case Some(step) =>
            issueBackupCodes(user.id, confirmStep = Some(step)).map { result =>
              if (result.isRight) audit(Some(user.id), "auth.mfa.enable", source = user.source, tokenId = user.tokenId)
              result
            }
          case None        => Future.successful(Left(InvalidCode))
        }
      case _ => Future.successful(Left(InvalidCode))
    }

  def regenerateBackupCodes(req: MfaReauthRequest, user: AuthenticatedUser): Future[Either[ServiceError, MfaBackupCodesResponse]] =
    requireCurrentAuth(req.code, user)(issueBackupCodes(user.id, confirmStep = None)).map { result =>
      if (result.isRight) audit(Some(user.id), "auth.mfa.backup_codes.regenerate", source = user.source, tokenId = user.tokenId)
      result
    }

  def disable(req: MfaReauthRequest, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    requireCurrentAuth(req.code, user)(mfaRepo.deleteUserMfa(user.id).map(Right(_))).map { result =>
      if (result.isRight) audit(Some(user.id), "auth.mfa.disable", source = user.source, tokenId = user.tokenId)
      result
    }

  // ── Login-time challenge (mfa-login-gate spec) ──────────────────────────

  /** `Some(challengeToken)` iff the user has MFA enabled — `None` tells
   *  [[AuthService.finishLogin]] there is no gate to apply, so it mints a
   *  session immediately, exactly as if the feature were absent. */
  def createLoginChallenge(user: User): Future[Option[String]] =
    mfaRepo.findUserMfa(user.id).flatMap {
      case Some(mfa) if mfa.enabled =>
        val token = generateToken()
        val challenge = MfaLoginChallenge(
          userId    = user.id,
          token     = token,
          attempts  = 0,
          createdAt = Instant.now(),
          expiresAt = Instant.now().plusSeconds(ChallengeTtlSeconds)
        )
        mfaRepo.createChallenge(challenge).map(_ => Some(token))
      case _ => Future.successful(None)
    }

  /** Exchanges a live challenge + valid TOTP-or-backup code for a session.
   *  Every failure mode — unknown/expired/attempt-capped challenge, wrong
   *  code — yields the same generic `Unauthorized` (no oracle distinguishing
   *  them, per the `mfa-login-gate` spec). */
  def verifyLogin(req: MfaVerifyRequest): Future[Either[ServiceError, AuthResult]] =
    mfaRepo.findChallengeByToken(req.challengeToken).flatMap {
      case Some(challenge) if challenge.attempts < MaxAttempts && challenge.expiresAt.isAfter(Instant.now()) =>
        mfaRepo.findUserMfa(challenge.userId).flatMap {
          case Some(mfa) if mfa.enabled =>
            verifyCurrentCode(mfa, req.code, challenge.userId).flatMap {
              case true  => establishSession(req.challengeToken, challenge.userId)
              case false => recordFailedAttempt(req.challengeToken, challenge.userId)
            }
          case _ => recordFailedAttempt(req.challengeToken, challenge.userId)
        }
      case _ => Future.successful(Left(InvalidCode))
    }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private def establishSession(challengeToken: String, userId: UserId): Future[Either[ServiceError, AuthResult]] =
    for {
      _       <- mfaRepo.deleteChallenge(challengeToken)
      userOpt <- userRepo.findById(userId)
      result  <- userOpt match {
        case Some(u) =>
          userRepo
            .createSession(AuthService.buildSession(u.id, Instant.now()))
            .map { created =>
              // HEL-477 design.md Decision 6: this, not AuthService.login's
              // earlier auth.login.challenged, is the actual
              // session-establishing event for an MFA-enrolled user.
              audit(Some(u.id), "auth.login")
              Right(AuthResult.of(created, u))
            }
        case None => Future.successful(Left(InvalidCode))
      }
    } yield result

  private def recordFailedAttempt(challengeToken: String, userId: UserId): Future[Either[ServiceError, AuthResult]] =
    mfaRepo.incrementChallengeAttempts(challengeToken).map { _ =>
      // HEL-477 design.md Decision 6: `MfaService.verifyLogin` failing ->
      // auth.login.failed. `actorUserId = None` (mirrors AuthService's
      // password-login failure convention — no session was ever
      // established), the challenge's known userId is captured in metadata
      // instead.
      audit(None, "auth.login.failed", JsObject("userId" -> JsString(userId.value)))
      Left(InvalidCode)
    }

  /** Re-auth gate shared by regenerate/disable (design.md D6): the caller
   *  must currently have MFA enabled and present a valid current TOTP or
   *  unused backup code — the one uniform mechanism that also works for
   *  OAuth-only accounts, which have no password to re-enter. */
  private def requireCurrentAuth[A](code: String, user: AuthenticatedUser)(
      onSuccess: => Future[Either[ServiceError, A]]
  ): Future[Either[ServiceError, A]] =
    mfaRepo.findUserMfa(user.id).flatMap {
      case Some(mfa) if mfa.enabled =>
        verifyCurrentCode(mfa, code, user.id).flatMap {
          case true  => onSuccess
          case false => Future.successful(Left(InvalidCode))
        }
      case _ => Future.successful(Left(InvalidCode))
    }

  /** Code-shape dispatch (design.md D5): a 6-digit code is checked as TOTP
   *  (advancing `last_used_step` on success — the replay guard); anything
   *  else is checked as a backup code (consumed atomically on success). */
  private def verifyCurrentCode(mfa: UserMfa, code: String, userId: UserId): Future[Boolean] =
    if (TotpSupport.looksLikeTotpCode(code))
      TotpSupport.verify(mfa.totpSecret, code, mfa.lastUsedStep) match {
        case Some(step) => mfaRepo.updateLastUsedStep(userId, step).map(_ => true)
        case None        => Future.successful(false)
      }
    else
      mfaRepo.consumeBackupCode(userId, TokenHashing.sha256Hex(code))

  /** Generates a fresh set of backup codes, replacing any existing ones.
   *  `confirmStep` is `Some(step)` only on the enrollment-confirm path,
   *  where it also flips `enabled`/`verifiedAt` and records the confirming
   *  code's step (replay guard) in the same logical operation. */
  private def issueBackupCodes(userId: UserId, confirmStep: Option[Long]): Future[Either[ServiceError, MfaBackupCodesResponse]] = {
    val codes  = Vector.fill(BackupCodeCount)(TotpSupport.generateBackupCode())
    val hashes = codes.map(TokenHashing.sha256Hex)
    val confirmed = confirmStep match {
      case Some(step) => mfaRepo.confirmEnrollment(userId, step, Instant.now())
      case None       => Future.successful(())
    }
    for {
      _ <- confirmed
      _ <- mfaRepo.deleteAllBackupCodes(userId)
      _ <- mfaRepo.insertBackupCodes(userId, hashes)
    } yield Right(MfaBackupCodesResponse(backupCodes = codes))
  }

  private def generateToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    bytes.map("%02x".format(_)).mkString
  }
}

object MfaService {

  /** Uniform failure for every MFA credential-proof rejection (wrong/expired/
   *  unknown/attempt-capped code or challenge) -- evaluation-1.md CR1: the
   *  zero-arg `ServiceError.Unauthorized()` default ("Invalid email or
   *  password", `ServiceError.scala:20`) was written for the password-login
   *  case and was leaking into every MFA failure surface verbatim. Text-only
   *  fix -- the *uniformity* itself (identical message for every MFA failure
   *  mode, so there is no oracle distinguishing wrong-code from
   *  expired/unknown/capped-challenge) is the deliberate `mfa-login-gate`
   *  spec design and is unchanged; every call site below shares this one
   *  instance rather than re-stating the string. */
  private val InvalidCode: ServiceError.Unauthorized = ServiceError.Unauthorized("Invalid or expired code")

  /** Backup codes issued per enrollment-confirm/regenerate (design.md D6). */
  val BackupCodeCount: Int = 10

  /** Login-challenge attempt cap (design.md D4). */
  val MaxAttempts: Int = 5

  /** Login-challenge TTL in seconds — 5 minutes (design.md D4). */
  val ChallengeTtlSeconds: Long = 5 * 60

  private val rng = new SecureRandom()
}
