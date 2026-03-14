package com.helio.api

import akka.actor.typed.ActorRef
import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import akka.util.Timeout
import com.helio.app.DashboardRegistryActor
import com.helio.app.PanelRegistryActor
import com.helio.domain.Dashboard
import com.helio.domain.DashboardAppearance
import com.helio.domain.DashboardId
import com.helio.domain.Panel
import com.helio.domain.PanelAppearance
import com.helio.domain.PanelId

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.Future
import scala.concurrent.duration.DurationInt

final class ApiRoutes(
    dashboardRegistry: ActorRef[DashboardRegistryActor.Command],
    panelRegistry: ActorRef[PanelRegistryActor.Command]
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val timeout: Timeout = 3.seconds
  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    path("health") {
      get {
        complete(HealthResponse(status = "ok"))
      }
    } ~
      pathPrefix("api") {
        concat(
          pathPrefix("dashboards") {
            concat(
              pathEndOrSingleSlash {
                concat(
                  get {
                    onSuccess(fetchDashboards()) { dashboards =>
                      complete(DashboardsResponse(items = dashboards.map(DashboardResponse.fromDomain)))
                    }
                  },
                  post {
                    entity(as[CreateDashboardRequest]) { request =>
                      onSuccess(createDashboard(request)) { dashboard =>
                        complete(
                          StatusCodes.Created,
                          DashboardResponse.fromDomain(dashboard)
                        )
                      }
                    }
                  }
                )
              },
              path(Segment / "panels") { dashboardId =>
                get {
                  onSuccess(fetchPanels(DashboardId(dashboardId))) { panels =>
                    complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
                  }
                }
              },
              path(Segment) { dashboardId =>
                patch {
                  entity(as[UpdateDashboardRequest]) { request =>
                    request.appearance match {
                      case Some(appearancePayload) =>
                        onSuccess(
                          updateDashboardAppearance(
                            DashboardId(dashboardId),
                            DashboardAppearance(
                              background = RequestValidation.normalizeDashboardBackground(
                                appearancePayload.background
                              ),
                              gridBackground = RequestValidation.normalizeDashboardGridBackground(
                                appearancePayload.gridBackground
                              )
                            )
                          )
                        ) {
                          case Some(dashboard) =>
                            complete(DashboardResponse.fromDomain(dashboard))
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                        }
                      case None =>
                        complete(StatusCodes.BadRequest, ErrorResponse("appearance is required"))
                    }
                  }
                }
              }
            )
          },
          pathPrefix("panels") {
            concat(
              pathEndOrSingleSlash {
                post {
                  entity(as[CreatePanelRequest]) { request =>
                    validatePanelRequest(request) match {
                      case Left(error) =>
                        complete(StatusCodes.BadRequest, ErrorResponse(error))
                      case Right(dashboardId) =>
                        onSuccess(fetchDashboard(dashboardId)) {
                          case Some(_) =>
                            onSuccess(createPanel(dashboardId, request)) { panel =>
                              complete(
                                StatusCodes.Created,
                                PanelResponse.fromDomain(panel)
                              )
                            }
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                        }
                    }
                  }
                }
              },
              path(Segment) { panelId =>
                patch {
                  entity(as[UpdatePanelRequest]) { request =>
                    request.appearance match {
                      case Some(appearancePayload) =>
                        onSuccess(
                          updatePanelAppearance(
                            PanelId(panelId),
                            PanelAppearance(
                              background = RequestValidation.normalizePanelBackground(
                                appearancePayload.background
                              ),
                              color = RequestValidation.normalizePanelColor(appearancePayload.color),
                              transparency = RequestValidation.normalizeTransparency(
                                appearancePayload.transparency
                              )
                            )
                          )
                        ) {
                          case Some(panel) =>
                            complete(PanelResponse.fromDomain(panel))
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                        }
                      case None =>
                        complete(StatusCodes.BadRequest, ErrorResponse("appearance is required"))
                    }
                  }
                }
              }
            )
          }
        )
      }

  private def fetchDashboards(): Future[Vector[Dashboard]] =
    dashboardRegistry.ask(DashboardRegistryActor.GetDashboards.apply).map(_.items)

  private def fetchDashboard(dashboardId: DashboardId): Future[Option[Dashboard]] =
    dashboardRegistry.ask(DashboardRegistryActor.GetDashboard(dashboardId, _)).map(_.item)

  private def fetchPanels(dashboardId: DashboardId): Future[Vector[Panel]] =
    panelRegistry.ask(PanelRegistryActor.GetPanelsForDashboard(dashboardId, _)).map(_.items)

  private def fetchPanel(panelId: PanelId): Future[Option[Panel]] =
    panelRegistry.ask(PanelRegistryActor.GetPanel(panelId, _)).map(_.item)

  private def createDashboard(request: CreateDashboardRequest): Future[Dashboard] =
    dashboardRegistry.ask(
      DashboardRegistryActor.RegisterDashboard(
        RequestValidation.normalizeDashboardName(request.name),
        _
      )
    )

  private def createPanel(dashboardId: DashboardId, request: CreatePanelRequest): Future[Panel] =
    panelRegistry.ask(
      PanelRegistryActor.RegisterPanel(
        dashboardId,
        RequestValidation.normalizePanelTitle(request.title),
        _
      )
    )

  private def updateDashboardAppearance(
      dashboardId: DashboardId,
      appearance: DashboardAppearance
  ): Future[Option[Dashboard]] =
    dashboardRegistry.ask(
      DashboardRegistryActor.UpdateDashboardAppearance(
        dashboardId,
        appearance,
        _
      )
    ).map(_.item)

  private def updatePanelAppearance(
      panelId: PanelId,
      appearance: PanelAppearance
  ): Future[Option[Panel]] =
    panelRegistry.ask(
      PanelRegistryActor.UpdatePanelAppearance(
        panelId,
        appearance,
        _
      )
    ).map(_.item)

  private def validatePanelRequest(request: CreatePanelRequest): Either[String, DashboardId] =
    request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
      case Some(dashboardId) => Right(DashboardId(dashboardId))
      case None              => Left("dashboardId is required")
    }
}
