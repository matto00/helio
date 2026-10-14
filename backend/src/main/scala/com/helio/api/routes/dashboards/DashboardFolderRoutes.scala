package com.helio.api.routes.dashboards

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.routes.ServiceResponse
import com.helio.api.protocols.dashboards._
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.dashboards.DashboardFolderService
import spray.json._

import scala.concurrent.ExecutionContext

/** `/api/dashboard-folders` CRUD and `PUT /api/dashboards/:id/folder` (HEL-1574). Thin HTTP shell over
 *  [[DashboardFolderService]]. */
class DashboardFolderRoutes(service: DashboardFolderService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  private val folders: Route =
    pathPrefix("dashboard-folders") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(service.list(user)) { case (fs, as) =>
                complete(DashboardFolderListResponse.fromDomain(fs, as))
              }
            },
            post {
              entity(as[CreateDashboardFolderRequest]) { req =>
                ServiceResponse.run(service.create(req.name, user))(f =>
                  StatusCodes.Created -> DashboardFolderResponse.fromDomain(f)
                )
              }
            }
          )
        },
        path(Segment) { id =>
          concat(
            patch {
              entity(as[UpdateDashboardFolderRequest]) { req =>
                ServiceResponse.run(service.update(id, req.name, req.collapsed, user))(DashboardFolderResponse.fromDomain)
              }
            },
            delete {
              ServiceResponse.runNoContent(service.delete(id, user))
            }
          )
        }
      )
    }

  /** `{folderId: string | null}`: the key must be present (null unfiles), so the body is read as raw JSON. */
  private val move: Route =
    path("dashboards" / Segment / "folder") { dashboardId =>
      put {
        entity(as[JsValue]) {
          case JsObject(fields) if fields.contains("folderId") && fields.size == 1 =>
            val folderId: Either[String, Option[String]] = fields("folderId") match {
              case JsNull      => Right(None)
              case JsString(s) => Right(Some(s))
              case _           => Left("folderId must be a string or null")
            }
            folderId match {
              case Left(message) => complete(StatusCodes.BadRequest, ErrorResponse(message))
              case Right(folder) => ServiceResponse.runNoContent(service.move(dashboardId, folder, user))
            }
          case _ => complete(StatusCodes.BadRequest, ErrorResponse("Body must be {\"folderId\": string | null}"))
        }
      }
    }

  val routes: Route = concat(folders, move)
}
