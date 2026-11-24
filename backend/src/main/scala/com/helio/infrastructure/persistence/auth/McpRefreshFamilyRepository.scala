package com.helio.infrastructure.persistence.auth

import com.helio.domain.model.{ApiTokenId, McpRefreshFamilyId, UserId}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.GetResult
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for `mcp_refresh_families` (V147, HEL-1713). Every method runs under the PAT owner's
 *  [[DbContext.withUserContext]], so the V147 owner-only policy scopes each read, write and the reuse
 *  path's PAT delete to that user; nothing here uses the privileged pool. */
class McpRefreshFamilyRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import McpRefreshFamilyRepository._

  /** Creates a family for the PAT `tokenId`, expiring with it (90 days from now when the PAT never
   *  expires). `None` when the PAT row is not the caller's, which cannot happen for an authenticated PAT. */
  def create(
      user: UserId,
      tokenId: ApiTokenId,
      clientIdHash: String,
      resource: String,
      jtiHash: String
  ): Future[Option[Created]] =
    ctx.withUserContext(user.value)(
      sql"""INSERT INTO mcp_refresh_families
              (user_id, api_token_id, client_id_hash, resource, current_jti_hash, expires_at)
            SELECT t.user_id, t.id, $clientIdHash, $resource, $jtiHash,
                   COALESCE(t.expires_at, now() + interval '90 days')
            FROM api_tokens t
            WHERE t.id = ${tokenId.value}::uuid AND t.user_id = ${user.value}::uuid
            RETURNING id::text, expires_at"""
        .as[(String, Instant)].headOption
    ).map(_.map { case (id, expiresAt) => Created(McpRefreshFamilyId(id), expiresAt) })

  /** Rotates one family in one transaction.
   *
   *  The compare-and-swap UPDATE is the only path that moves `current_jti_hash`: it matches the family,
   *  the authenticating PAT, the presented hash, the client and resource, and an unexpired family, so two
   *  concurrent rotations of the same token cannot both succeed (the loser blocks on the row lock and
   *  re-evaluates the predicate against the winner's new hash).
   *
   *  On zero rows the row is read under `FOR UPDATE` and the cause is decided in a fixed order: missing
   *  or another token's (`NotFound`), then expired (`Expired`: the PAT is at or past its own expiry, so
   *  nothing is revoked), then client/resource mismatch (`Mismatch`, no state change), and only then
   *  reuse: a well-formed hash that is not the current one means a rotated-away token was replayed, so
   *  the PAT is deleted in this same transaction and the FK cascade removes every family it backs. */
  def rotate(
      user: UserId,
      tokenId: ApiTokenId,
      familyId: McpRefreshFamilyId,
      clientIdHash: String,
      resource: String,
      presentedJtiHash: String,
      nextJtiHash: String
  ): Future[RotateOutcome] = {
    val token  = tokenId.value
    val family = familyId.value
    val cas =
      sql"""UPDATE mcp_refresh_families
            SET current_jti_hash = $nextJtiHash, generation = generation + 1, last_rotated_at = now()
            WHERE id = $family::uuid AND api_token_id = $token::uuid AND current_jti_hash = $presentedJtiHash
              AND client_id_hash = $clientIdHash AND resource = $resource AND expires_at > now()
            RETURNING generation, expires_at""".as[(Int, Instant)].headOption

    val diagnose =
      sql"""SELECT generation, client_id_hash, resource, expires_at <= now()
            FROM mcp_refresh_families
            WHERE id = $family::uuid AND api_token_id = $token::uuid
            FOR UPDATE""".as[(Int, String, String, Boolean)].headOption.flatMap {
        case None => DBIO.successful(RotateOutcome.NotFound)
        case Some((_, _, _, true)) => DBIO.successful(RotateOutcome.Expired)
        case Some((_, storedClient, storedResource, _)) if storedClient != clientIdHash || storedResource != resource =>
          DBIO.successful(RotateOutcome.Mismatch)
        case Some((generation, _, _, _)) =>
          sqlu"DELETE FROM api_tokens WHERE id = $token::uuid AND user_id = ${user.value}::uuid"
            .map(_ => RotateOutcome.Reused(familyId, generation))
      }

    ctx.withUserContext(user.value)(cas.flatMap {
      case Some((generation, expiresAt)) => DBIO.successful(RotateOutcome.Rotated(generation, expiresAt))
      case None                          => diagnose
    })
  }
}

object McpRefreshFamilyRepository {

  final case class Created(id: McpRefreshFamilyId, expiresAt: Instant)

  sealed trait RotateOutcome
  object RotateOutcome {
    final case class Rotated(generation: Int, expiresAt: Instant) extends RotateOutcome
    case object NotFound                                          extends RotateOutcome
    case object Expired                                           extends RotateOutcome
    case object Mismatch                                          extends RotateOutcome
    final case class Reused(familyId: McpRefreshFamilyId, generation: Int) extends RotateOutcome
  }

  private implicit val getInstant: GetResult[Instant] = GetResult(r => r.nextTimestamp().toInstant)
}
