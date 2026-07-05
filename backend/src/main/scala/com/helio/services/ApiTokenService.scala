package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{ApiTokenResponse, CreateApiTokenRequest, CreateApiTokenResponse}
import com.helio.domain.{ApiToken, ApiTokenId, AuthenticatedUser}
import com.helio.infrastructure.ApiTokenRepository

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Security-critical service: mints, lists, and revokes Personal Access
 *  Tokens (HEL-148 Phase 1).
 *
 *  Invariants:
 *  - The raw `helio_pat_<64 hex>` credential exists only in the
 *    [[CreateApiTokenResponse]] of the creating request. It is never
 *    persisted, never logged, and never readable again.
 *  - Only the SHA-256 hex of the raw token is stored; lookups at
 *    authentication time compare hashes (see AuthDirectives). */
final class ApiTokenService(
    apiTokenRepo: ApiTokenRepository
)(implicit ec: ExecutionContext) {

  import ApiTokenService._

  def create(
      rawRequest: CreateApiTokenRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, CreateApiTokenResponse]] =
    RequestValidation.validateCreateApiTokenRequest(rawRequest) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(req) =>
        val now      = Instant.now()
        val rawToken = generateRawToken()
        val token = ApiToken(
          id         = ApiTokenId(UUID.randomUUID().toString),
          userId     = user.id,
          tokenHash  = sha256Hex(rawToken),
          name       = req.name.trim,
          createdAt  = now,
          lastUsedAt = None,
          expiresAt  = req.expiresInDays.map(days => now.plus(days.toLong, ChronoUnit.DAYS))
        )
        apiTokenRepo.create(token).map { created =>
          Right(
            CreateApiTokenResponse(
              id        = created.id.value,
              name      = created.name,
              token     = rawToken,
              createdAt = created.createdAt.toString,
              expiresAt = created.expiresAt.map(_.toString)
            )
          )
        }
    }

  def list(user: AuthenticatedUser): Future[Either[ServiceError, Seq[ApiTokenResponse]]] =
    apiTokenRepo.list(user).map(tokens => Right(tokens.map(ApiTokenResponse.fromDomain)))

  /** Existence-not-leaked: unknown and cross-user ids both map to 404. */
  def revoke(id: ApiTokenId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    apiTokenRepo.revoke(id, user).map {
      case true  => Right(())
      case false => Left(ServiceError.NotFound("Token not found"))
    }
}

object ApiTokenService {

  /** Raw-token namespace prefix. AuthDirectives uses it to skip the PAT
   *  lookup for bearer values that cannot be PATs. */
  val TokenPrefix: String = "helio_pat_"

  private val rng = new SecureRandom()

  /** `helio_pat_` + 32-byte hex (64 chars) — same entropy as session tokens. */
  def generateRawToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    TokenPrefix + bytes.map("%02x".format(_)).mkString
  }

  /** SHA-256 hex of the full raw token (prefix included). */
  def sha256Hex(raw: String): String =
    MessageDigest
      .getInstance("SHA-256")
      .digest(raw.getBytes(StandardCharsets.UTF_8))
      .map("%02x".format(_))
      .mkString
}
