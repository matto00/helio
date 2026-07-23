package com.helio.infrastructure

import com.helio.domain._
import com.helio.services.ServiceError
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for `/api/alerts` (HEL-455), plus a
 *  privileged upsert path for the (not-yet-built) evaluation engine. `value`
 *  is stored as JSONB, mapped opaquely to a `String` at the Slick layer
 *  (`jsonbStringType`) and parsed to/from `JsValue` at the domain boundary —
 *  the same pattern `AlertRuleRepository.condition` uses. */
class AlertEventRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AlertEventRepository._

  private val table = TableQuery[AlertEventTable]

  private def rowToDomain(row: AlertEventRow): AlertEvent =
    AlertEvent(
      id               = AlertEventId(row.id),
      alertRuleId      = AlertRuleId(row.alertRuleId),
      ownerId          = UserId(row.ownerId.toString),
      targetDataTypeId = DataTypeId(row.targetDataTypeId),
      value            = row.value.parseJson,
      pipelineRunId    = row.pipelineRunId,
      severity         = Severity.fromString(row.severity)
        .getOrElse(throw new IllegalStateException(s"Unknown severity in DB: '${row.severity}'")),
      state            = AlertEventState.fromString(row.state)
        .getOrElse(throw new IllegalStateException(s"Unknown alert event state in DB: '${row.state}'")),
      firstFiredAt     = row.firstFiredAt,
      lastEvaluatedAt  = row.lastEvaluatedAt,
      resolvedAt       = row.resolvedAt,
      acknowledgedAt   = row.acknowledgedAt,
      snoozedUntil     = row.snoozedUntil
    )

  private def domainToRow(event: AlertEvent): AlertEventRow =
    AlertEventRow(
      id               = event.id.value,
      alertRuleId      = event.alertRuleId.value,
      ownerId          = UUID.fromString(event.ownerId.value),
      targetDataTypeId = event.targetDataTypeId.value,
      value            = event.value.compactPrint,
      pipelineRunId    = event.pipelineRunId,
      severity         = Severity.asString(event.severity),
      state            = AlertEventState.asString(event.state),
      firstFiredAt     = event.firstFiredAt,
      lastEvaluatedAt  = event.lastEvaluatedAt,
      resolvedAt       = event.resolvedAt,
      acknowledgedAt   = event.acknowledgedAt,
      snoozedUntil     = event.snoozedUntil
    )

  /** Owner-scoped list, most-recently-evaluated first. A `stateFilter` of
   *  `Firing` additionally includes `snoozed` rows whose `snoozedUntil` has
   *  passed — the read-time exclusion mechanism design.md's "snooze-expiry
   *  exclusion at read, not a sweep" decision documents. */
  def findAll(ownerId: UserId, stateFilter: Option[AlertEventState]): Future[Vector[AlertEvent]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val base = table.filter(_.ownerId === ownerUuid)
    val filtered = stateFilter match {
      case None =>
        base
      case Some(AlertEventState.Firing) =>
        val now = Instant.now()
        base.filter(r => r.state === "firing" || (r.state === "snoozed" && r.snoozedUntil < now))
      case Some(other) =>
        base.filter(_.state === AlertEventState.asString(other))
    }
    ctx.withUserContext(ownerId.value)(filtered.sortBy(_.lastEvaluatedAt.desc).result)
      .map(_.map(rowToDomain).toVector)
  }

  /** Owner-scoped findById. Returns `None` for a row that exists but belongs
   *  to a different user — existence and authorization are indistinguishable
   *  at the API surface (see CONTRIBUTING.md's ACL triad). */
  def findByIdOwned(id: AlertEventId, user: AuthenticatedUser): Future[Option[AlertEvent]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** Owner-scoped read-transition-persist, all inside one `withUserContext`
   *  transaction so the read and the write can't race a concurrent caller.
   *  `ServiceError.NotFound` for a missing/non-owned row (ACL triad,
   *  existence not leaked); `AlertEventStateMachine.transition`'s `Left` for
   *  an illegal action, unpersisted. */
  def applyTransition(id: AlertEventId, action: AlertEventAction, user: AuthenticatedUser): Future[Either[ServiceError, AlertEvent]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val dbio: DBIO[Either[ServiceError, AlertEvent]] =
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption.flatMap {
        case None =>
          DBIO.successful(Left(ServiceError.NotFound("Alert event not found")))
        case Some(row) =>
          AlertEventStateMachine.transition(rowToDomain(row), action) match {
            case Left(err) =>
              DBIO.successful(Left(err))
            case Right(updated) =>
              updateAction(updated).map(_ => Right(updated))
          }
      }
    ctx.withUserContext(user.id.value)(dbio)
  }

  /** Privileged unscoped read — no ACL check, RLS-bypassing via the
   *  privileged pool.
   *
   *  Reserved for HEL-466's background evaluation engine (post-run path
   *  triggered from `PipelineRunService.onRunSuccess`), which has no
   *  request-bound user. No caller exists yet in this ticket — exercised
   *  only by `AlertEventRepositorySpec`, mirroring
   *  `AlertRuleRepository.listEnabledByDataTypeInternal`'s pre-caller-landing
   *  pattern. The dedup contract guarantees at most one non-resolved row per
   *  rule, so `headOption` is safe. */
  def findActiveByRule(ruleId: AlertRuleId): Future[Option[AlertEvent]] =
    ctx.withSystemContext(
      table.filter(r => r.alertRuleId === ruleId.value && r.state =!= "resolved").result.headOption
    ).map(_.map(rowToDomain))

  /** Privileged de-duplicating upsert — no ACL check, RLS-bypassing via the
   *  privileged pool.
   *
   *  Reserved for HEL-466's background evaluation engine, same justification
   *  as `findActiveByRule` above. Implements the de-duplication contract
   *  (design.md "Dedup / upsert path"): if an active (non-resolved) row
   *  exists for `ruleId`, route it through `AlertEventStateMachine.transition`
   *  with `ReFire` and persist the result unconditionally — the state
   *  machine (not this method) decides whether `state` stays put or flips
   *  `snoozed -> firing`. If no active row exists, insert a new `firing`
   *  row. */
  def upsertFiringInternal(
      ruleId: AlertRuleId,
      ownerId: UserId,
      targetDataTypeId: DataTypeId,
      value: JsValue,
      pipelineRunId: Option[String],
      severity: Severity
  ): Future[AlertEvent] = {
    val dbio: DBIO[AlertEvent] =
      table.filter(r => r.alertRuleId === ruleId.value && r.state =!= "resolved").result.headOption.flatMap {
        case Some(row) =>
          val existing = rowToDomain(row)
          AlertEventStateMachine.transition(existing, AlertEventAction.ReFire(value, severity, pipelineRunId)) match {
            case Right(updated) =>
              updateAction(updated).map(_ => updated)
            case Left(err) =>
              // Unreachable in practice: `transition` accepts ReFire from every
              // active (non-resolved) state (design.md), and `existing` was
              // just selected with `state != 'resolved'`. Fails loudly rather
              // than silently dropping the breach if that invariant ever
              // regresses.
              DBIO.failed(new IllegalStateException(s"upsertFiringInternal: unexpected illegal ReFire transition: ${err.message}"))
          }
        case None =>
          val now = Instant.now()
          val newEvent = AlertEvent(
            id               = AlertEventId(UUID.randomUUID().toString),
            alertRuleId      = ruleId,
            ownerId          = ownerId,
            targetDataTypeId = targetDataTypeId,
            value            = value,
            pipelineRunId    = pipelineRunId,
            severity         = severity,
            state            = AlertEventState.Firing,
            firstFiredAt     = now,
            lastEvaluatedAt  = now,
            resolvedAt       = None,
            acknowledgedAt   = None,
            snoozedUntil     = None
          )
          (table += domainToRow(newEvent)).map(_ => newEvent)
      }
    ctx.withSystemContext(dbio)
  }

  /** Writes every field `transition`/`ReFire` can mutate. Never called with
   *  anything other than the output of `AlertEventStateMachine.transition` —
   *  see design.md's "no raw-field-update bypass anywhere" guarantee. */
  private def updateAction(updated: AlertEvent): DBIO[Int] = {
    val row = domainToRow(updated)
    table
      .filter(_.id === updated.id.value)
      .map(r => (r.value, r.severity, r.pipelineRunId, r.state, r.lastEvaluatedAt, r.resolvedAt, r.acknowledgedAt, r.snoozedUntil))
      .update((row.value, row.severity, row.pipelineRunId, row.state, row.lastEvaluatedAt, row.resolvedAt, row.acknowledgedAt, row.snoozedUntil))
  }
}

object AlertEventRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String <-> PostgreSQL JSONB — identity at the Scala level;
   *  the type exists to mark the JSONB-backed column explicitly (mirrors
   *  `AlertRuleRepository.jsonbStringType`). */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  case class AlertEventRow(
      id: String,
      alertRuleId: String,
      ownerId: UUID,
      targetDataTypeId: String,
      value: String,
      pipelineRunId: Option[String],
      severity: String,
      state: String,
      firstFiredAt: Instant,
      lastEvaluatedAt: Instant,
      resolvedAt: Option[Instant],
      acknowledgedAt: Option[Instant],
      snoozedUntil: Option[Instant]
  )

  class AlertEventTable(tag: Tag) extends Table[AlertEventRow](tag, "alert_events") {
    def id               = column[String]("id", O.PrimaryKey)
    def alertRuleId      = column[String]("alert_rule_id")
    def ownerId          = column[UUID]("owner_id")
    def targetDataTypeId = column[String]("target_data_type_id")
    def value            = column[String]("value")(jsonbStringType)
    def pipelineRunId    = column[Option[String]]("pipeline_run_id")
    def severity         = column[String]("severity")
    def state            = column[String]("state")
    def firstFiredAt     = column[Instant]("first_fired_at")
    def lastEvaluatedAt  = column[Instant]("last_evaluated_at")
    def resolvedAt       = column[Option[Instant]]("resolved_at")
    def acknowledgedAt   = column[Option[Instant]]("acknowledged_at")
    def snoozedUntil     = column[Option[Instant]]("snoozed_until")

    def * = (id, alertRuleId, ownerId, targetDataTypeId, value, pipelineRunId, severity, state,
      firstFiredAt, lastEvaluatedAt, resolvedAt, acknowledgedAt, snoozedUntil).mapTo[AlertEventRow]
  }
}
