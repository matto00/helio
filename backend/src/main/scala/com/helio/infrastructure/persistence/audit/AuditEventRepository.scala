package com.helio.infrastructure.persistence.audit

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model._
import com.helio.domain.model.AuditEvent.NewAuditEvent
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for the append-only `audit_events` store (HEL-471). The
 *  append-only guarantee itself lives entirely in the V91 migration (a
 *  statement-level `BEFORE UPDATE OR DELETE`/`BEFORE TRUNCATE` trigger) —
 *  this repository's job is simply to never expose an update or delete
 *  operation, and to route each method to the pool design.md Decision 2
 *  requires. */
class AuditEventRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AuditEventRepository._

  private val table = TableQuery[AuditEventTable]

  /** Inserts a new audit row and returns its DB-assigned id. Runs on the
   *  **privileged pool** (`DbContext.withSystemContext`), not the app pool —
   *  three independent reasons, per design.md Decision 2:
   *   1. The store must record pre-auth/system events with a null
   *      `actor_user_id`; the V91 owner policy is restricted to `FOR SELECT`,
   *      so under FORCE ROW LEVEL SECURITY no policy applies to INSERT at
   *      all and every app-pool insert is denied outright, actor-null or not.
   *   2. An audit record must not be contingent on the acting user's own
   *      RLS visibility — the very action worth auditing would otherwise be
   *      the one that can fail to record.
   *   3. Audit writes must be able to record an action by actor A even when
   *      the surrounding request/transaction is scoped to a different user. */
  def append(event: NewAuditEvent): Future[AuditEventId] = {
    val insertQuery =
      (table.map(t => (t.actorUserId, t.actorTokenId, t.source, t.action, t.resourceType, t.resourceId, t.metadata))
        returning table.map(_.id))
    ctx.withSystemContext(
      insertQuery += (
        (
          event.actorUserId.map(u => UUID.fromString(u.value)),
          event.actorTokenId.map(t => UUID.fromString(t.value)),
          AuditSource.asString(event.source),
          event.action,
          event.resourceType,
          event.resourceId,
          event.metadata.compactPrint
        )
      )
    ).map(id => AuditEventId(id.toString))
  }

  /** Owner-scoped: events authored by `actorUserId`, newest-first. The RLS
   *  context user passed to `withUserContext` is `callerUserId` — never
   *  `actorUserId` — so a caller can never widen their own visibility by
   *  passing someone else's actor id as the filter (see design.md Decision 2
   *  and the "RLS context user is the caller, not the filter argument"
   *  scenario in specs/audit-event-persistence). */
  def findByActor(callerUserId: UserId, actorUserId: UserId): Future[Seq[AuditEvent]] = {
    val actorUuid = UUID.fromString(actorUserId.value)
    ctx.withUserContext(callerUserId.value)(
      table.filter(_.actorUserId === actorUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain))
  }

  /** Owner-scoped: events for a given resource. `callerUserId` is the RLS
   *  context user, exactly as in `findByActor` — the method name does not
   *  suggest a user at all, which is precisely why this is documented. */
  def findByResource(callerUserId: UserId, resourceType: String, resourceId: String): Future[Seq[AuditEvent]] =
    ctx.withUserContext(callerUserId.value)(
      table.filter(t => t.resourceType === resourceType && t.resourceId === resourceId)
        .sortBy(_.createdAt.desc)
        .result
    ).map(_.map(rowToDomain))

  // No update or delete operation is exposed here, deliberately — the
  // append-only guarantee holds even if one were added (the trigger would
  // reject it), but the repository surface itself should offer no such
  // temptation.

  private def rowToDomain(row: AuditEventRow): AuditEvent =
    AuditEvent(
      id           = AuditEventId(row.id.toString),
      actorUserId  = row.actorUserId.map(u => UserId(u.toString)),
      actorTokenId = row.actorTokenId.map(t => ApiTokenId(t.toString)),
      source       = AuditSource.fromString(row.source)
        .getOrElse(throw new IllegalStateException(s"Unknown audit source in DB: '${row.source}'")),
      action       = row.action,
      resourceType = row.resourceType,
      resourceId   = row.resourceId,
      metadata     = row.metadata.parseJson,
      createdAt    = row.createdAt
    )
}

object AuditEventRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String <-> PostgreSQL JSONB (mirrors
   *  `AlertRuleRepository.jsonbStringType`/`DataSourceRepository.config`). */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  final case class AuditEventRow(
      id: UUID,
      actorUserId: Option[UUID],
      actorTokenId: Option[UUID],
      source: String,
      action: String,
      resourceType: String,
      resourceId: Option[String],
      metadata: String,
      createdAt: Instant
  )

  class AuditEventTable(tag: Tag) extends Table[AuditEventRow](tag, "audit_events") {
    def id           = column[UUID]("id", O.PrimaryKey)
    def actorUserId  = column[Option[UUID]]("actor_user_id")
    def actorTokenId = column[Option[UUID]]("actor_token_id")
    def source       = column[String]("source")
    def action       = column[String]("action")
    def resourceType = column[String]("resource_type")
    def resourceId   = column[Option[String]]("resource_id")
    def metadata     = column[String]("metadata")(jsonbStringType)
    def createdAt    = column[Instant]("created_at")
    def * = (id, actorUserId, actorTokenId, source, action, resourceType, resourceId, metadata, createdAt) <> (AuditEventRow.tupled, AuditEventRow.unapply)
  }
}
