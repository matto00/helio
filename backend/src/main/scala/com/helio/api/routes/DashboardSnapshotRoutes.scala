package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DashboardIdSegment
import com.helio.domain._
import com.helio.infrastructure.DashboardRepository

import scala.concurrent.ExecutionContextExecutor

/** Snapshot-related dashboard routes: `GET /dashboards/:id/export` and `POST /dashboards/import`.
 *  Split out of `DashboardRoutes` to keep both files within the 250-line soft budget. */
final class DashboardSnapshotRoutes(
    dashboardRepo: DashboardRepository,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards") {
      concat(
        path(DashboardIdSegment / "export") { dashboardId =>
          get {
            onSuccess(dashboardRepo.findById(dashboardId)) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
              case Some(dashboard) if dashboard.ownerId != user.id =>
                complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
              case Some(_) =>
                onSuccess(dashboardRepo.exportSnapshot(dashboardId)) {
                  case None           => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                  case Some(snapshot) => complete(snapshot)
                }
            }
          }
        },
        path("import") {
          post {
            entity(as[DashboardSnapshotPayload]) { payload =>
              DashboardSnapshotRoutes.validateSnapshotPayload(payload) match {
                case Left(error) =>
                  complete(StatusCodes.BadRequest, ErrorResponse(error))
                case Right(_) =>
                  onSuccess(dashboardRepo.importSnapshot(payload, user.id)) { case (dashboard, panels) =>
                    complete(
                      StatusCodes.Created,
                      DuplicateDashboardResponse(
                        dashboard = DashboardResponse.fromDomain(dashboard),
                        panels    = panels.map(PanelResponse.fromDomain)
                      )
                    )
                  }
              }
            }
          }
        }
      )
    }
}

object DashboardSnapshotRoutes {

  /** Validate a snapshot payload at import time.
   *  Exposed for unit testing; the route uses it via `DashboardSnapshotRoutes.validateSnapshotPayload`. */
  def validateSnapshotPayload(payload: DashboardSnapshotPayload): Either[String, Unit] =
    for {
      _ <- validateVersion(payload.version)
      _ <- validateName(payload.dashboard.name)
      _ <- validatePanelTypes(payload.panels)
      _ <- validateLayoutReferences(payload)
    } yield ()

  private[routes] def validateVersion(version: Int): Either[String, Unit] =
    if (version < 1) Left(s"version must be >= 1, got $version")
    else Right(())

  private[routes] def validateName(name: String): Either[String, Unit] =
    if (name.trim.isEmpty) Left("dashboard.name must not be blank")
    else Right(())

  private[routes] def validatePanelTypes(panels: Vector[DashboardSnapshotPanelEntry]): Either[String, Unit] =
    panels.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), panel) =>
        PanelType.fromString(panel.`type`).map(_ => ())
    }

  private[routes] def validateLayoutReferences(payload: DashboardSnapshotPayload): Either[String, Unit] = {
    val snapshotIds = payload.panels.map(_.snapshotId).toSet
    val allLayoutItems =
      payload.dashboard.layout.lg ++
      payload.dashboard.layout.md ++
      payload.dashboard.layout.sm ++
      payload.dashboard.layout.xs

    allLayoutItems.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), item) =>
        if (snapshotIds.contains(item.panelId)) Right(())
        else Left(s"layout references unknown snapshotId: '${item.panelId}'")
    }
  }
}
