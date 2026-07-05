package com.helio.infrastructure

import com.helio.domain.{ApiToken, ApiTokenId, AuthenticatedUser, UserId}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for Personal Access Tokens (HEL-148 Phase 1).
 *
 *  Pool selection per method matters here:
 *
 *  - `create` / `list` / `revoke` are request-bound user actions and run
 *    under [[DbContext.withUserContext]], so the V42 owner-only RLS policy
 *    scopes every read and write to the caller's own tokens.
 *  - `findUserByTokenHash` / `touchLastUsed` are the authentication path
 *    itself: they execute BEFORE any user identity exists, so — exactly like
 *    the `user_sessions` lookup — they must use the privileged pool. */
class ApiTokenRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import ApiTokenRepository._

  private val tokens = TableQuery[ApiTokenTable]

  /** Insert a token for its owner. Runs under the owner's user context, so the
   *  RLS policy's implicit WITH CHECK rejects any row whose user_id is not the
   *  caller — defense in depth on top of the service setting userId itself. */
  def create(token: ApiToken): Future[ApiToken] =
    ctx.withUserContext(token.userId.value)(tokens += toRow(token)).map(_ => token)

  /** Resolve a token hash to its owner, honoring expiry.
   *
   *  Privileged callsite: this IS the authentication step — it runs before an
   *  `AuthenticatedUser` exists, so no user context can be set. RLS bypass is
   *  correct here for the same reason the `user_sessions` lookup bypasses it:
   *  the row's own `user_id` is the identity being established, and the
   *  resolved user then inherits normal RLS visibility for the request. */
  def findUserByTokenHash(hash: String): Future[Option[AuthenticatedUser]] = {
    val now = Instant.now()
    ctx.withSystemContext(
      tokens
        .filter(t => t.tokenHash === hash && (t.expiresAt.isEmpty || t.expiresAt > now))
        .map(_.userId)
        .result
        .headOption
    ).map(_.map(uid => AuthenticatedUser(UserId(uid.toString))))
  }

  /** Record token usage. Privileged callsite: invoked from the pre-auth
   *  resolution path (same justification as [[findUserByTokenHash]]). */
  def touchLastUsed(hash: String): Future[Unit] =
    ctx.withSystemContext(
      tokens.filter(_.tokenHash === hash).map(_.lastUsedAt).update(Some(Instant.now()))
    ).map(_ => ())

  /** All tokens owned by the caller, newest first. RLS-scoped. */
  def list(user: AuthenticatedUser): Future[Seq[ApiToken]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      tokens.filter(_.userId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain))
  }

  /** Delete the caller's token. Returns false for unknown or cross-user ids —
   *  existence and authorization are indistinguishable at the API (404). */
  def revoke(id: ApiTokenId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      tokens.filter(t => t.id === UUID.fromString(id.value) && t.userId === ownerUuid).delete
    ).map(_ > 0)
  }

  private def toRow(token: ApiToken): ApiTokenRow =
    ApiTokenRow(
      id         = UUID.fromString(token.id.value),
      userId     = UUID.fromString(token.userId.value),
      tokenHash  = token.tokenHash,
      name       = token.name,
      createdAt  = token.createdAt,
      lastUsedAt = token.lastUsedAt,
      expiresAt  = token.expiresAt
    )

  private def rowToDomain(row: ApiTokenRow): ApiToken =
    ApiToken(
      id         = ApiTokenId(row.id.toString),
      userId     = UserId(row.userId.toString),
      tokenHash  = row.tokenHash,
      name       = row.name,
      createdAt  = row.createdAt,
      lastUsedAt = row.lastUsedAt,
      expiresAt  = row.expiresAt
    )
}

object ApiTokenRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  final case class ApiTokenRow(
      id: UUID,
      userId: UUID,
      tokenHash: String,
      name: String,
      createdAt: Instant,
      lastUsedAt: Option[Instant],
      expiresAt: Option[Instant]
  )

  class ApiTokenTable(tag: Tag) extends Table[ApiTokenRow](tag, "api_tokens") {
    def id         = column[UUID]("id", O.PrimaryKey)
    def userId     = column[UUID]("user_id")
    def tokenHash  = column[String]("token_hash")
    def name       = column[String]("name")
    def createdAt  = column[Instant]("created_at")
    def lastUsedAt = column[Option[Instant]]("last_used_at")
    def expiresAt  = column[Option[Instant]]("expires_at")
    def * = (id, userId, tokenHash, name, createdAt, lastUsedAt, expiresAt) <> (ApiTokenRow.tupled, ApiTokenRow.unapply)
  }
}
