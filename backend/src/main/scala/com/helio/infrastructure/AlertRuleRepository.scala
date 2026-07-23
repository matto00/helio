package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for `/api/alert-rules`. `condition` is
 *  stored as JSONB, mapped opaquely to a `String` at the Slick layer (see
 *  `jsonbStringType`) and parsed to/from `JsValue` at the domain boundary —
 *  the same pattern `DataSourceRepository.config` uses for its jsonb column.
 *  This keeps unknown/extra keys inside `condition` surviving a round-trip
 *  unchanged, since the repository never destructures the blob. */
class AlertRuleRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AlertRuleRepository._

  private val table = TableQuery[AlertRuleTable]

  private def rowToDomain(row: AlertRuleRow): AlertRule =
    AlertRule(
      id               = AlertRuleId(row.id),
      ownerId          = UserId(row.ownerId.toString),
      targetDataTypeId = DataTypeId(row.targetDataTypeId),
      metric           = row.metric,
      condition        = row.condition.parseJson,
      name             = row.name,
      enabled          = row.enabled,
      severity         = Severity.fromString(row.severity)
        .getOrElse(throw new IllegalStateException(s"Unknown severity in DB: '${row.severity}'")),
      createdAt        = row.createdAt,
      updatedAt        = row.updatedAt
    )

  private def domainToRow(rule: AlertRule): AlertRuleRow =
    AlertRuleRow(
      id               = rule.id.value,
      ownerId          = UUID.fromString(rule.ownerId.value),
      targetDataTypeId = rule.targetDataTypeId.value,
      metric           = rule.metric,
      condition        = rule.condition.compactPrint,
      name             = rule.name,
      enabled          = rule.enabled,
      severity         = Severity.asString(rule.severity),
      createdAt        = rule.createdAt,
      updatedAt        = rule.updatedAt
    )

  /** Owner-scoped list, most-recently-created first. */
  def findAll(ownerId: UserId): Future[Vector[AlertRule]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    ctx.withUserContext(ownerId.value)(
      table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain).toVector)
  }

  /** Owner-scoped findById. Returns `None` for a row that exists but belongs
   *  to a different user — existence and authorization are indistinguishable
   *  at the API surface (see CONTRIBUTING.md's ACL triad). */
  def findByIdOwned(id: AlertRuleId, user: AuthenticatedUser): Future[Option[AlertRule]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** Insert a new alert rule row in user context. The V60 RLS policy on
   *  `alert_rules` evaluates `owner_id` against `app.current_user_id`; the
   *  row's `ownerId` must equal `user.id` — callers build the `AlertRule`
   *  with the correct `ownerId` before calling this. */
  def insert(rule: AlertRule, user: AuthenticatedUser): Future[AlertRule] =
    ctx.withUserContext(user.id.value)(table += domainToRow(rule)).map(_ => rule)

  /** Update mutable fields (metric/condition/name/enabled/severity/updatedAt)
   *  in user context. The V60 RLS USING clause restricts this update to rows
   *  owned by the caller, backstopping the app-layer ACL check performed by
   *  `AlertRuleService` before this call. */
  def update(rule: AlertRule, user: AuthenticatedUser): Future[Option[AlertRule]] = {
    val row = domainToRow(rule)
    val action = table
      .filter(_.id === rule.id.value)
      .map(r => (r.metric, r.condition, r.name, r.enabled, r.severity, r.updatedAt))
      .update((row.metric, row.condition, row.name, row.enabled, row.severity, row.updatedAt))
      .andThen(table.filter(_.id === rule.id.value).result.headOption)
      .map(_.map(rowToDomain))
    ctx.withUserContext(user.id.value)(action)
  }

  /** Delete an alert rule row in user context. The V60 RLS USING clause
   *  restricts this DELETE to rows owned by the caller, adding a DB-layer
   *  backstop to the app-layer ACL check performed before this call. */
  def delete(id: AlertRuleId, user: AuthenticatedUser): Future[Boolean] =
    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).delete).map(_ > 0)

  /** Privileged unscoped read — no ACL check, RLS-bypassing via the
   *  privileged pool.
   *
   *  Reserved for HEL-455's background evaluation engine: a post-run path
   *  (triggered from `PipelineRunService.onRunSuccess`) that has no
   *  request-bound user and must see enabled rules across every owner
   *  targeting the given DataType. No caller exists yet in this ticket —
   *  it is exercised only by `AlertRuleRepositorySpec` until HEL-455 wires a
   *  real callsite, mirroring `DataTypeRepository.findByIdInternal`'s
   *  pre-caller landing pattern. */
  def listEnabledByDataTypeInternal(dataTypeId: DataTypeId): Future[Vector[AlertRule]] =
    ctx.withSystemContext(
      table.filter(r => r.targetDataTypeId === dataTypeId.value && r.enabled === true).result
    ).map(_.map(rowToDomain).toVector)
}

object AlertRuleRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String <-> PostgreSQL JSONB — identity at the Scala level;
   *  the type exists to mark the JSONB-backed column explicitly (mirrors
   *  `DataSourceRepository.jsonbStringType`). */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  case class AlertRuleRow(
      id: String,
      ownerId: UUID,
      targetDataTypeId: String,
      metric: String,
      condition: String,
      name: String,
      enabled: Boolean,
      severity: String,
      createdAt: Instant,
      updatedAt: Instant
  )

  class AlertRuleTable(tag: Tag) extends Table[AlertRuleRow](tag, "alert_rules") {
    def id               = column[String]("id", O.PrimaryKey)
    def ownerId          = column[UUID]("owner_id")
    def targetDataTypeId = column[String]("target_data_type_id")
    def metric           = column[String]("metric")
    def condition        = column[String]("condition")(jsonbStringType)
    def name             = column[String]("name")
    def enabled          = column[Boolean]("enabled")
    def severity         = column[String]("severity")
    def createdAt        = column[Instant]("created_at")
    def updatedAt        = column[Instant]("updated_at")

    def * = (id, ownerId, targetDataTypeId, metric, condition, name, enabled, severity, createdAt, updatedAt)
      .mapTo[AlertRuleRow]
  }
}
