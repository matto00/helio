package com.helio.infrastructure

import com.helio.api.protocols.MetricProtocol
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for the `metrics` table (HEL-446 — data-layer
 *  foundation for the Semantic/Metric Layer epic, HEL-418; `MetricService`/
 *  `MetricRoutes`, HEL-493, are the CRUD service + REST layer on top). Mirrors
 *  `DataTypeRepository`/`AlertRuleRepository` conventions: `withUserContext`
 *  for owner-scoped reads/writes, a privileged `withSystemContext` variant
 *  for internal callers, `allowed_dimensions` and `format` mapped to JSONB
 *  columns.
 *
 *  `aggregation` is validated against `MetricAggregation.values` here, at the
 *  insert/update boundary (design.md Decision 1) — the domain case class
 *  keeps `aggregation` as a raw `String`. */
class MetricRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import MetricRepository._

  private val table      = TableQuery[MetricTable]
  private val panelTable = TableQuery[PanelRepository.PanelTable]
  private val dashTable  = TableQuery[DashboardRepository.DashboardTable]

  private def rowToDomain(row: MetricRow): MetricDefinition =
    MetricDefinition(
      id                = MetricId(row.id),
      ownerId           = UserId(row.ownerId.toString),
      dataTypeId        = DataTypeId(row.dataTypeId),
      name              = row.name,
      description       = row.description,
      measureField      = row.measureField,
      aggregation       = row.aggregation,
      allowedDimensions = row.allowedDimensions,
      format            = row.format,
      deprecated        = row.deprecated,
      createdAt         = row.createdAt,
      updatedAt         = row.updatedAt
    )

  private def domainToRow(m: MetricDefinition): MetricRow =
    MetricRow(
      id                = m.id.value,
      ownerId           = UUID.fromString(m.ownerId.value),
      dataTypeId        = m.dataTypeId.value,
      name              = m.name,
      description       = m.description,
      measureField      = m.measureField,
      aggregation       = m.aggregation,
      allowedDimensions = m.allowedDimensions,
      format            = m.format,
      deprecated        = m.deprecated,
      createdAt         = m.createdAt,
      updatedAt         = m.updatedAt
    )

  /** Insert a new metric row in user context, after validating `aggregation`
   *  against the allow-list. The V75 RLS policy on `metrics` evaluates
   *  `owner_id` against `app.current_user_id`; the row's `ownerId` must equal
   *  `user.id` — callers build the `MetricDefinition` with the correct
   *  `ownerId` before calling this. */
  def insert(m: MetricDefinition, user: AuthenticatedUser): Future[Either[String, MetricDefinition]] =
    MetricAggregation.validate(m.aggregation) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        ctx.withUserContext(user.id.value)(table += domainToRow(m)).map(_ => Right(m))
    }

  /** Owner-scoped findById. Returns `None` for a row that exists but belongs
   *  to a different user — existence and authorization are indistinguishable
   *  at the API surface (see CONTRIBUTING.md's ACL triad). */
  def findByIdOwned(id: MetricId, user: AuthenticatedUser): Future[Option[MetricDefinition]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** Batch owner-scoped lookup -- fetches all metrics in `ids` owned by
   *  `user` in a single `WHERE id IN (...) AND owner_id = ?` query. Mirrors
   *  `DataTypeRepository.findByIdsOwned` exactly (HEL-500 design.md D3) —
   *  supports the panel read path resolving many panels' `metricId`
   *  bindings in one round trip.
   *
   *  Returns a `Map[MetricId, MetricDefinition]` for O(1) per-panel
   *  resolution. Short-circuits immediately with an empty Map when `ids` is
   *  empty. */
  def findByIdsOwned(ids: Seq[MetricId], user: AuthenticatedUser): Future[Map[MetricId, MetricDefinition]] =
    if (ids.isEmpty) Future.successful(Map.empty)
    else {
      val idSet     = ids.map(_.value).toSet
      val ownerUuid = UUID.fromString(user.id.value)
      ctx.withUserContext(user.id.value)(
        table.filter(r => (r.id inSet idSet) && r.ownerId === ownerUuid).result
      ).map(_.map(rowToDomain).map(m => m.id -> m).toMap)
    }

  /** Owner-scoped list, most-recently-created first. */
  def listByOwner(user: AuthenticatedUser): Future[Vector[MetricDefinition]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain).toVector)
  }

  /** Owner-scoped, paginated list — DB-level `count` + `drop`/`take`,
   *  mirroring `DataTypeRepository.findAll` (HEL-493 design.md Decision 1).
   *  Added for the `/api/metrics` list endpoint's `PagedResult` envelope;
   *  `listByOwner` (above) stays unpaginated for its existing callers/tests. */
  def findAll(ownerId: UserId, page: Page): Future[PagedResult[MetricDefinition]] = {
    val ownerUuid  = UUID.fromString(ownerId.value)
    val baseQuery  = table.filter(_.ownerId === ownerUuid)
    val countAction = baseQuery.length.result
    val sliceAction = baseQuery.sortBy(_.createdAt.desc).drop(page.offset).take(page.limit).result
    ctx.withUserContext(ownerId.value)(
      for {
        total <- countAction
        rows  <- sliceAction
      } yield PagedResult(rows.map(rowToDomain).toVector, total, page.offset, page.limit)
    )
  }

  /** Update mutable fields in user context, after validating `aggregation`
   *  against the allow-list. The V75 RLS USING clause restricts this update
   *  to rows owned by the caller, backstopping any future service-layer ACL
   *  check. */
  def update(m: MetricDefinition, user: AuthenticatedUser): Future[Either[String, Option[MetricDefinition]]] =
    MetricAggregation.validate(m.aggregation) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        val row = domainToRow(m)
        val action = table
          .filter(_.id === m.id.value)
          .map(r => (r.name, r.description, r.measureField, r.aggregation, r.allowedDimensions, r.format, r.deprecated, r.updatedAt))
          .update((row.name, row.description, row.measureField, row.aggregation, row.allowedDimensions, row.format, row.deprecated, row.updatedAt))
          .andThen(table.filter(_.id === m.id.value).result.headOption)
          .map(_.map(rowToDomain))
        ctx.withUserContext(user.id.value)(action).map(Right(_))
    }

  /** Delete a metric row in user context. The V75 RLS USING clause restricts
   *  this DELETE to rows owned by the caller. */
  def delete(id: MetricId, user: AuthenticatedUser): Future[Boolean] =
    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).delete).map(_ > 0)

  /** Privileged unscoped read — no ACL check, RLS-bypassing via the
   *  privileged pool.
   *
   *  Reserved for the future service layer (418-B) to resolve a metric's
   *  owner before an ACL check, mirroring `DataTypeRepository.findByIdInternal`.
   *  No caller exists yet in this ticket — exercised only by
   *  `MetricRepositorySpec` until a real callsite lands. */
  def findByIdInternal(id: MetricId): Future[Option[MetricDefinition]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** Owner-scoped "where used" query (HEL-560 design.md D1): every panel
   *  owned by `user` whose `metricId` currently references `id`, joined to
   *  its owning dashboard for `dashboardName` — mirrors
   *  `PanelRepository.findById`'s panel↔dashboard join shape and
   *  `DataTypeRepository.existsBoundToAnyOwnedPanel`'s owner-scoping (the
   *  panel's own `owner_id`, not a sharing-aware ACL — matches every other
   *  per-id metric route's `findByIdOwned`-first semantics). Used by both the
   *  `/usage` route (tasks.md 1.1/1.2) and `MetricService.delete`'s
   *  pre-delete count (tasks.md 1.4, via [[countBoundPanels]]). */
  def usage(id: MetricId, user: AuthenticatedUser): Future[Vector[MetricUsagePanel]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val q = for {
      panel <- panelTable if panel.metricId === id.value && panel.ownerId === ownerUuid
      dash  <- dashTable if dash.id === panel.dashboardId
    } yield (panel.id, panel.title, dash.id, dash.name)
    ctx.withUserContext(user.id.value)(q.result).map(_.map {
      case (panelId, panelTitle, dashboardId, dashboardName) =>
        MetricUsagePanel(PanelId(panelId), panelTitle, DashboardId(dashboardId), dashboardName)
    }.toVector)
  }

  /** Row count underlying [[usage]] — `MetricService.delete` only needs the
   *  count, not the full panel list, so this avoids building the response
   *  DTO for a value it discards. */
  def countBoundPanels(id: MetricId, user: AuthenticatedUser): Future[Int] =
    usage(id, user).map(_.size)
}

object MetricRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  // Bring MetricFormat's Spray JSON formatter into scope.
  private val proto = new MetricProtocol {}
  import proto._

  implicit val allowedDimensionsColumnType: BaseColumnType[Vector[String]] =
    MappedColumnType.base[Vector[String], String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[Vector[String]]
    )

  implicit val metricFormatColumnType: BaseColumnType[MetricFormat] =
    MappedColumnType.base[MetricFormat, String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[MetricFormat]
    )

  case class MetricRow(
      id: String,
      ownerId: UUID,
      dataTypeId: String,
      name: String,
      description: Option[String],
      measureField: String,
      aggregation: String,
      allowedDimensions: Vector[String],
      format: MetricFormat,
      deprecated: Boolean,
      createdAt: Instant,
      updatedAt: Instant
  )

  class MetricTable(tag: Tag) extends Table[MetricRow](tag, "metrics") {
    def id                = column[String]("id", O.PrimaryKey)
    def ownerId           = column[UUID]("owner_id")
    def dataTypeId        = column[String]("data_type_id")
    def name              = column[String]("name")
    def description       = column[Option[String]]("description")
    def measureField      = column[String]("measure_field")
    def aggregation       = column[String]("aggregation")
    def allowedDimensions = column[Vector[String]]("allowed_dimensions")
    def format            = column[MetricFormat]("format")
    def deprecated        = column[Boolean]("deprecated")
    def createdAt         = column[Instant]("created_at")
    def updatedAt         = column[Instant]("updated_at")

    def * = (id, ownerId, dataTypeId, name, description, measureField, aggregation, allowedDimensions, format, deprecated, createdAt, updatedAt)
      .mapTo[MetricRow]
  }
}
