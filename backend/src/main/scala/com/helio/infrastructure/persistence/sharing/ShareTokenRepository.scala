package com.helio.infrastructure.persistence.sharing

import com.helio.domain.model.{DashboardId, ShareToken, ShareTokenId, UserId}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Repository for `share_tokens` (HEL-590). Follows `ResourcePermissionRepository`'s file shape:
 *  a bare Slick table + row case class, domain<->row mapping, and every query routed through
 *  [[DbContext]] -- never a raw `db.run`.
 *
 *  Pool assignment (design.md D6): `insert`/`findByDashboard`/`revoke` are owner-facing and go
 *  through `ctx.withUserContext(userId)` so the V101 owner-only RLS policy on `share_tokens` is
 *  actually exercised by shipped code, even though `AccessChecker.requireOwnerOnly` has already
 *  authorized the caller at the service layer -- that redundancy is the point (defence in depth).
 *  Only `findActiveByHash` -- the anonymous validation lookup, which has no
 *  `app.current_user_id` to set -- goes through `ctx.withSystemContext`. */
class ShareTokenRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import ShareTokenRepository._

  private val table = TableQuery[ShareTokenTable]

  private def rowToDomain(row: ShareTokenRow): ShareToken =
    ShareToken(
      id          = ShareTokenId(row.id.toString),
      dashboardId = DashboardId(row.dashboardId),
      userId      = UserId(row.userId.toString),
      tokenHash   = row.tokenHash,
      expiresAt   = row.expiresAt,
      revokedAt   = row.revokedAt,
      createdAt   = row.createdAt
    )

  private def domainToRow(t: ShareToken): ShareTokenRow =
    ShareTokenRow(
      id          = UUID.fromString(t.id.value),
      dashboardId = t.dashboardId.value,
      userId      = UUID.fromString(t.userId.value),
      tokenHash   = t.tokenHash,
      expiresAt   = t.expiresAt,
      revokedAt   = t.revokedAt,
      createdAt   = t.createdAt
    )

  def insert(token: ShareToken): Future[ShareToken] =
    ctx.withUserContext(token.userId.value)(table += domainToRow(token)).map(_ => token)

  def findByDashboard(dashboardId: DashboardId, userId: UserId): Future[Vector[ShareToken]] =
    ctx.withUserContext(userId.value)(
      table.filter(_.dashboardId === dashboardId.value).result
    ).map(_.map(rowToDomain).toVector)

  /** Anonymous validation lookup -- no authenticated user, so no `app.current_user_id` can be
   *  set. Reads through the privileged (BYPASSRLS) pool, mirroring
   *  `ResourcePermissionRepository.hasPublicViewerGrant`'s existing justification for the same
   *  shape of anonymous read. */
  def findActiveByHash(tokenHash: String): Future[Option[ShareToken]] =
    ctx.withSystemContext(
      table.filter(_.tokenHash === tokenHash).result.headOption
    ).map(_.map(rowToDomain))

  /** Idempotent: filtered only on `id` and `user_id`, never on `revoked_at IS NULL`, so
   *  re-revoking an already-revoked token still matches and succeeds again rather than reporting
   *  failure the second time. Zero rows affected means either the id doesn't exist at all, or it
   *  belongs to another owner -- the two are indistinguishable here by construction.
   *
   *  Evaluation-1.md CR6 (and evaluation-2.md CR-D, which added `ShareTokenRepositoryRevokeSpec`
   *  to isolate this from RLS): the `user_id` filter is explicit in the QUERY, not left to RLS
   *  alone. RLS (`withUserContext`) remains defence-in-depth -- `ShareTokenRlsSpec` still exercises
   *  it -- but dev/CI both connect as a superuser that bypasses RLS entirely (the repo's own
   *  documented reality, and the root cause of the HEL-974 incident), so a query-level filter is
   *  what actually holds the owner boundary in every environment this code is ever tested in. */
  def revoke(id: ShareTokenId, userId: UserId): Future[Boolean] =
    ctx.withUserContext(userId.value)(
      table
        .filter(row => row.id === UUID.fromString(id.value) && row.userId === UUID.fromString(userId.value))
        .map(_.revokedAt)
        .update(Some(Instant.now()))
    ).map(_ > 0)
}

object ShareTokenRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, Timestamp](
      instant => Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class ShareTokenRow(
      id: UUID,
      dashboardId: String,
      userId: UUID,
      tokenHash: String,
      expiresAt: Option[Instant],
      revokedAt: Option[Instant],
      createdAt: Instant
  )

  class ShareTokenTable(tag: Tag) extends Table[ShareTokenRow](tag, "share_tokens") {
    def id          = column[UUID]("id")
    def dashboardId = column[String]("dashboard_id")
    def userId      = column[UUID]("user_id")
    def tokenHash   = column[String]("token_hash")
    def expiresAt   = column[Option[Instant]]("expires_at")
    def revokedAt   = column[Option[Instant]]("revoked_at")
    def createdAt   = column[Instant]("created_at")

    def * = (id, dashboardId, userId, tokenHash, expiresAt, revokedAt, createdAt).mapTo[ShareTokenRow]
  }
}
