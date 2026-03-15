package com.helio.api

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, PanelRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.Future

final class ApiRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

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
                    onSuccess(dashboardRepo.findAll()) { dashboards =>
                      complete(DashboardsResponse(items = dashboards.map(DashboardResponse.fromDomain)))
                    }
                  },
                  post {
                    entity(as[CreateDashboardRequest]) { request =>
                      val now = Instant.now()
                      val dashboard = Dashboard(
                        id         = DashboardId(UUID.randomUUID().toString),
                        name       = RequestValidation.normalizeDashboardName(request.name),
                        meta       = ResourceMeta(createdBy = "system", createdAt = now, lastUpdated = now),
                        appearance = DashboardAppearance.Default,
                        layout     = DashboardLayout.Default
                      )
                      onSuccess(dashboardRepo.insert(dashboard)) { created =>
                        complete(StatusCodes.Created, DashboardResponse.fromDomain(created))
                      }
                    }
                  }
                )
              },
              path(Segment / "panels") { dashboardId =>
                get {
                  onSuccess(panelRepo.findByDashboardId(DashboardId(dashboardId))) { panels =>
                    complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
                  }
                }
              },
              path(Segment) { dashboardId =>
                patch {
                  entity(as[UpdateDashboardRequest]) { request =>
                    validateDashboardUpdateRequest(request) match {
                      case Left(error) =>
                        complete(StatusCodes.BadRequest, ErrorResponse(error))
                      case Right((appearanceOpt, layoutOpt)) =>
                        onSuccess(dashboardRepo.findById(DashboardId(dashboardId))) {
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                          case Some(existing) =>
                            val updated = existing.copy(
                              appearance = appearanceOpt.getOrElse(existing.appearance),
                              layout     = layoutOpt.getOrElse(existing.layout),
                              meta       = existing.meta.copy(lastUpdated = Instant.now())
                            )
                            onSuccess(dashboardRepo.update(updated)) {
                              case Some(d) => complete(DashboardResponse.fromDomain(d))
                              case None    => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                            }
                        }
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
                        onSuccess(dashboardRepo.findById(dashboardId)) {
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                          case Some(_) =>
                            val now = Instant.now()
                            val panel = Panel(
                              id          = PanelId(UUID.randomUUID().toString),
                              dashboardId = dashboardId,
                              title       = RequestValidation.normalizePanelTitle(request.title),
                              meta        = ResourceMeta(createdBy = "system", createdAt = now, lastUpdated = now),
                              appearance  = PanelAppearance.Default
                            )
                            onSuccess(panelRepo.insert(panel)) { created =>
                              complete(StatusCodes.Created, PanelResponse.fromDomain(created))
                            }
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
                        val appearance = PanelAppearance(
                          background   = RequestValidation.normalizePanelBackground(appearancePayload.background),
                          color        = RequestValidation.normalizePanelColor(appearancePayload.color),
                          transparency = RequestValidation.normalizeTransparency(appearancePayload.transparency)
                        )
                        onSuccess(panelRepo.updateAppearance(PanelId(panelId), appearance, Instant.now())) {
                          case Some(panel) => complete(PanelResponse.fromDomain(panel))
                          case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
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

  private def validatePanelRequest(request: CreatePanelRequest): Either[String, DashboardId] =
    request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(DashboardId(id))
      case None     => Left("dashboardId is required")
    }

  private def validateDashboardUpdateRequest(
      request: UpdateDashboardRequest
  ): Either[String, (Option[DashboardAppearance], Option[DashboardLayout])] = {
    if (request.appearance.isEmpty && request.layout.isEmpty) {
      Left("appearance or layout is required")
    } else {
      validateDashboardLayoutPayload(request.layout).map { layout =>
        (
          request.appearance.map(p =>
            DashboardAppearance(
              background    = RequestValidation.normalizeDashboardBackground(p.background),
              gridBackground = RequestValidation.normalizeDashboardGridBackground(p.gridBackground)
            )
          ),
          layout
        )
      }
    }
  }

  private def validateDashboardLayoutPayload(
      layout: Option[DashboardLayoutPayload]
  ): Either[String, Option[DashboardLayout]] =
    layout match {
      case None => Right(None)
      case Some(p) =>
        validateDashboardLayoutItems(p.lg).flatMap(lg =>
          validateDashboardLayoutItems(p.md).flatMap(md =>
            validateDashboardLayoutItems(p.sm).flatMap(sm =>
              validateDashboardLayoutItems(p.xs).map(xs =>
                Some(DashboardLayout(lg, md, sm, xs))
              )
            )
          )
        )
    }

  private def validateDashboardLayoutItems(
      items: Vector[DashboardLayoutItemPayload]
  ): Either[String, Vector[DashboardLayoutItem]] =
    items.foldLeft[Either[String, Vector[DashboardLayoutItem]]](Right(Vector.empty)) {
      case (Left(err), _) => Left(err)
      case (Right(acc), item) =>
        val panelId = item.panelId.trim
        if (panelId.isEmpty) Left("layout panelId is required")
        else Right(acc :+ DashboardLayoutItem(
          panelId = PanelId(panelId),
          x       = RequestValidation.normalizeLayoutCoordinate(item.x),
          y       = RequestValidation.normalizeLayoutCoordinate(item.y),
          w       = RequestValidation.normalizeLayoutSpan(item.w),
          h       = RequestValidation.normalizeLayoutSpan(item.h)
        ))
    }
}
