package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{ApiTokenResponse, CreateApiTokenRequest, CreateApiTokenResponse}
import com.helio.domain.{ApiToken, ApiTokenId, AuthenticatedUser, PipelineId}
import com.helio.infrastructure.{ApiTokenRepository, PipelineRepository, TokenHashing}

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
 *    authentication time compare hashes (see AuthDirectives).
 *
 *  `pipelineRepo` (HEL-369) is only consulted when `scopedPipelineIds` is
 *  present on the create request, to enforce the mint-time invariant that a
 *  scoped token can only ever name pipelines the caller could actually
 *  trigger a run on (owner, or editor grantee -- NOT a viewer grantee, who
 *  can never trigger a run per `PipelineRunService.submit`'s own check;
 *  see design.md Decision 1). */
final class ApiTokenService(
    apiTokenRepo: ApiTokenRepository,
    pipelineRepo: PipelineRepository
)(implicit ec: ExecutionContext) {

  import ApiTokenService._

  def create(
      rawRequest: CreateApiTokenRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, CreateApiTokenResponse]] =
    RequestValidation.validateCreateApiTokenRequest(rawRequest) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(req) =>
        validateScope(req.scopedPipelineIds, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            val now      = Instant.now()
            val rawToken = generateRawToken()
            val token = ApiToken(
              id                = ApiTokenId(UUID.randomUUID().toString),
              userId            = user.id,
              tokenHash         = sha256Hex(rawToken),
              name              = req.name.trim,
              createdAt         = now,
              lastUsedAt        = None,
              expiresAt         = req.expiresInDays.map(days => now.plus(days.toLong, ChronoUnit.DAYS)),
              scopedPipelineIds = req.scopedPipelineIds.map(_.toSet)
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
    }

  /** Sequential, short-circuiting: the first pipeline id the caller cannot
   *  edit fails the whole request with a `BadRequest` naming it. Owner check
   *  first (the common case, one query), editor-grant check only if not
   *  owner. */
  private def validateScope(scopedPipelineIds: Option[Seq[String]], user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    scopedPipelineIds match {
      case None => Future.successful(Right(()))
      case Some(ids) =>
        ids.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, rawId) =>
          accF.flatMap {
            case left @ Left(_) => Future.successful(left)
            case Right(_) =>
              val pipelineId = PipelineId(rawId)
              pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
                case Some(_) => Future.successful(Right(()))
                case None =>
                  pipelineRepo.findGrantRole(pipelineId, user).map {
                    case Some("editor") => Right(())
                    case _ => Left(ServiceError.BadRequest(
                      s"scopedPipelineIds: pipeline '$rawId' not found or caller lacks editor access"
                    ))
                  }
              }
          }
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

  /** SHA-256 hex of the full raw token (prefix included). Delegates to the
   *  shared [[TokenHashing]] helper (HEL-288) so `AuthDirectives`'s existing
   *  `ApiTokenService.sha256Hex` call site needs no change. */
  def sha256Hex(raw: String): String = TokenHashing.sha256Hex(raw)
}
