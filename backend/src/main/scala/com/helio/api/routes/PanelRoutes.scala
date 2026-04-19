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

final class PanelRoutes(
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
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
                      validatePanelType(request.`type`) match {
                        case Left(err) =>
                          complete(StatusCodes.BadRequest, ErrorResponse(err))
                        case Right(panelType) =>
                          val now = Instant.now()
                          val panel = Panel(
                            id          = PanelId(UUID.randomUUID().toString),
                            dashboardId = dashboardId,
                            title       = RequestValidation.normalizePanelTitle(request.title),
                            meta        = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
                            appearance  = PanelAppearance.Default,
                            panelType   = panelType,
                            ownerId     = user.id
                          )
                          onSuccess(panelRepo.insert(panel)) { created =>
                            complete(StatusCodes.Created, PanelResponse.fromDomain(created))
                          }
                      }
                  }
              }
            }
          }
        },
        path(Segment) { panelId =>
          concat(
            delete {
              onSuccess(panelRepo.findById(PanelId(panelId))) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                case Some(panel) if panel.ownerId != user.id =>
                  complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                case Some(_) =>
                  onSuccess(panelRepo.delete(PanelId(panelId))) {
                    case true  => complete(StatusCodes.NoContent)
                    case false => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  }
              }
            },
            patch {
              entity(as[UpdatePanelRequest]) { request =>
                onSuccess(panelRepo.findById(PanelId(panelId))) {
                  case None =>
                    complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  case Some(existing) if existing.ownerId != user.id =>
                    complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                  case Some(_) =>
                val trimmedTitle  = request.title.map(_.trim)
                val hasBinding    = request.typeId.isDefined || request.fieldMapping.isDefined
                val hasOtherField = trimmedTitle.isDefined || request.appearance.isDefined || request.`type`.isDefined

                if (trimmedTitle.contains("")) {
                  complete(StatusCodes.BadRequest, ErrorResponse("title must not be blank"))
                } else if (!hasOtherField && !hasBinding) {
                  complete(StatusCodes.BadRequest, ErrorResponse("at least one field is required"))
                } else {
                  validatePanelTypeOpt(request.`type`) match {
                    case Left(err) =>
                      complete(StatusCodes.BadRequest, ErrorResponse(err))
                    case Right(panelTypeOpt) =>
                      val now           = Instant.now()
                      val appearanceOpt = request.appearance.map(p =>
                        PanelAppearance(
                          background   = RequestValidation.normalizePanelBackground(p.background),
                          color        = RequestValidation.normalizePanelColor(p.color),
                          transparency = RequestValidation.normalizeTransparency(p.transparency)
                        )
                      )

                      def applyTypeUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                        panelTypeOpt match {
                          case None     => Future.successful(panelOpt)
                          case Some(pt) => panelOpt match {
                            case None    => Future.successful(None)
                            case Some(_) => panelRepo.updateType(PanelId(panelId), pt, now)
                          }
                        }

                      def applyBindingUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                        if (!hasBinding) Future.successful(panelOpt)
                        else panelOpt match {
                          case None => Future.successful(None)
                          case Some(panel) =>
                            val newTypeId      = request.typeId.fold(panel.typeId)(_.map(DataTypeId(_)))
                            val newFieldMapping = request.fieldMapping.fold(panel.fieldMapping)(identity)
                            panelRepo.updateTypeBinding(PanelId(panelId), newTypeId, newFieldMapping, now)
                        }

                      val coreFuture: Future[Option[Panel]] =
                        if (!hasOtherField) {
                          panelRepo.findById(PanelId(panelId))
                        } else {
                          val titleFuture: Future[Option[Panel]] = trimmedTitle match {
                            case Some(title) =>
                              panelRepo.updateTitle(PanelId(panelId), title, now).flatMap { result =>
                                appearanceOpt match {
                                  case None             => applyTypeUpdate(result)
                                  case Some(appearance) =>
                                    result match {
                                      case None    => Future.successful(None)
                                      case Some(_) =>
                                        panelRepo.updateAppearance(PanelId(panelId), appearance, now)
                                          .flatMap(applyTypeUpdate)
                                    }
                                }
                              }
                            case None =>
                              appearanceOpt match {
                                case Some(appearance) =>
                                  panelRepo.updateAppearance(PanelId(panelId), appearance, now)
                                    .flatMap(applyTypeUpdate)
                                case None =>
                                  panelRepo.updateType(PanelId(panelId), panelTypeOpt.get, now)
                              }
                          }
                          titleFuture
                        }

                      onSuccess(coreFuture.flatMap(applyBindingUpdate)) {
                        case Some(panel) => complete(PanelResponse.fromDomain(panel))
                        case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                      }
                  }
                }
                }
              }
            }
          )
        },
        path(Segment / "duplicate") { panelId =>
          post {
            onSuccess(panelRepo.findById(PanelId(panelId))) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
              case Some(panel) if panel.ownerId != user.id =>
                complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
              case Some(_) =>
                onSuccess(panelRepo.duplicate(PanelId(panelId), user.id)) {
                  case Some(panel) => complete(StatusCodes.Created, PanelResponse.fromDomain(panel))
                  case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                }
            }
          }
        }
      )
    }

  private def validatePanelRequest(request: CreatePanelRequest): Either[String, DashboardId] =
    request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(DashboardId(id))
      case None     => Left("dashboardId is required")
    }

  private def validatePanelType(typeOpt: Option[String]): Either[String, PanelType] =
    typeOpt match {
      case None    => Right(PanelType.Default)
      case Some(t) => PanelType.fromString(t)
    }

  private def validatePanelTypeOpt(typeOpt: Option[String]): Either[String, Option[PanelType]] =
    typeOpt match {
      case None    => Right(None)
      case Some(t) => PanelType.fromString(t).map(Some(_))
    }
}