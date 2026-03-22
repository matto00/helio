package com.helio.infrastructure

import com.helio.api.JsonProtocols
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PanelRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  import PanelRepository._

  private val table = TableQuery[PanelTable]

  private def rowToDomain(row: PanelRow): Panel =
    Panel(
      id           = PanelId(row.id),
      dashboardId  = DashboardId(row.dashboardId),
      title        = row.title,
      meta         = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
      appearance   = row.appearance.parseJson.convertTo[PanelAppearance],
      panelType    = PanelType.fromString(row.panelType).getOrElse(PanelType.Default),
      typeId       = row.typeId.map(DataTypeId(_)),
      fieldMapping = row.fieldMapping.map(_.parseJson)
    )

  private def domainToRow(p: Panel): PanelRow =
    PanelRow(
      id           = p.id.value,
      dashboardId  = p.dashboardId.value,
      title        = p.title,
      createdBy    = p.meta.createdBy,
      createdAt    = p.meta.createdAt,
      lastUpdated  = p.meta.lastUpdated,
      appearance   = p.appearance.toJson.compactPrint,
      panelType    = PanelType.asString(p.panelType),
      typeId       = p.typeId.map(_.value),
      fieldMapping = p.fieldMapping.map(_.compactPrint)
    )

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

  def duplicate(id: PanelId): Future[Option[Panel]] = {
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
              lastUpdated = now
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

  def updateType(id: PanelId, panelType: PanelType, lastUpdated: Instant): Future[Option[Panel]] =
    db.run(
      table
        .filter(_.id === id.value)
        .map(r => (r.panelType, r.lastUpdated))
        .update((PanelType.asString(panelType), lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  def updateTypeBinding(
      id: PanelId,
      typeId: Option[DataTypeId],
      fieldMapping: Option[JsValue],
      lastUpdated: Instant
  ): Future[Option[Panel]] =
    db.run(
      table
        .filter(_.id === id.value)
        .map(r => (r.typeId, r.fieldMapping, r.lastUpdated))
        .update((typeId.map(_.value), fieldMapping.map(_.compactPrint), lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))
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
      fieldMapping: Option[String]
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

    def * = (id, dashboardId, title, createdBy, createdAt, lastUpdated, appearance, panelType, typeId, fieldMapping).mapTo[PanelRow]
  }
}
