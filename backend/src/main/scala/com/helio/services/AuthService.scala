package com.helio.services

import com.github.t3hnar.bcrypt._
import com.helio.api.RequestValidation
import com.helio.api.protocols.{AuthResponse, GoogleProfile, LoginRequest, RegisterRequest, UserResponse}
import com.helio.domain.{User, UserId, UserSession}
import com.helio.infrastructure.UserRepository

import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Future}

/** Security-critical service.
 *
 *  Moves credential validation, password hashing, session minting and the
 *  OAuth profile→user→session sequence out of `AuthRoutes` / `OAuthRoutes`.
 *  HTTP-level concerns (header parsing, redirect URLs, Google token exchange)
 *  stay in the routes — `OAuthRoutes` continues to own
 *  `exchangeCodeForTokenImpl` and `fetchGoogleProfileImpl` because the test
 *  suite overrides them as protected hooks.
 *
 *  Byte-identical behaviour with the pre-CS2b code is mandatory:
 *  - BCrypt `bcryptBounded(12)` for hashing
 *  - 60-char dummy BCrypt hash for constant-time login compare
 *  - 30-day session expiry (`30L * 24 * 60 * 60` seconds)
 *  - 32-byte hex session tokens
 *  - 16-byte hex CSRF state tokens with 5-minute TTL in an in-memory store */
/** Internal carrier from `AuthService` to the route layer: the wire-facing
 *  [[AuthResponse]] no longer includes the raw token (HEL-287 CodeQL #8 —
 *  the token is delivered via `Set-Cookie`, not the JSON body), but the
 *  route layer still needs the raw value once, to build that cookie. Never
 *  marshaled to JSON. */
final case class AuthResult(token: String, response: AuthResponse)

/** HEL-702: shared `AuthResult` constructor for [[MfaService.verifyLogin]],
 *  which mints a session independently of [[AuthService]] — `MfaService` is
 *  a collaborator OF `AuthService` (see the `mfaService` ctor param below),
 *  never the reverse, so it cannot call `AuthService`'s private
 *  `authResultOf`. Byte-identical to that private method. */
object AuthResult {
  def of(session: UserSession, user: User): AuthResult =
    AuthResult(
      token = session.token,
      response = AuthResponse(
        expiresAt = session.expiresAt.toString,
        user      = UserResponse.fromDomain(user)
      )
    )
}

/** HEL-702: the outcome of a completed primary-auth attempt (password login
 *  or OAuth callback) once [[AuthService.finishLogin]] has applied the
 *  MFA gate — either a session was minted as today, or a pending challenge
 *  was created and the caller must complete `POST /api/auth/mfa/verify`
 *  before one exists (`mfa-login-gate` spec). */
sealed trait LoginOutcome

object LoginOutcome {
  final case class SessionEstablished(result: AuthResult) extends LoginOutcome
  final case class MfaRequired(challengeToken: String) extends LoginOutcome
}

