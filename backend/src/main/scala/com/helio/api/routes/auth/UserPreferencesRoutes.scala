package com.helio.api.routes.auth

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api.protocols.auth.{DashboardTabsPref, DashboardTabsPrefs}
import com.helio.api.{ErrorResponse, JsonProtocols, UserPreferences}
import com.helio.domain.model.AuthenticatedUser
import com.helio.infrastructure.persistence.auth.{PreferencesPatch, UserPreferenceRepository}
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success}

/** `PATCH /api/users/me/preferences` (HEL-1574): a partial update of the caller's shell layout preferences
 *  (`contextListWidth` 200..400, `contextListCollapsed`), HEL-1572 appearance (`typeStyle`, `density`, `motion`) and, since HEL-1575, the saved `dashboardTabs`. The endpoint takes no user id: the merge is keyed only on
 *  the authenticated session user, which is the isolation boundary (`users` has no RLS). */
final class UserPreferencesRoutes(repo: UserPreferenceRepository, user: AuthenticatedUser)(implicit
    system: ActorSystem[_]
) extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext
  private val log = LoggerFactory.getLogger(getClass)

  private val AllowedFields =
    Set("contextListWidth", "contextListCollapsed", "typeStyle", "density", "motion", "dashboardTabs")

  private def enumField(
      fields: Map[String, JsValue],
      key: String,
      allowed: Set[String]
  ): Either[String, Option[String]] = fields.get(key) match {
    case None                                     => Right(None)
    case Some(JsString(v)) if allowed.contains(v) => Right(Some(v))
    case Some(_)                                  => Left(s"$key must be one of: ${allowed.toSeq.sorted.mkString(", ")}")
  }

  private def validate(body: JsValue): Either[String, PreferencesPatch] = body match {
    case JsObject(fields) =>
      val unknown = fields.keySet.diff(AllowedFields)
      if (unknown.nonEmpty) Left(s"Unknown preference field: ${unknown.toSeq.sorted.mkString(", ")}")
      else if (fields.isEmpty) Left("At least one preference field is required")
      else {
        val width: Either[String, Option[Int]] = fields.get("contextListWidth") match {
          case None => Right(None)
          case Some(JsNumber(n))
              if n.isValidInt && n.toInt >= UserPreferenceRepository.ContextListMinWidth &&
                n.toInt <= UserPreferenceRepository.ContextListMaxWidth =>
            Right(Some(n.toInt))
          case Some(_) =>
            Left(
              s"contextListWidth must be an integer between ${UserPreferenceRepository.ContextListMinWidth} and ${UserPreferenceRepository.ContextListMaxWidth}"
            )
        }
        val collapsed: Either[String, Option[Boolean]] = fields.get("contextListCollapsed") match {
          case None                => Right(None)
          case Some(JsBoolean(b))  => Right(Some(b))
          case Some(_)             => Left("contextListCollapsed must be a boolean")
        }
        // `motion: null` clears the saved choice (follow the OS again).
        val motion: Either[String, Option[Option[String]]] = fields.get("motion") match {
          case Some(JsNull) => Right(Some(None))
          case _            => enumField(fields, "motion", UserPreferenceRepository.MotionLevels).map(_.map(Some(_)))
        }
        val tabs: Either[String, Option[DashboardTabsPref]] = fields.get("dashboardTabs") match {
          case None    => Right(None)
          case Some(v) => DashboardTabsPrefs.parse(v).map(Some(_))
        }
        for {
          w <- width
          c <- collapsed
          t <- enumField(fields, "typeStyle", UserPreferenceRepository.TypeStyles)
          d <- enumField(fields, "density", UserPreferenceRepository.Densities)
          m <- motion
          b <- tabs
        } yield PreferencesPatch(w, c, t, d, m, b)
      }
    case _ => Left("Request body must be a JSON object")
  }

  val routes: Route =
    pathPrefix("users") {
      path("me" / "preferences") {
        patch {
          entity(as[JsValue]) { body =>
            validate(body) match {
              case Left(message) => complete(StatusCodes.BadRequest, ErrorResponse(message))
              case Right(patch) =>
                val result = repo.patchPrefs(user.id, patch).flatMap(_ => repo.getPreferences(user.id))
                onComplete(result) {
                  case Success(p) =>
                    complete(
                      StatusCodes.OK,
                      UserPreferences(p.accentColor, p.zoomLevels, p.contextListWidth, p.contextListCollapsed, p.typeStyle, p.density, p.motion, p.dashboardTabs)
                    )
                  case Failure(ex) =>
                    // HEL-311: log the full exception server-side; never echo it in the response body.
                    log.error(s"PATCH /api/users/me/preferences failed for user ${user.id.value}", ex)
                    complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                }
            }
          }
        }
      }
    }
}
