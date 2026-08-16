package com.helio.infrastructure

import com.helio.domain.{AgentMemoryEntry, AgentMemoryId, AgentMemoryKind, AuthenticatedUser, UserId}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for the free-form agent-memory store (HEL-478 / 420-B). Multi-row-per-owner (like
 *  `ApiTokenRepository`), not a single JSONB row per user (unlike
 *  `AgentPreferencesRepository`) -- see design.md Decision 1.
 *
 *  `add`'s cap-and-evict runs in the SAME transaction as the insert (design.md Decision 3): the
 *  caller (`AgentMemoryService`) supplies `cap` so the constant lives at the service layer, not
 *  hardcoded into this repository's query -- see design.md's Risks section. Every method runs
 *  under [[DbContext.withUserContext]]; there is no privileged/pre-auth read path here (unlike
 *  `ApiTokenRepository`'s authentication lookups). */
class AgentMemoryRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AgentMemoryRepository._

  private val table = TableQuery[AgentMemoryTable]

  /** Insert `entry`, then -- in the SAME transaction -- if the owner's resulting row count
   *  exceeds `cap`, delete exactly one existing row: the one with the oldest `last_used_at`
   *  (an entry with no `last_used_at` is evicted before any entry that has one, i.e.
   *  `ORDER BY last_used_at ASC NULLS FIRST`), falling back to oldest `created_at` as the
   *  tiebreak (design.md Decision 3). */
  def add(entry: AgentMemoryEntry, cap: Int): Future[AgentMemoryEntry] = {
    val ownerUuid = UUID.fromString(entry.ownerId.value)
    val newRowId  = UUID.fromString(entry.id.value)
    val action = (table += toRow(entry)) andThen evictIfOverCap(ownerUuid, newRowId, cap)
    ctx.withUserContext(entry.ownerId.value)(action).map(_ => entry)
  }

  /** All of the caller's entries, newest-first by `created_at` -- matches
   *  `ApiTokenRepository.list`'s explicit ordering convention. */
  def list(user: AuthenticatedUser): Future[Seq[AgentMemoryEntry]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain))
  }

  /** Updates `last_used_at` to now. A no-op (not an error) for an unknown or cross-user id --
   *  mirrors `ApiTokenRepository.touchLastUsed`'s update-based shape (design.md Decision 4). */
  def touch(id: AgentMemoryId, user: AuthenticatedUser): Future[Unit] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table
        .filter(m => m.id === UUID.fromString(id.value) && m.ownerId === ownerUuid)
        .map(_.lastUsedAt)
        .update(Some(Instant.now()))
    ).map(_ => ())
  }

  /** Deletes the caller's entry. `false` for an unknown or cross-user id -- existence and
   *  authorization are indistinguishable at the API (404), mirrors `ApiTokenRepository.revoke`. */
  def delete(id: AgentMemoryId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(m => m.id === UUID.fromString(id.value) && m.ownerId === ownerUuid).delete
    ).map(_ > 0)
  }

  /** Deletes every entry owned by the caller, returning the count removed (0 is not an error --
   *  clearing an already-empty memory succeeds, design.md Decision 5). */
  def clear(user: AuthenticatedUser): Future[Int] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(_.ownerId === ownerUuid).delete
    )
  }

  /** `excludeId` is the row `add` just inserted in the same transaction (design.md Decision 3's
   *  cap-and-evict, cycle-2 evaluator fix): the candidate query below MUST never select it, even
   *  though it always starts with `lastUsedAt = None`. Without this exclusion, once every
   *  pre-existing (at-cap) entry has already been `touch`ed (non-null `last_used_at`), the
   *  newly-inserted row becomes the sole `NULLS FIRST` candidate and gets evicted instead of an
   *  existing entry -- violating the "delete an existing entry" invariant. */
  private def evictIfOverCap(ownerUuid: UUID, excludeId: UUID, cap: Int): DBIO[Int] =
    table.filter(_.ownerId === ownerUuid).length.result.flatMap { count =>
      if (count > cap)
        table
          .filter(m => m.ownerId === ownerUuid && m.id =!= excludeId)
          .sortBy(m => (m.lastUsedAt.asc.nullsFirst, m.createdAt.asc))
          .map(_.id)
          .take(1)
          .result
          .headOption
          .flatMap {
            case Some(evictId) => table.filter(_.id === evictId).delete
            case None          => DBIO.successful(0)
          }
      else DBIO.successful(0)
    }

  private def toRow(entry: AgentMemoryEntry): AgentMemoryRow =
    AgentMemoryRow(
      id         = UUID.fromString(entry.id.value),
      ownerId    = UUID.fromString(entry.ownerId.value),
      kind       = AgentMemoryKind.asString(entry.kind),
      content    = entry.content,
      createdAt  = entry.createdAt,
      lastUsedAt = entry.lastUsedAt
    )

  private def rowToDomain(row: AgentMemoryRow): AgentMemoryEntry =
    AgentMemoryEntry(
      id      = AgentMemoryId(row.id.toString),
      ownerId = UserId(row.ownerId.toString),
      kind    = AgentMemoryKind
        .fromString(row.kind)
        .getOrElse(throw new IllegalStateException(s"Unknown agent memory kind in DB: '${row.kind}'")),
      content    = row.content,
      createdAt  = row.createdAt,
      lastUsedAt = row.lastUsedAt
    )
}

object AgentMemoryRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  final case class AgentMemoryRow(
      id: UUID,
      ownerId: UUID,
      kind: String,
      content: String,
      createdAt: Instant,
      lastUsedAt: Option[Instant]
  )

  class AgentMemoryTable(tag: Tag) extends Table[AgentMemoryRow](tag, "agent_memory") {
    def id         = column[UUID]("id", O.PrimaryKey)
    def ownerId    = column[UUID]("owner_id")
    def kind       = column[String]("kind")
    def content    = column[String]("content")
    def createdAt  = column[Instant]("created_at")
    def lastUsedAt = column[Option[Instant]]("last_used_at")
    def * = (id, ownerId, kind, content, createdAt, lastUsedAt) <> (AgentMemoryRow.tupled, AgentMemoryRow.unapply)
  }
}
