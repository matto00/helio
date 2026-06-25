package com.helio.infrastructure

import com.helio.api.protocols.{DashboardProtocol, PanelProtocol}
import com.helio.domain._
import com.helio.domain.panels._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DashboardRepository(protected val ctx: DbContext)(implicit protected val ec: ExecutionContext)
    extends DashboardProtocol with PanelProtocol with DashboardSnapshotOps {

  import DashboardRepository._

  protected val table = TableQuery[DashboardTable]

  protected val permTable = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]

  protected def panelRowToDomain(row: PanelRepository.PanelRow): Panel =
    PanelRowMapper.rowToDomain(row)

  protected def rowToDomain(row: DashboardRow): Dashboard =
    Dashboard(
      id         = DashboardId(row.id),
      name       = row.name,
      meta       = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
      appearance = row.appearance,
      layout     = row.layout,
      ownerId    = UserId(row.ownerId.toString)
    )

  protected def domainToRow(d: Dashboard): DashboardRow =
    DashboardRow(
      id          = d.id.value,
      name        = d.name,
      createdBy   = d.meta.createdBy,
      createdAt   = d.meta.createdAt,
      lastUpdated = d.meta.lastUpdated,
      appearance  = d.appearance,
      layout      = d.layout,
      ownerId     = UUID.fromString(d.ownerId.value)
    )

  def findAll(ownerId: UserId, page: Page): Future[PagedResult[Dashboard]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val baseQuery = table.filter(_.ownerId === ownerUuid)
    val countAction = baseQuery.length.result
    val sliceAction = baseQuery.sortBy(_.lastUpdated.desc).drop(page.offset).take(page.limit).result
    ctx.withUserContext(ownerId.value)(
      for {
        total <- countAction
        rows  <- sliceAction
      } yield PagedResult(rows.map(rowToDomain).toVector, total, page.offset, page.limit)
    )
  }

  /** Sharing-aware read. Returns Some if:
   *  - `callerOpt` is Some and the caller is the owner,
   *  - `callerOpt` is Some and the caller has an editor/viewer grant, or
   *  - `callerOpt` is None and a public-viewer grant exists (anonymous path).
   *  Returns None for all other cases (no existence leak). */
  def findById(id: DashboardId, callerOpt: Option[AuthenticatedUser]): Future[Option[Dashboard]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption).flatMap {
      case None => Future.successful(None)
      case Some(row) =>
        val ownerId = row.ownerId.toString
        callerOpt match {
          case Some(caller) if caller.id.value == ownerId =>
            Future.successful(Some(rowToDomain(row)))

          case Some(caller) =>
            ctx.withUserContext(caller.id.value)(
              permTable
                .filter(p =>
                  p.resourceType === "dashboard" &&
                  p.resourceId   === id.value    &&
                  p.granteeId    === UUID.fromString(caller.id.value)
                )
                .exists
                .result
            ).map(hasGrant => if (hasGrant) Some(rowToDomain(row)) else None)

          case None =>
            // Public-viewer fallback: anonymous request — return only if public grant exists.
            ctx.withSystemContext(
              permTable
                .filter(p =>
                  p.resourceType === "dashboard" &&
                  p.resourceId   === id.value    &&
                  p.granteeId.isEmpty            &&
                  p.role         === "viewer"
                )
                .exists
                .result
            ).map(hasPublic => if (hasPublic) Some(rowToDomain(row)) else None)
        }
    }

  /** Owner-only read. Used for delete / duplicate where only the owner is
   *  authorised regardless of any sharing grants (design.md Q1 table). */
  def findByIdOwned(id: DashboardId, user: AuthenticatedUser): Future[Option[Dashboard]] =
    ctx.withUserContext(user.id.value)(
      table
        .filter(d => d.id === id.value && d.ownerId === UUID.fromString(user.id.value))
        .result
        .headOption
    ).map(_.map(rowToDomain))

  /** No-ACL read for the ResourceTypeRegistry owner-resolver and other
   *  privileged internal callers only. Do not use from routes or services. */
  def findByIdInternal(id: DashboardId): Future[Option[Dashboard]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** Sharing-aware list. Returns dashboards owned by the user OR where the
   *  user has an explicit grant.
   *
   *  NOT wired to any UI route in this PR — feature-flagged off.
   *  Exists for future "shared with me" list support. */
  def findAllVisible(user: AuthenticatedUser): Future[Vector[Dashboard]] = {
    val userId = UUID.fromString(user.id.value)
    val owned = table.filter(_.ownerId === userId)
    val granted = for {
      perm <- permTable if perm.resourceType === "dashboard" && perm.granteeId === userId
      dash <- table if dash.id === perm.resourceId
    } yield dash
    ctx.withUserContext(user.id.value)((owned union granted).sortBy(_.lastUpdated.desc).result)
      .map(_.map(rowToDomain).toVector)
  }

  def insert(dashboard: Dashboard): Future[Dashboard] =
    ctx.withUserContext(dashboard.ownerId.value)(table += domainToRow(dashboard))
      .map(_ => dashboard)

  def update(dashboard: Dashboard): Future[Option[Dashboard]] =
    ctx.withUserContext(dashboard.ownerId.value)(
      table
        .filter(_.id === dashboard.id.value)
        .map(r => (r.name, r.lastUpdated, r.appearance, r.layout))
        .update((
          dashboard.name,
          dashboard.meta.lastUpdated,
          dashboard.appearance,
          dashboard.layout
        ))
    ).map(count => if (count > 0) Some(dashboard) else None)

  /** Privileged update: uses withSystemContext because the caller (DashboardService)
   *  has already validated ownership before reaching this method. The V36 RLS
   *  UPDATE policy (owner OR editor grantee) would also permit this, but the
   *  service always confirms ownership first — withSystemContext is kept to
   *  avoid a redundant DB round-trip for the policy predicate. */
  def updateName(id: DashboardId, name: String, lastUpdated: Instant): Future[Option[Dashboard]] =
    ctx.withSystemContext(
      table
        .filter(_.id === id.value)
        .map(r => (r.name, r.lastUpdated))
        .update((name, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  /** Privileged delete: uses withSystemContext because DashboardService has
   *  confirmed ownership via findByIdOwned before calling this. The V36 RLS
   *  DELETE policy (owner only) would enforce the same rule on the app pool,
   *  but withSystemContext avoids the extra policy predicate evaluation. */
  def delete(id: DashboardId): Future[Boolean] =
    ctx.withSystemContext(table.filter(_.id === id.value).delete).map(_ > 0)

  /** Boot-time empty check for DemoData seeding — no user context available.
   *  Correctly privileged: this is a system-startup path. */
  def count(): Future[Int] =
    ctx.withSystemContext(table.length.result)
}

object DashboardRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  // Bring DashboardAppearance / DashboardLayout Spray JSON formatters into scope.
  private val proto = new DashboardProtocol {}
  import proto._

  implicit val dashboardAppearanceColumnType: BaseColumnType[DashboardAppearance] =
    MappedColumnType.base[DashboardAppearance, String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[DashboardAppearance]
    )

  implicit val dashboardLayoutColumnType: BaseColumnType[DashboardLayout] =
    MappedColumnType.base[DashboardLayout, String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[DashboardLayout]
    )

  case class DashboardRow(
      id: String,
      name: String,
      createdBy: String,
      createdAt: Instant,
      lastUpdated: Instant,
      appearance: DashboardAppearance,
      layout: DashboardLayout,
      ownerId: UUID
  )

  class DashboardTable(tag: Tag) extends Table[DashboardRow](tag, "dashboards") {
    def id          = column[String]("id", O.PrimaryKey)
    def name        = column[String]("name")
    def createdBy   = column[String]("created_by")
    def createdAt   = column[Instant]("created_at")
    def lastUpdated = column[Instant]("last_updated")
    def appearance  = column[DashboardAppearance]("appearance")
    def layout      = column[DashboardLayout]("layout")
    def ownerId     = column[UUID]("owner_id")

    def * = (id, name, createdBy, createdAt, lastUpdated, appearance, layout, ownerId).mapTo[DashboardRow]
  }
}
