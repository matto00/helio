package com.helio.infrastructure

import com.helio.api.protocols.{DashboardAppearancePayload, DashboardLayoutItemPayload, DashboardLayoutPayload, DashboardProtocol, DashboardSnapshotDashboardEntry, DashboardSnapshotPanelEntry, DashboardSnapshotPayload, PanelProtocol}
import com.helio.domain._
import com.helio.domain.panels._
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DashboardRepository(ctx: DbContext)(implicit ec: ExecutionContext)
    extends DashboardProtocol with PanelProtocol {

  import DashboardRepository._

  private val table = TableQuery[DashboardTable]

  private val permTable = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]

  private def panelRowToDomain(row: PanelRepository.PanelRow): Panel =
    PanelRowMapper.rowToDomain(row)

  private def rowToDomain(row: DashboardRow): Dashboard =
    Dashboard(
      id         = DashboardId(row.id),
      name       = row.name,
      meta       = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
      appearance = row.appearance.parseJson.convertTo[DashboardAppearance],
      layout     = row.layout.parseJson.convertTo[DashboardLayout],
      ownerId    = UserId(row.ownerId.toString)
    )

  private def domainToRow(d: Dashboard): DashboardRow =
    DashboardRow(
      id          = d.id.value,
      name        = d.name,
      createdBy   = d.meta.createdBy,
      createdAt   = d.meta.createdAt,
      lastUpdated = d.meta.lastUpdated,
      appearance  = d.appearance.toJson.compactPrint,
      layout      = d.layout.toJson.compactPrint,
      ownerId     = UUID.fromString(d.ownerId.value)
    )

  def findAll(ownerId: UserId): Future[Vector[Dashboard]] =
    ctx.withUserContext(ownerId.value)(
      table.filter(_.ownerId === UUID.fromString(ownerId.value)).sortBy(_.lastUpdated.desc).result
    ).map(_.map(rowToDomain).toVector)

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
          dashboard.appearance.toJson.compactPrint,
          dashboard.layout.toJson.compactPrint
        ))
    ).map(count => if (count > 0) Some(dashboard) else None)

  def updateName(id: DashboardId, name: String, lastUpdated: Instant): Future[Option[Dashboard]] =
    ctx.withSystemContext(
      table
        .filter(_.id === id.value)
        .map(r => (r.name, r.lastUpdated))
        .update((name, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  def delete(id: DashboardId): Future[Boolean] =
    ctx.withSystemContext(table.filter(_.id === id.value).delete).map(_ > 0)

  def count(): Future[Int] =
    ctx.withSystemContext(table.length.result)

  def duplicate(id: DashboardId, ownerId: UserId): Future[Option[(Dashboard, Vector[Panel])]] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]

    val action = table.filter(_.id === id.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(sourceRow) =>
        panelTable.filter(_.dashboardId === id.value).result.flatMap { panelRows =>
          val now        = Instant.now()
          val newDashId  = UUID.randomUUID().toString
          val idMap      = panelRows.map(p => p.id -> UUID.randomUUID().toString).toMap
          val sourceDash = rowToDomain(sourceRow)

          def remapItems(items: Vector[DashboardLayoutItem]): Vector[DashboardLayoutItem] =
            items.flatMap(item => idMap.get(item.panelId.value).map(nid => item.copy(panelId = PanelId(nid))))

          val newLayout = DashboardLayout(
            lg = remapItems(sourceDash.layout.lg),
            md = remapItems(sourceDash.layout.md),
            sm = remapItems(sourceDash.layout.sm),
            xs = remapItems(sourceDash.layout.xs)
          )
          val newDash = Dashboard(
            id         = DashboardId(newDashId),
            name       = s"${sourceDash.name} (copy)",
            meta       = ResourceMeta(ownerId.value, now, now),
            appearance = sourceDash.appearance,
            layout     = newLayout,
            ownerId    = ownerId
          )

          val newPanelRows: Seq[PanelRepository.PanelRow] =
            panelRows.map(p => p.copy(id = idMap(p.id), dashboardId = newDashId, createdAt = now, lastUpdated = now, ownerId = UUID.fromString(ownerId.value)))

          val newPanels = newPanelRows.map(panelRowToDomain).toVector

          (table += domainToRow(newDash))
            .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
            .map(_ => Some((newDash, newPanels)))
        }
    }.transactionally

    ctx.withSystemContext(action)
  }

  def exportSnapshot(id: DashboardId): Future[Option[DashboardSnapshotPayload]] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]

    val action = table.filter(_.id === id.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(sourceRow) =>
        panelTable.filter(_.dashboardId === id.value).result.map { panelRows =>
          val sourceDash = rowToDomain(sourceRow)

          def layoutItemToSnapshot(item: DashboardLayoutItem): DashboardLayoutItemPayload =
            DashboardLayoutItemPayload(
              panelId = item.panelId.value,
              x = item.x,
              y = item.y,
              w = item.w,
              h = item.h
            )

          val snapshotLayout = DashboardLayoutPayload(
            lg = sourceDash.layout.lg.map(layoutItemToSnapshot),
            md = sourceDash.layout.md.map(layoutItemToSnapshot),
            sm = sourceDash.layout.sm.map(layoutItemToSnapshot),
            xs = sourceDash.layout.xs.map(layoutItemToSnapshot)
          )

          val snapshotPanels = panelRows.toVector.map { p =>
            DashboardSnapshotPanelEntry.fromDomain(panelRowToDomain(p))
          }

          val snapshotDashboard = DashboardSnapshotDashboardEntry(
            name       = sourceDash.name,
            appearance = DashboardAppearancePayload(
              background     = Some(sourceDash.appearance.background),
              gridBackground = Some(sourceDash.appearance.gridBackground)
            ),
            layout = snapshotLayout
          )

          Some(DashboardSnapshotPayload(
            version   = DashboardSnapshotPayload.CurrentVersion,
            dashboard = snapshotDashboard,
            panels    = snapshotPanels
          ))
        }
    }

    ctx.withSystemContext(action)
  }

  def importSnapshot(payload: DashboardSnapshotPayload, ownerId: UserId): Future[(Dashboard, Vector[Panel])] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]

    val now       = Instant.now()
    val newDashId = UUID.randomUUID().toString
    val idMap     = payload.panels.map(p => p.snapshotId -> UUID.randomUUID().toString).toMap

    def remapLayoutItem(item: DashboardLayoutItemPayload): Option[DashboardLayoutItem] =
      idMap.get(item.panelId).map(nid =>
        DashboardLayoutItem(panelId = PanelId(nid), x = item.x, y = item.y, w = item.w, h = item.h)
      )

    val newLayout = DashboardLayout(
      lg = payload.dashboard.layout.lg.flatMap(remapLayoutItem),
      md = payload.dashboard.layout.md.flatMap(remapLayoutItem),
      sm = payload.dashboard.layout.sm.flatMap(remapLayoutItem),
      xs = payload.dashboard.layout.xs.flatMap(remapLayoutItem)
    )

    val newDash = Dashboard(
      id         = DashboardId(newDashId),
      name       = payload.dashboard.name,
      meta       = ResourceMeta(ownerId.value, now, now),
      appearance = DashboardAppearance(
        background     = payload.dashboard.appearance.background.getOrElse(DashboardAppearance.Default.background),
        gridBackground = payload.dashboard.appearance.gridBackground.getOrElse(DashboardAppearance.Default.gridBackground)
      ),
      layout  = newLayout,
      ownerId = ownerId
    )

    // CS2c-3c: reconstruct each panel's typed config from the wire `(type, config)`
    // payload via the per-subtype tolerant create-decoder, then build the domain
    // Panel and persist via PanelRowMapper.domainToRow. The pre-CS2c-3c "flat
    // entry fields → row columns" path is gone (snapshot wire shape changed).
    val newPanels: Vector[Panel] = payload.panels.map { entry =>
      val panelId   = PanelId(idMap(entry.snapshotId))
      val dashId    = DashboardId(newDashId)
      val meta      = ResourceMeta(ownerId.value, now, now)
      val appearance = PanelAppearance(
        background   = entry.appearance.background.getOrElse(PanelAppearance.Default.background),
        color        = entry.appearance.color.getOrElse(PanelAppearance.Default.color),
        transparency = entry.appearance.transparency.getOrElse(PanelAppearance.Default.transparency),
        chart        = entry.appearance.chart
      )
      val created = PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry.config)) match {
        case Right(c) => c
        case Left(err) => throw new IllegalArgumentException(s"snapshot panel '${entry.snapshotId}' invalid config: $err")
      }
      created match {
        case PanelConfigCodec.MetricCreate(c)   => MetricPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.ChartCreate(c)    => ChartPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.TableCreate(c)    => TablePanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.TextCreate(c)     => TextPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.MarkdownCreate(c) => MarkdownPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.ImageCreate(c)    => ImagePanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.DividerCreate(c)  => DividerPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
      }
    }

    val newPanelRows: Vector[PanelRepository.PanelRow] = newPanels.map(PanelRowMapper.domainToRow)

    val action = (
      (table += domainToRow(newDash))
        .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
        .map(_ => (newDash, newPanels))
    ).transactionally

    ctx.withSystemContext(action)
  }
}

object DashboardRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String ↔ PostgreSQL JSONB. The PostgreSQL JDBC driver accepts
   *  setString / getString for JSONB columns, so the conversion is identity at
   *  the Scala level; the type exists to mark JSONB-backed columns explicitly
   *  in table definitions. */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  case class DashboardRow(
      id: String,
      name: String,
      createdBy: String,
      createdAt: Instant,
      lastUpdated: Instant,
      appearance: String,
      layout: String,
      ownerId: UUID
  )

  class DashboardTable(tag: Tag) extends Table[DashboardRow](tag, "dashboards") {
    def id          = column[String]("id", O.PrimaryKey)
    def name        = column[String]("name")
    def createdBy   = column[String]("created_by")
    def createdAt   = column[Instant]("created_at")
    def lastUpdated = column[Instant]("last_updated")
    def appearance  = column[String]("appearance")(jsonbStringType)
    def layout      = column[String]("layout")(jsonbStringType)
    def ownerId     = column[UUID]("owner_id")

    def * = (id, name, createdBy, createdAt, lastUpdated, appearance, layout, ownerId).mapTo[DashboardRow]
  }
}
