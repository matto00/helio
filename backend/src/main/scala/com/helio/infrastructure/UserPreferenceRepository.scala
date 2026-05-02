package com.helio.infrastructure

import com.helio.domain.{DashboardId, UserId}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

final case class UserPreferencesData(
    accentColor: Option[String],
    zoomLevels: Map[String, Double]
)

class UserPreferenceRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import UserPreferenceRepository._

  private val users = TableQuery[UserTable]
  private val zoom  = TableQuery[UserDashboardZoomTable]

  def getPreferences(userId: UserId): Future[UserPreferencesData] = {
    val userIdUuid = UUID.fromString(userId.value)

    val globalPrefsQuery = users
      .filter(_.id === userIdUuid)
      .map(_.preferences)
      .result
      .headOption

    val zoomQuery = zoom
      .filter(_.userId === userIdUuid)
      .map(r => (r.dashboardId, r.zoomLevel))
      .result

    db.run(globalPrefsQuery.zip(zoomQuery)).map { case (maybeJsonb, zoomRows) =>
      val accentColor = maybeJsonb.flatten.flatMap { jsonStr =>
        JsonParser(jsonStr).asJsObject.fields.get("accentColor") match {
          case Some(JsString(color)) => Some(color)
          case _                     => None
        }
      }

      val zoomMap = zoomRows.map { case (dashId, zoom) => dashId -> zoom }.toMap

      UserPreferencesData(accentColor, zoomMap)
    }
  }

  def upsertGlobalPrefs(userId: UserId, accentColor: String): Future[Unit] = {
    val userIdUuid = UUID.fromString(userId.value)
    val jsonStr    = JsObject("accentColor" -> JsString(accentColor)).compactPrint

    val action = users
      .filter(_.id === userIdUuid)
      .map(_.preferences)
      .update(Some(jsonStr))

    db.run(action).map(_ => ())
  }

  def upsertDashboardZoom(userId: UserId, dashboardId: DashboardId, zoomLevel: Double): Future[Unit] = {
    val row = UserDashboardZoomRow(
      userId      = UUID.fromString(userId.value),
      dashboardId = dashboardId.value,
      zoomLevel   = zoomLevel
    )

    val action = zoom.insertOrUpdate(row)

    db.run(action).map(_ => ())
  }
}

object UserPreferenceRepository {

  final case class UserDashboardZoomRow(
      userId: UUID,
      dashboardId: String,
      zoomLevel: Double
  )

  class UserTable(tag: Tag) extends Table[(UUID, Option[String])](tag, "users") {
    def id          = column[UUID]("id", O.PrimaryKey)
    def preferences = column[Option[String]]("preferences")
    def * = (id, preferences)
  }

  class UserDashboardZoomTable(tag: Tag) extends Table[UserDashboardZoomRow](tag, "user_dashboard_zoom") {
    def userId      = column[UUID]("user_id")
    def dashboardId = column[String]("dashboard_id")
    def zoomLevel   = column[Double]("zoom_level")
    def pk = primaryKey("pk_user_dashboard_zoom", (userId, dashboardId))
    def * = (userId, dashboardId, zoomLevel) <> (UserDashboardZoomRow.tupled, UserDashboardZoomRow.unapply)
  }
}
