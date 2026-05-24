package com.helio.infrastructure

import com.helio.api.protocols.{PanelBatchItem, PanelProtocol}
import com.helio.domain._
import com.helio.domain.panels._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PanelRepository(ctx: DbContext)(implicit ec: ExecutionContext)
    extends PanelProtocol {

  import PanelRepository._

  private val table     = TableQuery[PanelTable]
  private val dashTable = TableQuery[DashboardRepository.DashboardTable]
  private val permTable = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]

  private def rowToDomain(row: PanelRow): Panel =
    PanelRowMapper.rowToDomain(row)

  private def domainToRow(p: Panel): PanelRow =
    PanelRowMapper.domainToRow(p)

  /** Sharing-aware list. Returns panels for the dashboard only when the caller
   *  has access (owner, grantee, or anonymous with a public-viewer grant).
   *  Used by `PublicDashboardRoutes` — replaces the old unscoped
   *  `findByDashboardId`. */
  def findAllByDashboardId(dashboardId: DashboardId, callerOpt: Option[AuthenticatedUser]): Future[Vector[Panel]] =
    dashTable.filter(_.id === dashboardId.value).result.headOption pipe { q =>
      ctx.withSystemContext(q).flatMap {
        case None => Future.successful(Vector.empty)
        case Some(dashRow) =>
          val ownerId = dashRow.ownerId.toString
          callerOpt match {
            case Some(caller) if caller.id.value == ownerId =>
              ctx.withUserContext(caller.id.value)(
                table.filter(_.dashboardId === dashboardId.value).sortBy(_.lastUpdated.desc).result
              ).map(_.map(rowToDomain).toVector)

            case Some(caller) =>
              ctx.withUserContext(caller.id.value)(
                permTable
                  .filter(p =>
                    p.resourceType === "dashboard" &&
                    p.resourceId   === dashboardId.value &&
                    p.granteeId    === UUID.fromString(caller.id.value)
                  )
                  .exists
                  .result
              ).flatMap { hasGrant =>
                if (hasGrant)
                  ctx.withUserContext(caller.id.value)(
                    table.filter(_.dashboardId === dashboardId.value).sortBy(_.lastUpdated.desc).result
                  ).map(_.map(rowToDomain).toVector)
                else
                  Future.successful(Vector.empty)
              }

            case None =>
              // Public-viewer fallback: anonymous caller.
              ctx.withSystemContext(
                permTable
                  .filter(p =>
                    p.resourceType === "dashboard" &&
                    p.resourceId   === dashboardId.value &&
                    p.granteeId.isEmpty &&
                    p.role         === "viewer"
                  )
                  .exists
                  .result
              ).flatMap { hasPublic =>
                if (hasPublic)
                  ctx.withSystemContext(
                    table.filter(_.dashboardId === dashboardId.value).sortBy(_.lastUpdated.desc).result
                  ).map(_.map(rowToDomain).toVector)
                else
                  Future.successful(Vector.empty)
              }
          }
      }
    }

  /** No-ACL read. Documented callers:
   *  - `ResourceTypeRegistry` owner-resolver (privileged; resolves ownership for ACL check)
   *  - `PanelService.batchUpdate` (parent dashboard ACL is the authoritative gate there)
   *  Do NOT call from routes or services that own the ACL decision. */
  def findByIdInternal(id: PanelId): Future[Option[Panel]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** Sharing-aware read. Returns Some when the caller is the panel's parent
   *  dashboard's owner, has an explicit grant on that dashboard, or (when
   *  `callerOpt = None`) a public-viewer grant exists on the dashboard.
   *  Returns None otherwise — no existence leak. */
  def findById(id: PanelId, callerOpt: Option[AuthenticatedUser]): Future[Option[Panel]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption).flatMap {
      case None => Future.successful(None)
      case Some(panelRow) =>
        val dashId = panelRow.dashboardId
        ctx.withSystemContext(dashTable.filter(_.id === dashId).result.headOption).flatMap {
          case None => Future.successful(None)  // orphaned panel — treat as not found
          case Some(dashRow) =>
            val ownerId = dashRow.ownerId.toString
            callerOpt match {
              case Some(caller) if caller.id.value == ownerId =>
                Future.successful(Some(rowToDomain(panelRow)))

              case Some(caller) =>
                ctx.withUserContext(caller.id.value)(
                  permTable
                    .filter(p =>
                      p.resourceType === "dashboard" &&
                      p.resourceId   === dashId      &&
                      p.granteeId    === UUID.fromString(caller.id.value)
                    )
                    .exists
                    .result
                ).map(hasGrant => if (hasGrant) Some(rowToDomain(panelRow)) else None)

              case None =>
                ctx.withSystemContext(
                  permTable
                    .filter(p =>
                      p.resourceType === "dashboard" &&
                      p.resourceId   === dashId      &&
                      p.granteeId.isEmpty            &&
                      p.role         === "viewer"
                    )
                    .exists
                    .result
                ).map(hasPublic => if (hasPublic) Some(rowToDomain(panelRow)) else None)
            }
        }
    }

  def insert(panel: Panel): Future[Panel] =
    ctx.withUserContext(panel.ownerId.value)(table += domainToRow(panel))
      .map(_ => panel)

  /** Privileged update: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. The V36 RLS UPDATE policy (dashboard ACL)
   *  would also permit this, but withSystemContext avoids the extra predicate. */
  def updateTitle(id: PanelId, title: String, lastUpdated: Instant): Future[Option[Panel]] =
    ctx.withSystemContext(
      table
        .filter(_.id === id.value)
        .map(r => (r.title, r.lastUpdated))
        .update((title, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  /** Privileged delete: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. The V36 RLS DELETE policy (owner's dashboard
   *  only) would enforce the same rule on the app pool. */
  def delete(id: PanelId): Future[Boolean] =
    ctx.withSystemContext(table.filter(_.id === id.value).delete).map(_ > 0)

  /** Privileged duplicate: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. New row is inserted with the calling user's
   *  ownerId so V36 RLS policies apply to it correctly after insertion. */
  def duplicate(id: PanelId, ownerId: UserId): Future[Option[Panel]] = {
    val copyTitleRegex = """^(.*)\s+\(copy(?:\s+(\d+))?\)$""".r

    def baseTitle(title: String): String = title match {
      case copyTitleRegex(base, _) => base
      case _                       => title
    }

    def nextCopyTitle(base: String, existingTitles: Seq[String]): String = {
      val usedNumbers = existingTitles.collect {
        case t if t == s"$base (copy)"                      => 1
        case copyTitleRegex(b, n) if b == base && n != null => n.toInt
      }.toSet
      val n = Iterator.from(1).dropWhile(usedNumbers.contains).next()
      if (n == 1) s"$base (copy)" else s"$base (copy $n)"
    }

    val action = table.filter(_.id === id.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(source) =>
        val base = baseTitle(source.title)
        table
          .filter(_.dashboardId === source.dashboardId)
          .map(_.title)
          .result
          .flatMap { existingTitles =>
            val now    = Instant.now()
            val newRow = source.copy(
              id          = UUID.randomUUID().toString,
              title       = nextCopyTitle(base, existingTitles),
              createdAt   = now,
              lastUpdated = now,
              ownerId     = UUID.fromString(ownerId.value)
            )
            (table += newRow).map(_ => Some(rowToDomain(newRow)))
          }
    }.transactionally

    ctx.withSystemContext(action)
  }

  /** Privileged appearance update: uses withSystemContext because PanelService
   *  has confirmed ownership before calling this. The V36 RLS UPDATE policy
   *  (dashboard ACL) would also permit this on the app pool. */
  def updateAppearance(id: PanelId, appearance: PanelAppearance, lastUpdated: Instant): Future[Option[Panel]] =
    ctx.withSystemContext(
      table
        .filter(_.id === id.value)
        .map(r => (r.appearance, r.lastUpdated))
        .update((appearance.toJson.compactPrint, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  /** Persist the typed config of the supplied panel — writes every config
   *  column derived from the panel's subtype, leaving identity / metadata
   *  columns (title, appearance, type) untouched except for `lastUpdated`.
   *
   *  Used by `PanelPatchApplier` after `PanelConfigCodec.applyConfigPatch`
   *  produces an updated typed Panel from a wire-shape patch.
   *
   *  Privileged update: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. The V36 RLS UPDATE policy (dashboard ACL)
   *  would also permit this on the app pool. */
  def replace(panel: Panel, lastUpdated: Instant): Future[Option[Panel]] = {
    val row = domainToRow(panel)
    val updated = row.copy(lastUpdated = lastUpdated)
    ctx.withSystemContext(
      table
        .filter(_.id === panel.id.value)
        .map(r => (r.typeId, r.fieldMapping, r.content, r.imageUrl, r.imageFit, r.dividerOrientation, r.dividerWeight, r.dividerColor, r.lastUpdated))
        .update((updated.typeId, updated.fieldMapping, updated.content, updated.imageUrl, updated.imageFit, updated.dividerOrientation, updated.dividerWeight, updated.dividerColor, lastUpdated))
        .andThen(table.filter(_.id === panel.id.value).result.headOption)
    ).map(_.map(rowToDomain))
  }

  /** Batch update: applies title / appearance / typed-config patches to many
   *  panels in one transaction. Cross-type lock is enforced at the service
   *  layer; this method assumes each item's `type` (if any) matches the
   *  stored row's `type` column. Parent dashboard ACL is the authoritative
   *  gate — this method performs no ACL check. */
  def batchUpdate(items: Vector[PanelBatchItem], now: Instant): Future[Vector[Panel]] = {
    if (items.isEmpty) return Future.successful(Vector.empty)

    val panelIds = items.map(_.id)

    def buildItemAction(item: PanelBatchItem): DBIO[Unit] =
      table.filter(_.id === item.id).result.headOption.flatMap {
        case None => DBIO.failed(new NoSuchElementException(s"Panel '${item.id}' not found"))
        case Some(row) =>
          val updates = Vector.newBuilder[DBIO[Unit]]

          item.title.foreach { title =>
            updates += table.filter(_.id === item.id).map(r => (r.title, r.lastUpdated)).update((title, now)).map(_ => ())
          }

          item.appearance.foreach { ap =>
            val current = row.appearance.parseJson.convertTo[PanelAppearance]
            val merged = PanelAppearance(
              background   = ap.background.getOrElse(current.background),
              color        = ap.color.getOrElse(current.color),
              transparency = ap.transparency.getOrElse(current.transparency),
              chart        = ap.chart.orElse(current.chart)
            )
            updates += table.filter(_.id === item.id).map(r => (r.appearance, r.lastUpdated)).update((merged.toJson.compactPrint, now)).map(_ => ())
          }

          // CS2c-3c: typed-config patch path. Builds a fresh Panel from the
          // stored row, applies the per-subtype Patch, writes every config
          // column back via domainToRow.
          item.config.foreach { configJson =>
            val existingPanel = rowToDomain(row)
            val patched = PanelConfigCodec.applyConfigPatch(existingPanel, configJson) match {
              case Right(p)  => p
              case Left(err) => throw new IllegalArgumentException(s"panel '${item.id}' config patch: $err")
            }
            val patchedRow = domainToRow(patched)
            updates += table.filter(_.id === item.id)
              .map(r => (r.typeId, r.fieldMapping, r.content, r.imageUrl, r.imageFit, r.dividerOrientation, r.dividerWeight, r.dividerColor, r.lastUpdated))
              .update((patchedRow.typeId, patchedRow.fieldMapping, patchedRow.content, patchedRow.imageUrl, patchedRow.imageFit, patchedRow.dividerOrientation, patchedRow.dividerWeight, patchedRow.dividerColor, now))
              .map(_ => ())
          }

          val actions = updates.result()
          if (actions.isEmpty) DBIO.successful(())
          else DBIO.seq(actions: _*)
      }

    val action =
      DBIO.sequence(items.map(buildItemAction))
        .andThen(table.filter(_.id inSet panelIds.toSet).result)
        .transactionally

    ctx.withSystemContext(action).map(_.map(rowToDomain).toVector)
  }

  // Helper to pipe a value into a function (avoids temp variable noise).
  private implicit class PipeOps[A](a: A) {
    def pipe[B](f: A => B): B = f(a)
  }
}

object PanelRepository {
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

  case class PanelRow(
      id: String,
      dashboardId: String,
      title: String,
      createdBy: String,
      createdAt: Instant,
      lastUpdated: Instant,
      appearance: String,
      panelType: String,
      typeId: Option[String],
      fieldMapping: Option[String],
      ownerId: UUID,
      content: Option[String],
      imageUrl: Option[String],
      imageFit: Option[String],
      dividerOrientation: Option[String],
      dividerWeight: Option[Int],
      dividerColor: Option[String]
  )

  class PanelTable(tag: Tag) extends Table[PanelRow](tag, "panels") {
    def id           = column[String]("id", O.PrimaryKey)
    def dashboardId  = column[String]("dashboard_id")
    def title        = column[String]("title")
    def createdBy    = column[String]("created_by")
    def createdAt    = column[Instant]("created_at")
    def lastUpdated  = column[Instant]("last_updated")
    def appearance   = column[String]("appearance")(jsonbStringType)
    def panelType    = column[String]("type")
    def typeId       = column[Option[String]]("type_id")
    def fieldMapping = column[Option[String]]("field_mapping", O.SqlType("jsonb"))
    def ownerId      = column[UUID]("owner_id")
    def content      = column[Option[String]]("content")
    def imageUrl            = column[Option[String]]("image_url")
    def imageFit            = column[Option[String]]("image_fit")
    def dividerOrientation  = column[Option[String]]("divider_orientation")
    def dividerWeight       = column[Option[Int]]("divider_weight")
    def dividerColor        = column[Option[String]]("divider_color")

    def * = (id, dashboardId, title, createdBy, createdAt, lastUpdated, appearance, panelType, typeId, fieldMapping, ownerId, content, imageUrl, imageFit, dividerOrientation, dividerWeight, dividerColor).mapTo[PanelRow]
  }
}
