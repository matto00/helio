package com.helio.infrastructure.persistence.sources

import com.helio.domain.model.{ConnectorCompletionToken, ConnectorCompletionTokenId, ConnectorId, UserId}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Repository for `connector_completion_tokens` (HEL-955, V103) -- mirrors
 *  [[com.helio.infrastructure.persistence.sharing.ShareTokenRepository]]'s shape almost exactly
 *  (design.md D2), with the two deliberate divergences documented on [[ConnectorCompletionToken]]
 *  itself: `expiresAt` is never optional, and single-use consumption (`consume`) replaces
 *  revocation.
 *
 *  Pool assignment mirrors `ShareTokenRepository`: `mintSupersedingPrior` (owner-facing mint,
 *  including the D9 re-mint atomic-supersede) goes through `ctx.withUserContext` so the
 *  owner-only RLS policy is actually exercised. `findByHash`/`consume` -- the anonymous
 *  completion-endpoint lookup/write, which has no `app.current_user_id` to set -- go through
 *  `ctx.withSystemContext`, mirroring `findActiveByHash`'s justification. */
class ConnectorCompletionTokenRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import ConnectorCompletionTokenRepository._

  private val table = TableQuery[ConnectorCompletionTokenTable]

  private def rowToDomain(row: TokenRow): ConnectorCompletionToken =
    ConnectorCompletionToken(
      id           = ConnectorCompletionTokenId(row.id.toString),
      connectorId  = ConnectorId(row.connectorId.toString),
      userId       = UserId(row.userId.toString),
      tokenHash    = row.tokenHash,
      expiresAt    = row.expiresAt,
      consumedAt   = row.consumedAt,
      supersededAt = row.supersededAt,
      createdAt    = row.createdAt
    )

  /** HEL-955 design.md D9: mints a new token for `connectorId`, atomically superseding every
   *  currently-live token for that same Connector in the SAME transaction -- never a window with
   *  two live tokens (a fresh Connector with no prior tokens simply supersedes zero rows). Runs
   *  on the app pool (`withUserContext`) -- the caller is always an authenticated owner, whether
   *  minting the first token at Connector-creation time or re-minting (agent re-initiation or the
   *  owner re-mint endpoint). */
  def mintSupersedingPrior(connectorId: ConnectorId, userId: UserId, tokenHash: String, expiresAt: Instant): Future[ConnectorCompletionToken] = {
    val now = Instant.now()
    val connectorUuid = UUID.fromString(connectorId.value)
    val supersedeAction = table
      .filter(r => r.connectorId === connectorUuid && r.consumedAt.isEmpty && r.supersededAt.isEmpty)
      .map(_.supersededAt)
      .update(Some(now))
    val row = TokenRow(
      id           = UUID.randomUUID(),
      connectorId  = connectorUuid,
      userId       = UUID.fromString(userId.value),
      tokenHash    = tokenHash,
      expiresAt    = expiresAt,
      consumedAt   = None,
      supersededAt = None,
      createdAt    = now
    )
    val action = supersedeAction.andThen(table += row)
    ctx.withUserContext(userId.value)(action.transactionally).map(_ => rowToDomain(row))
  }

  /** Anonymous validation lookup -- privileged pool, mirrors
   *  `ShareTokenRepository.findActiveByHash`. Returns the raw row regardless of validity; every
   *  state check (expiry, consumed, superseded) happens in memory in
   *  `ConnectorCompletionValidator`, and the actual enforcement against a concurrent race lives
   *  in [[consume]]'s conditional predicate, not here. */
  def findByHash(tokenHash: String): Future[Option[ConnectorCompletionToken]] =
    ctx.withSystemContext(table.filter(_.tokenHash === tokenHash).result.headOption).map(_.map(rowToDomain))

  /** HEL-955 design.md D3: the atomic single-use consumption predicate. **Every** validity
   *  condition lives here, not only in the in-memory validator -- `consumed_at IS NULL AND
   *  superseded_at IS NULL AND expires_at > now()` -- so a token superseded by a concurrent
   *  re-mint (D9) cannot still bind even if it was read as live moments earlier (the
   *  supersede-vs-consume race). A zero-row result means "no longer usable", for any reason,
   *  and the caller treats it identically to every other invalid-token case. Runs on the
   *  privileged pool -- the anonymous completion endpoint has no `app.current_user_id`. */
  def consume(tokenHash: String): Future[Boolean] = {
    val now = Instant.now()
    val action = table
      .filter(r => r.tokenHash === tokenHash && r.consumedAt.isEmpty && r.supersededAt.isEmpty && r.expiresAt > now)
      .map(_.consumedAt)
      .update(Some(now))
    ctx.withSystemContext(action).map(_ > 0)
  }

  /** Owner-scoped lookup of every live (not consumed, not superseded, not expired) token for a
   *  Connector -- used by `ConnectorCompletionService`'s D9 re-mint path to decide whether a
   *  fresh mint is actually needed, and by tests asserting the supersede invariant. */
  def findLiveByConnector(connectorId: ConnectorId, userId: UserId): Future[Vector[ConnectorCompletionToken]] = {
    val connectorUuid = UUID.fromString(connectorId.value)
    val now           = Instant.now()
    ctx.withUserContext(userId.value)(
      table.filter(r => r.connectorId === connectorUuid && r.consumedAt.isEmpty && r.supersededAt.isEmpty && r.expiresAt > now).result
    ).map(_.map(rowToDomain).toVector)
  }
}

object ConnectorCompletionTokenRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, Timestamp](
      instant => Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class TokenRow(
      id: UUID,
      connectorId: UUID,
      userId: UUID,
      tokenHash: String,
      expiresAt: Instant,
      consumedAt: Option[Instant],
      supersededAt: Option[Instant],
      createdAt: Instant
  )

  class ConnectorCompletionTokenTable(tag: Tag) extends Table[TokenRow](tag, "connector_completion_tokens") {
    def id           = column[UUID]("id")
    def connectorId  = column[UUID]("connector_id")
    def userId       = column[UUID]("user_id")
    def tokenHash    = column[String]("token_hash")
    def expiresAt    = column[Instant]("expires_at")
    def consumedAt   = column[Option[Instant]]("consumed_at")
    def supersededAt = column[Option[Instant]]("superseded_at")
    def createdAt    = column[Instant]("created_at")

    def * = (id, connectorId, userId, tokenHash, expiresAt, consumedAt, supersededAt, createdAt).mapTo[TokenRow]
  }
}
