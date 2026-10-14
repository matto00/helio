package com.helio.infrastructure.persistence.auth

import com.helio.domain.model.{DashboardId, UserId}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

final case class UserPreferencesData(
    accentColor: Option[String],
    zoomLevels: Map[String, Double],
    // HEL-1574: shell layout keys in the same `users.preferences` JSON; None = never set.
    contextListWidth: Option[Int] = None,
    contextListCollapsed: Option[Boolean] = None
)

class UserPreferenceRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

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
      val fields: Map[String, JsValue] = maybeJsonb.flatten
        .flatMap(jsonStr => Try(JsonParser(jsonStr).asJsObject.fields).toOption)
        .getOrElse(Map.empty)

      val accentColor = fields.get("accentColor") match {
        case Some(JsString(color)) => Some(color)
        case _                     => None
      }
      // Invalid stored values are dropped so the client falls back to its defaults.
      val width = fields.get("contextListWidth") match {
        case Some(JsNumber(n)) if n.isValidInt && n.toInt >= ContextListMinWidth && n.toInt <= ContextListMaxWidth =>
          Some(n.toInt)
        case _ => None
      }
      val collapsed = fields.get("contextListCollapsed") match {
        case Some(JsBoolean(b)) => Some(b)
        case _                  => None
      }

      val zoomMap = zoomRows.map { case (dashId, zoom) => dashId -> zoom }.toMap

      UserPreferencesData(accentColor, zoomMap, width, collapsed)
    }
  }

  def upsertGlobalPrefs(userId: UserId, accentColor: String): Future[Unit] =
    mergePrefs(userId, JsObject("accentColor" -> JsString(accentColor)))

  /** HEL-1574: merges only the shell keys present; every other stored key is untouched. The caller has validated the
   *  ranges. Keyed solely on the authenticated user's id (`users` has no RLS -- isolation is application-level). */
  def patchShellPrefs(userId: UserId, width: Option[Int], collapsed: Option[Boolean]): Future[Unit] = {
    val fields = Vector(
      width.map(w => "contextListWidth" -> (JsNumber(w): JsValue)),
      collapsed.map(c => "contextListCollapsed" -> (JsBoolean(c): JsValue))
    ).flatten.toMap
    if (fields.isEmpty) Future.unit else mergePrefs(userId, JsObject(fields))
  }

  /** One-statement JSON merge (`||`): keys in `patch` replace stored ones, all other keys survive. */
  private def mergePrefs(userId: UserId, patch: JsObject): Future[Unit] = {
    val patchStr   = patch.compactPrint
    val action =
      sqlu"""UPDATE users
             SET preferences = (COALESCE(NULLIF(preferences, ''), '{}')::jsonb || ${patchStr}::jsonb)::text
             WHERE id = ${userId.value}::uuid"""
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

  val ContextListMinWidth: Int = 200
  val ContextListMaxWidth: Int = 400

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
