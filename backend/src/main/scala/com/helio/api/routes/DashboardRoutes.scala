package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DashboardIdSegment
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, DataTypeRepository, PanelRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor

// Snapshot import/export handlers now live in `DashboardSnapshotRoutes`; this file
// retains the dashboard CRUD + duplicate + batch-update surface.
//
// `panelRepo` and `dataTypeRepo` remain in the constructor to preserve the public
// wiring signature even though the dead `resolvePanels` helper that depended on them
// has been removed.
final class DashboardRoutes(
    dashboardRepo: DashboardRepository,
    @annotation.unused panelRepo: PanelRepository,
    user: AuthenticatedUser,
    @annotation.unused dataTypeRepo: Option[DataTypeRepository] = None
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
              onSuccess(dashboardRepo.findAll(user.id)) { dashboards =>
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
                  layout     = DashboardLayout.Default,
                  ownerId    = user.id
                )
                onSuccess(dashboardRepo.insert(dashboard)) { created =>
                  complete(StatusCodes.Created, DashboardResponse.fromDomain(created))
                }
              }
            }
          )
        },
        path(DashboardIdSegment / "duplicate") { dashboardId =>
          post {
            onSuccess(dashboardRepo.findById(dashboardId)) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
              case Some(dashboard) if dashboard.ownerId != user.id =>
                complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
              case Some(_) =>
                onSuccess(dashboardRepo.duplicate(dashboardId, user.id)) {
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
        path(DashboardIdSegment / "update") { dashboardId =>
          patch {
            entity(as[UpdateDashboardBatchRequest]) { request =>
              applyDashboardUpdate(dashboardId, request.dashboard)
            }
          }
        },
        path(DashboardIdSegment) { dashboardId =>
          concat(
            delete {
              onSuccess(dashboardRepo.findById(dashboardId)) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                case Some(dashboard) if dashboard.ownerId != user.id =>
                  complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                case Some(_) =>
                  onSuccess(dashboardRepo.delete(dashboardId)) {
                    case true  => complete(StatusCodes.NoContent)
                    case false => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                  }
              }
            },
            patch {
              entity(as[UpdateDashboardRequest]) { request =>
                applyDashboardUpdate(dashboardId, request)
              }
            }
          )
        }
      )
    }

  /** Shared PATCH body used by both `/dashboards/:id` and `/dashboards/:id/update`.
   *  Validates, authorizes, then fans out name/appearance/layout updates against the repository. */
  private def applyDashboardUpdate(dashboardId: DashboardId, request: UpdateDashboardRequest): Route =
    validateDashboardUpdateRequest(request) match {
      case Left(error) =>
        complete(StatusCodes.BadRequest, ErrorResponse(error))
      case Right((nameOpt, appearanceOpt, layoutOpt)) =>
        onSuccess(dashboardRepo.findById(dashboardId)) {
          case None =>
            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
          case Some(existing) if existing.ownerId != user.id =>
            complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
          case Some(existing) =>
            val now = Instant.now()
            nameOpt match {
              case Some(name) =>
                onSuccess(dashboardRepo.updateName(dashboardId, name, now)) {
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

}
