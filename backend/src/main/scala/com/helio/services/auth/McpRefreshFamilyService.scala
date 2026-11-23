package com.helio.services.auth

import com.helio.api.protocols.auth._
import com.helio.domain.model.{AuthenticatedUser, McpRefreshFamilyId}
import com.helio.infrastructure.persistence.auth.McpRefreshFamilyRepository
import com.helio.infrastructure.persistence.auth.McpRefreshFamilyRepository.RotateOutcome
import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import org.slf4j.LoggerFactory
import spray.json.{JsNumber, JsObject, JsString}

import scala.concurrent.{ExecutionContext, Future}

/** Refresh-token family state for the helio-mcp connector (HEL-1713).
 *
 *  Only a PAT may call this (its id is the family's anchor): a session caller has no `tokenId` and gets
 *  `Forbidden`. The caller never supplies a token id, so a PAT can only ever touch its own families.
 *  A rotation answered `reused` has already deleted the PAT inside the repository's transaction; this
 *  service then records one `token.revoke` audit event, after the commit, through [[AuditService]]
 *  (which only logs a failed append, like every other revoke). No log line or event carries token material. */
final class McpRefreshFamilyService(
    repo: McpRefreshFamilyRepository,
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  import McpRefreshFamilyService._

  private val log = LoggerFactory.getLogger(getClass)

  def create(
      req: McpRefreshFamilyCreateRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, McpRefreshFamilyCreateResponse]] =
    user.tokenId match {
      case None => Future.successful(Left(ServiceError.Forbidden("A personal access token is required")))
      case Some(tokenId) =>
        validateHashes(req.clientIdHash, req.jtiHash).orElse(validateResource(req.resource)) match {
          case Some(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case None =>
            repo.create(user.id, tokenId, req.clientIdHash, req.resource, req.jtiHash).map {
              case Some(created) =>
                Right(McpRefreshFamilyCreateResponse(created.id.value, created.expiresAt.toString))
              case None => Left(ServiceError.NotFound("Token not found"))
            }
        }
    }

  def rotate(
      familyId: McpRefreshFamilyId,
      req: McpRefreshFamilyRotateRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, RotateResult]] =
    user.tokenId match {
      case None => Future.successful(Left(ServiceError.Forbidden("A personal access token is required")))
      case Some(tokenId) =>
        validateHashes(req.clientIdHash, req.presentedJtiHash, req.nextJtiHash).orElse(validateResource(req.resource)) match {
          case Some(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case None =>
            repo.rotate(user.id, tokenId, familyId, req.clientIdHash, req.resource, req.presentedJtiHash, req.nextJtiHash).map {
              case RotateOutcome.Rotated(generation, expiresAt) =>
                Right(RotateResult.Rotated(McpRefreshFamilyRotateResponse(generation, expiresAt.toString)))
              case RotateOutcome.NotFound => Left(ServiceError.NotFound("Refresh family not found"))
              case RotateOutcome.Expired  => Right(RotateResult.Refused("expired"))
              case RotateOutcome.Mismatch => Right(RotateResult.Refused("mismatch"))
              case RotateOutcome.Reused(family, generation) =>
                log.info("mcp refresh token reuse: familyId={} generation={}; the connector's PAT was revoked", family.value, Int.box(generation))
                if (auditService != null)
                  auditService.record(
                    Some(user.id), user.tokenId, user.source, "token.revoke", "api_token", Some(tokenId.value),
                    JsObject("reason" -> JsString("mcp_refresh_reuse"), "familyId" -> JsString(family.value), "generation" -> JsNumber(generation))
                  )
                Right(RotateResult.Refused("reused"))
            }
        }
    }
}

object McpRefreshFamilyService {

  /** A rotation that was decided: stored (`Rotated`) or refused with a `409` reason. */
  sealed trait RotateResult
  object RotateResult {
    final case class Rotated(response: McpRefreshFamilyRotateResponse) extends RotateResult
    final case class Refused(reason: String)                           extends RotateResult
  }

  private val Sha256Hex = "^[0-9a-f]{64}$".r
  private val MaxResourceChars = 2048

  private def validateHashes(hashes: String*): Option[String] =
    if (hashes.forall(h => Sha256Hex.matches(h))) None else Some("hashes must be lowercase SHA-256 hex strings")

  private def validateResource(resource: String): Option[String] =
    if (resource.nonEmpty && resource.length <= MaxResourceChars) None
    else Some(s"resource must be 1 to $MaxResourceChars characters")
}
