package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, PanelRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}

final class DashboardRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    user: AuthenticatedUser,
    acl: AclDirective,
    ownerResolver: String => Future[Option[String]]
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
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
                  meta       = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
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
            acl.authorizeResource(dashboardId, user, ownerResolver, "Dashboard not found") {
              onSuccess(panelRepo.findByDashboardId(DashboardId(dashboardId))) { panels =>
                complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
              }
            }
          }
        },
        path(Segment / "duplicate") { dashboardId =>
          post {
            acl.authorizeResource(dashboardId, user, ownerResolver, "Dashboard not found") {
              onSuccess(dashboardRepo.duplicate(DashboardId(dashboardId))) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                case Some((dashboard, panels)) =>
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
        },
        path(Segment / "export") { dashboardId =>
          get {
            acl.authorizeResource(dashboardId, user, ownerResolver, "Dashboard not found") {
              onSuccess(dashboardRepo.exportSnapshot(DashboardId(dashboardId))) {
                case None           => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                case Some(snapshot) => complete(snapshot)
              }
            }
          }
        },
        path("import") {
          post {
            entity(as[DashboardSnapshotPayload]) { payload =>
              validateSnapshotPayload(payload) match {
                case Left(error) =>
                  complete(StatusCodes.BadRequest, ErrorResponse(error))
                case Right(_) =>
                  onSuccess(dashboardRepo.importSnapshot(payload)) { case (dashboard, panels) =>
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
        },
        path(Segment) { dashboardId =>
          concat(
            delete {
              acl.authorizeResource(dashboardId, user, ownerResolver, "Dashboard not found") {
                onSuccess(dashboardRepo.delete(DashboardId(dashboardId))) {
                  case true  => complete(StatusCodes.NoContent)
                  case false => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                }
              }
            },
            patch {
              acl.authorizeResource(dashboardId, user, ownerResolver, "Dashboard not found") {
                entity(as[UpdateDashboardRequest]) { request =>
                  validateDashboardUpdateRequest(request) match {
                    case Left(error) =>
                      complete(StatusCodes.BadRequest, ErrorResponse(error))
                    case Right((nameOpt, appearanceOpt, layoutOpt)) =>
                      onSuccess(dashboardRepo.findById(DashboardId(dashboardId))) {
                        case None =>
                          complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                        case Some(existing) =>
                          val now = Instant.now()
                          nameOpt match {
                            case Some(name) =>
                              onSuccess(dashboardRepo.updateName(DashboardId(dashboardId), name, now)) {
                                case None => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                                case Some(renamed) =>
                                  if (appearanceOpt.isEmpty && layoutOpt.isEmpty) {
                                    complete(DashboardResponse.fromDomain(renamed))
                                  } else {
                                    val updated = renamed.copy(
                                      appearance = appearanceOpt.getOrElse(renamed.appearance),
                                      layout     = layoutOpt.getOrElse(renamed.layout),
                                      meta       = renamed.meta.copy(lastUpdated = now)
                                    )
                                    onSuccess(dashboardRepo.update(updated)) {
                                      case Some(d) => complete(DashboardResponse.fromDomain(d))
                                      case None    => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                                    }
                                  }
                              }
                            case None =>
                              val updated = existing.copy(
                                appearance = appearanceOpt.getOrElse(existing.appearance),
                                layout     = layoutOpt.getOrElse(existing.layout),
                                meta       = existing.meta.copy(lastUpdated = now)
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
            }
          )
        }
      )
    }

  private def validateDashboardUpdateRequest(
      request: UpdateDashboardRequest
  ): Either[String, (Option[String], Option[DashboardAppearance], Option[DashboardLayout])] = {
    if (request.name.isEmpty && request.appearance.isEmpty && request.layout.isEmpty) {
      Left("name, appearance, or layout is required")
    } else {
      request.name.map(_.trim) match {
        case Some("") => Left("name must not be blank")
        case nameOpt =>
          validateDashboardLayoutPayload(request.layout).map { layout =>
            (
              nameOpt,
              request.appearance.map(p =>
                DashboardAppearance(
                  background     = RequestValidation.normalizeDashboardBackground(p.background),
                  gridBackground = RequestValidation.normalizeDashboardGridBackground(p.gridBackground)
                )
              ),
              layout
            )
          }
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

  private def validateSnapshotPayload(payload: DashboardSnapshotPayload): Either[String, Unit] = {
    if (payload.version < 1) {
      return Left(s"version must be >= 1, got ${payload.version}")
    }

    val name = payload.dashboard.name.trim
    if (name.isEmpty) {
      return Left("dashboard.name must not be blank")
    }

    val snapshotIds = payload.panels.map(_.snapshotId).toSet

    for (panel <- payload.panels) {
      PanelType.fromString(panel.`type`) match {
        case Left(err) => return Left(err)
        case Right(_)  => ()
      }
    }

    val allLayoutItems =
      payload.dashboard.layout.lg ++
      payload.dashboard.layout.md ++
      payload.dashboard.layout.sm ++
      payload.dashboard.layout.xs

    for (item <- allLayoutItems) {
      if (!snapshotIds.contains(item.panelId)) {
        return Left(s"layout references unknown snapshotId: '${item.panelId}'")
      }
    }

    Right(())
  }
}
