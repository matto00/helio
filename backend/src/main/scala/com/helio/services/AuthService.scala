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
final class AuthService(
    userRepo: UserRepository
)(implicit ec: ExecutionContext) {

  import AuthService._

  // ── Register ──────────────────────────────────────────────────────────────

  def register(rawRequest: RegisterRequest): Future[Either[ServiceError, AuthResponse]] =
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
            } yield Right(authResponseOf(createdSession, createdUser))
        }
    }

  // ── Login ─────────────────────────────────────────────────────────────────

  def login(rawRequest: LoginRequest): Future[Either[ServiceError, AuthResponse]] =
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
                val session = buildSession(user.id, Instant.now())
                userRepo.createSession(session).map { created =>
                  Right(authResponseOf(created, user))
                }
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

  /** Given a Google profile fetched by the route layer, upsert the user, mint
   *  a session, and return the `AuthResponse` body. */
  def completeOAuth(profile: GoogleProfile): Future[AuthResponse] = {
    val email = profile.email.getOrElse(s"google:${profile.sub}@helio.invalid")
    for {
      user    <- userRepo.upsertGoogleUser(profile.sub, email, profile.name, profile.picture)
      session <- userRepo.createSession(buildSession(user.id, Instant.now()))
    } yield authResponseOf(session, user)
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

  private def authResponseOf(session: UserSession, user: User): AuthResponse =
    AuthResponse(
      token     = session.token,
      expiresAt = session.expiresAt.toString,
      user      = UserResponse.fromDomain(user)
    )
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