final class AuthService(
    userRepo: UserRepository,
    // HEL-702: defaulted so every existing positional `new AuthService(userRepo)`
    // call site (specs, ApiRoutes fixtures) compiles untouched and keeps minting
    // sessions unconditionally — `None` means "MFA feature absent", identical to
    // today's behaviour. See `finishLogin` at the bottom of this class.
    mfaService: Option[MfaService] = None
)(implicit ec: ExecutionContext) {

  import AuthService._

  // ── Register ──────────────────────────────────────────────────────────────

  def register(rawRequest: RegisterRequest): Future[Either[ServiceError, AuthResult]] =
    RequestValidation.validateRegisterRequest(rawRequest) match {
      case Left(err)  => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(req) =>
        userRepo.findByEmail(req.email).flatMap {
          case Some(_) =>
            Future.successful(Left(ServiceError.Conflict("email already registered")))
          case None =>
            val passwordHash = req.password.bcryptBounded(BCryptWorkFactor)
            val now          = Instant.now()
            val user = User(
              id          = UserId(UUID.randomUUID().toString),
              email       = req.email,
              displayName = req.displayName,
              createdAt   = now
            )
            val session = buildSession(user.id, now)
            for {
              createdUser    <- userRepo.insert(user, Some(passwordHash))
              createdSession <- userRepo.createSession(session)
            } yield Right(authResultOf(createdSession, createdUser))
        }
    }

  // ── Login ─────────────────────────────────────────────────────────────────

  def login(rawRequest: LoginRequest): Future[Either[ServiceError, LoginOutcome]] =
    RequestValidation.validateLoginRequest(rawRequest) match {
      case Left(err)  => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(req) =>
        userRepo.findByEmail(req.email).flatMap {
          case None =>
            // Run dummy bcrypt to equalise timing — prevents user enumeration via response time.
            req.password.isBcryptedBounded(DummyHash)
            Future.successful(Left(ServiceError.Unauthorized()))
          case Some(user) =>
            userRepo.getPasswordHash(user.id).flatMap {
              case None =>
                Future.successful(Left(ServiceError.Unauthorized()))
              case Some(hash) if req.password.isBcryptedBounded(hash) =>
                finishLogin(user).map(Right(_))
              case Some(_) =>
                Future.successful(Left(ServiceError.Unauthorized()))
            }
        }
    }

  // ── Logout ────────────────────────────────────────────────────────────────

  def logout(token: String): Future[Either[ServiceError, Unit]] =
    userRepo.findSession(token).flatMap {
      case None    => Future.successful(Left(ServiceError.Unauthorized("Invalid or expired token")))
      case Some(_) => userRepo.deleteSession(token).map(_ => Right(()))
    }

  // ── OAuth completion ──────────────────────────────────────────────────────

  /** Given a Google profile fetched by the route layer, upsert the user and
   *  apply the same MFA gate the password path uses (`finishLogin`) —
   *  either a session is minted, or a pending challenge is returned
   *  (HEL-702). */
  def completeOAuth(profile: GoogleProfile): Future[LoginOutcome] = {
    val email = profile.email.getOrElse(s"google:${profile.sub}@helio.invalid")
    for {
      user    <- userRepo.upsertGoogleUser(profile.sub, email, profile.name, profile.picture)
      outcome <- finishLogin(user)
    } yield outcome
  }

  // ── CSRF state token store (OAuth `state` parameter) ──────────────────────

  /** Instance forwarder to [[AuthService.generateCsrfState]] so OAuth routes
   *  can call `authService.generateCsrfState()` without leaking the companion. */
  def generateCsrfState(): String =
    AuthService.generateCsrfState()

  /** Instance forwarder to [[AuthService.validateCsrfState]]. */
  def validateCsrfState(state: String): Boolean =
    AuthService.validateCsrfState(state)

  // ── Internal helpers ──────────────────────────────────────────────────────

  private def authResultOf(session: UserSession, user: User): AuthResult =
    AuthResult(
      token = session.token,
      response = AuthResponse(
        expiresAt = session.expiresAt.toString,
        user      = UserResponse.fromDomain(user)
      )
    )

  // ── MFA gate (HEL-702, design.md D3) ────────────────────────────────────────
  //
  // Single call site inserted at both session-establishment points above
  // (the password `login` success branch, and `completeOAuth`) rather than
  // restructuring either method — keeps this file's diff isolated to the two
  // one-line call-site swaps above plus this appended block.

  /** `mfaService` absent (the default) mints a session unconditionally,
   *  identical to pre-HEL-702 behaviour. When present, delegates to
   *  [[MfaService.createLoginChallenge]]: `Some(token)` means the account
   *  has MFA enabled, so a challenge is returned instead of a session;
   *  `None` means MFA is not enabled for this account and login proceeds
   *  exactly as if the feature were absent. */
  private def finishLogin(user: User): Future[LoginOutcome] =
    mfaService match {
      case Some(svc) =>
        svc.createLoginChallenge(user).flatMap {
          case Some(challengeToken) => Future.successful(LoginOutcome.MfaRequired(challengeToken))
          case None                 => mintSession(user)
        }
      case None => mintSession(user)
    }

  private def mintSession(user: User): Future[LoginOutcome] = {
    val session = buildSession(user.id, Instant.now())
    userRepo.createSession(session).map(created => LoginOutcome.SessionEstablished(authResultOf(created, user)))
  }
}

object AuthService {

  /** BCrypt work factor — pinned to 12 for byte-identical hashing with the
   *  pre-CS2b code. Do NOT change without a deliberate security review. */
  val BCryptWorkFactor: Int = 12

  /** Session TTL in seconds (30 days). */
  val SessionTtlSeconds: Long = 30L * 24 * 60 * 60

  /** A structurally valid 60-char BCrypt hash used to equalise timing when the
   *  email is not found during login. Format: `$2a$12$<22-char salt><31-char checksum>`.
   *  Must remain the same string the pre-CS2b `AuthRoutes` used. */
  private[services] val DummyHash =
    "$2a$12$WnXAlhcaBqZYNJqSnJmFNeY38EqpqKpUwHiMw.xsJp7yDt0hXJqP2"

  private val rng = new SecureRandom()

  /** 32-byte hex (64-char) session token. */
  def generateSessionToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    bytes.map("%02x".format(_)).mkString
  }

  def buildSession(userId: UserId, now: Instant): UserSession =
    UserSession(
      token     = generateSessionToken(),
      userId    = userId,
      createdAt = now,
      expiresAt = now.plusSeconds(SessionTtlSeconds)
    )

  // ── CSRF state store ──────────────────────────────────────────────────────

  /** In-memory CSRF state store: state -> expiry (epochSecond). In production
   *  this would be a session cookie or distributed store; behaviour preserved
   *  from the pre-CS2b `AuthSupport.csrfStateStore`. */
  private val csrfStateStore     = new ConcurrentHashMap[String, Long]()
  private val CsrfStateTtlSeconds = 300L // 5 minutes — unchanged from pre-CS2b.

  /** Generate a 16-byte hex (32-char) CSRF state token and store its expiry. */
  def generateCsrfState(): String = {
    val bytes = new Array[Byte](16)
    rng.nextBytes(bytes)
    val state = bytes.map("%02x".format(_)).mkString
    csrfStateStore.put(state, Instant.now().getEpochSecond + CsrfStateTtlSeconds)
    state
  }

  /** Remove + validate. Returns `true` iff the state existed and has not expired. */
  def validateCsrfState(state: String): Boolean = {
    val expiryOpt = Option(csrfStateStore.remove(state))
    expiryOpt.exists(_ > Instant.now().getEpochSecond)
  }
}
