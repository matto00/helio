package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, DataTypeRepository, PanelRepository, ResourcePermissionRepository}

import scala.concurrent.{ExecutionContextExecutor, Future}

final class PublicDashboardRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    permissionRepo: ResourcePermissionRepository,
    aclDirective: AclDirective,
    userOpt: Option[AuthenticatedUser],
    dataTypeRepo: Option[DataTypeRepository] = None
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private def getOwner(resourceId: String): Future[Option[String]] =
    dashboardRepo.findById(DashboardId(resourceId)).map(_.map(_.ownerId.value))

  /** Resolve cross-user typeId bindings for a list of panels.
   *  If a panel's typeId belongs to a different user, it is cleared (treated as unbound). */
  private def resolvePanels(panels: Vector[Panel]): Future[Vector[Panel]] =
    (userOpt, dataTypeRepo) match {
      case (Some(user), Some(dtRepo)) =>
        Future.traverse(panels) { panel =>
          panel.typeId match {
            case None => Future.successful(panel)
            case Some(typeId) =>
              dtRepo.findById(typeId, user.id).map {
                case None    => panel.copy(typeId = None, fieldMapping = None)
                case Some(_) => panel
              }
          }
        }
      case _ => Future.successful(panels.map(p => p.copy(typeId = None, fieldMapping = None)))
    }

  val routes: Route =
    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
      pathEndOrSingleSlash {
        get {
          aclDirective.authorizeResourceWithSharing(
            "dashboard",
            dashboardId,
            userOpt,
            getOwner,
            "Dashboard not found"
          ) { _ =>
            onSuccess(panelRepo.findByDashboardId(DashboardId(dashboardId)).flatMap(resolvePanels)) { panels =>
              complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
            }
          }
        }
      }
    }
}
