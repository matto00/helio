package com.helio.infrastructure.persistence.auth

import com.helio.api.protocols.auth.{DashboardTabsPref, DashboardTabsPrefs}
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
    contextListCollapsed: Option[Boolean] = None,
    // HEL-1572: appearance keys in the same JSON; None = never set (motion None = follow the OS).
    typeStyle: Option[String] = None,
    density: Option[String] = None,
    motion: Option[String] = None,
    // HEL-1575: the saved dashboard tab set; None = never set (or an invalid stored value, dropped on read).
    dashboardTabs: Option[DashboardTabsPref] = None
)

/** HEL-1572: a validated partial update. `motion` is `None` = leave, `Some(None)` = clear (follow the OS),
 *  `Some(Some(v))` = set. */
final case class PreferencesPatch(
    contextListWidth: Option[Int] = None,
    contextListCollapsed: Option[Boolean] = None,
    typeStyle: Option[String] = None,
    density: Option[String] = None,
    motion: Option[Option[String]] = None,
    // HEL-1575: replaces the stored tab set as a whole.
    dashboardTabs: Option[DashboardTabsPref] = None
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

      def enum(key: String, allowed: Set[String]): Option[String] = fields.get(key) match {
        case Some(JsString(v)) if allowed.contains(v) => Some(v)
        case _                                        => None
      }

      val tabs = fields.get("dashboardTabs").flatMap(v => DashboardTabsPrefs.parse(v).toOption)

      val zoomMap = zoomRows.map { case (dashId, zoom) => dashId -> zoom }.toMap

      UserPreferencesData(
        accentColor,
        zoomMap,
        width,
        collapsed,
        enum("typeStyle", TypeStyles),
        enum("density", Densities),
        enum("motion", MotionLevels),
        tabs
      )
    }
  }

  def upsertGlobalPrefs(userId: UserId, accentColor: String): Future[Unit] =
    mergePrefs(userId, JsObject("accentColor" -> JsString(accentColor)))

  /** HEL-1574/HEL-1572: merges only the keys present; every other stored key is untouched. The caller has validated
   *  the values. HEL-1575: `dashboardTabs` replaces the stored tab set as a whole. Keyed solely on the authenticated user's id (`users` has no RLS -- isolation is application-level). */
  def patchPrefs(userId: UserId, patch: PreferencesPatch): Future[Unit] = {
    val fields: Map[String, JsValue] = Vector(
      patch.contextListWidth.map(w => "contextListWidth" -> (JsNumber(w): JsValue)),
      patch.contextListCollapsed.map(c => "contextListCollapsed" -> (JsBoolean(c): JsValue)),
      patch.typeStyle.map(v => "typeStyle" -> (JsString(v): JsValue)),
      patch.density.map(v => "density" -> (JsString(v): JsValue)),
      patch.motion.flatten.map(v => "motion" -> (JsString(v): JsValue)),
      patch.dashboardTabs.map(t => "dashboardTabs" -> tabsJson(t))
    ).flatten.toMap
    val clearMotion = patch.motion.contains(None)
    if (fields.isEmpty && !clearMotion) Future.unit else mergePrefs(userId, JsObject(fields), clearMotion)
  }

  /** Stored shape: absent optionals are omitted, so a `null` in the request and an omitted field read the same. */
  private def tabsJson(t: DashboardTabsPref): JsValue = JsObject(
    Vector(
      Some("tabs" -> JsArray(t.tabs.map { tab =>
        JsObject(
          Vector(
            Some("id" -> (JsString(tab.id): JsValue)),
            tab.lastViewedAt.map(v => "lastViewedAt" -> (JsString(v): JsValue)),
            tab.ownWriteAt.map(v => "ownWriteAt" -> (JsString(v): JsValue))
          ).flatten.toMap
        ): JsValue
      })),
      t.activeId.map(a => "activeId" -> (JsString(a): JsValue))
    ).flatten.toMap
  )

  /** One-statement JSON merge (`||`): keys in `patch` replace stored ones, all other keys survive. When
   *  `clearMotion` the `motion` key is removed in the same UPDATE (the patch never carries it then). */
  private def mergePrefs(userId: UserId, patch: JsObject, clearMotion: Boolean = false): Future[Unit] = {
    val patchStr = patch.compactPrint
    val action =
      if (clearMotion)
        sqlu"""UPDATE users
               SET preferences = ((COALESCE(NULLIF(preferences, ''), '{}')::jsonb || ${patchStr}::jsonb) - 'motion')::text
               WHERE id = ${userId.value}::uuid"""
      else
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
  // HEL-1572: the closed value sets (lowercase tokens, not labels).
  val TypeStyles: Set[String]   = Set("sans", "mono", "serif")
  val Densities: Set[String]    = Set("comfortable", "compact")
  val MotionLevels: Set[String] = Set("full", "subtle", "off")

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
