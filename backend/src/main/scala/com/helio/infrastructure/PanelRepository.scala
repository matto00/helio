package com.helio.infrastructure

import com.helio.api.protocols.{PanelBatchItem, PanelProtocol}
import com.helio.domain._
import com.helio.domain.panels._
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PanelRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends PanelProtocol {

  import PanelRepository._

  private val table = TableQuery[PanelTable]

  private def rowToDomain(row: PanelRow): Panel =
    PanelRowMapper.rowToDomain(row)

  private def domainToRow(p: Panel): PanelRow =
    PanelRowMapper.domainToRow(p)

  def findByDashboardId(dashboardId: DashboardId): Future[Vector[Panel]] =
    db.run(table.filter(_.dashboardId === dashboardId.value).sortBy(_.lastUpdated.desc).result)
      .map(_.map(rowToDomain).toVector)

  def findById(id: PanelId): Future[Option[Panel]] =
    db.run(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  def insert(panel: Panel): Future[Panel] =
    db.run(table += domainToRow(panel))
      .map(_ => panel)

  def updateTitle(id: PanelId, title: String, lastUpdated: Instant): Future[Option[Panel]] =
    db.run(
      table
        .filter(_.id === id.value)
        .map(r => (r.title, r.lastUpdated))
        .update((title, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  def delete(id: PanelId): Future[Boolean] =
    db.run(table.filter(_.id === id.value).delete).map(_ > 0)

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

    db.run(action)
  }

  def updateAppearance(id: PanelId, appearance: PanelAppearance, lastUpdated: Instant): Future[Option[Panel]] =
    db.run(
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
   *  produces an updated typed Panel from a wire-shape patch. */
  def replace(panel: Panel, lastUpdated: Instant): Future[Option[Panel]] = {
    val row = domainToRow(panel)
    val updated = row.copy(lastUpdated = lastUpdated)
    db.run(
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
   *  stored row's `type` column. */
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

    db.run(action).map(_.map(rowToDomain).toVector)
  }
}

object PanelRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

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
    def appearance   = column[String]("appearance")
    def panelType    = column[String]("type")
    def typeId       = column[Option[String]]("type_id")
    def fieldMapping = column[Option[String]]("field_mapping")
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
