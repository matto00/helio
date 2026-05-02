package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, DataTypeRepository, PanelRepository, ResourcePermissionRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}

final class PanelRoutes(
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataTypeRepo: DataTypeRepository,
    permissionRepo: ResourcePermissionRepository,
    aclDirective: AclDirective,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  /** Resolve a panel's typeId against the authenticated user's owned types.
   *  If the panel's typeId references a type owned by a different user, the
   *  typeId and fieldMapping are cleared (treated as unbound). */
  private def resolveTypeBinding(panel: Panel): Future[Panel] =
    panel.typeId match {
      case None => Future.successful(panel)
      case Some(typeId) =>
        dataTypeRepo.findById(typeId, user.id).map {
          case None    => panel.copy(typeId = None, fieldMapping = None)
          case Some(_) => panel
        }
    }

  private def resolvePanels(panels: Vector[Panel]): Future[Vector[Panel]] =
    Future.traverse(panels)(resolveTypeBinding)

  val routes: Route =
    pathPrefix("panels") {
      concat(
        path("updateBatch") {
          post {
            entity(as[UpdatePanelsBatchRequest]) { request =>
              if (request.panels.isEmpty) {
                complete(StatusCodes.BadRequest, ErrorResponse("panels must not be empty"))
              } else {
                onSuccess(Future.traverse(request.panels)(item => panelRepo.findById(PanelId(item.id)))) { panelOpts =>
                  val missing = request.panels.zip(panelOpts).collectFirst { case (item, None) => item.id }
                  missing match {
                    case Some(id) =>
                      complete(StatusCodes.NotFound, ErrorResponse(s"Panel '$id' not found"))
                    case None =>
                      val panels = panelOpts.flatten
                      panels.find(_.ownerId != user.id) match {
                        case Some(_) =>
                          complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                        case None =>
                          val now = Instant.now()
                          onComplete(panelRepo.batchUpdate(request.panels, now)) {
                            case scala.util.Success(updated) =>
                              complete(UpdatePanelsBatchResponse(updated.map(PanelResponse.fromDomain)))
                            case scala.util.Failure(ex) =>
                              complete(StatusCodes.BadRequest, ErrorResponse(ex.getMessage))
                          }
                      }
                  }
                }
              }
            }
          }
        },
        pathEndOrSingleSlash {
          post {
            entity(as[CreatePanelRequest]) { request =>
              validatePanelRequest(request) match {
                case Left(error) =>
                  complete(StatusCodes.BadRequest, ErrorResponse(error))
                case Right(dashboardId) =>
                  aclDirective.authorizeResourceWithSharing(
                    "dashboard",
                    dashboardId.value,
                    Some(user),
                    "Dashboard not found"
                  ) { access =>
                    access match {
                      case ResourceAccess.Viewer =>
                        complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                      case ResourceAccess.Editor | ResourceAccess.Owner =>
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
                              ownerId     = user.id,
                              content     = request.content
                            )
                            onSuccess(panelRepo.insert(panel)) { created =>
                              complete(StatusCodes.Created, PanelResponse.fromDomain(created))
                            }
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
                case Some(panel) =>
                  aclDirective.authorizeResourceWithSharing(
                    "dashboard",
                    panel.dashboardId.value,
                    Some(user),
                    "Dashboard not found"
                  ) { access =>
                    access match {
                      case ResourceAccess.Viewer =>
                        complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                      case ResourceAccess.Editor | ResourceAccess.Owner =>
                        onSuccess(panelRepo.delete(PanelId(panelId))) {
                          case true  => complete(StatusCodes.NoContent)
                          case false => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                        }
                    }
                  }
              }
            },
            patch {
              entity(as[UpdatePanelRequest]) { request =>
                onSuccess(panelRepo.findById(PanelId(panelId))) {
                  case None =>
                    complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  case Some(existing) =>
                    aclDirective.authorizeResourceWithSharing(
                      "dashboard",
                      existing.dashboardId.value,
                      Some(user),
                      "Dashboard not found"
                    ) { access =>
                      access match {
                        case ResourceAccess.Viewer =>
                          complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                        case ResourceAccess.Editor | ResourceAccess.Owner =>
                    val trimmedTitle  = request.title.map(_.trim)
                    val hasBinding    = request.typeId.isDefined || request.fieldMapping.isDefined
                    val hasContent    = request.content.isDefined
                    val hasImage      = request.imageUrl.isDefined || request.imageFit.isDefined
                    val hasOtherField = trimmedTitle.isDefined || request.appearance.isDefined || request.`type`.isDefined || hasContent

                    if (trimmedTitle.contains("")) {
                      complete(StatusCodes.BadRequest, ErrorResponse("title must not be blank"))
                    } else if (!hasOtherField && !hasBinding && !hasImage) {
                      complete(StatusCodes.BadRequest, ErrorResponse("at least one field is required"))
                    } else {
                      RequestValidation.validateImageFit(request.imageFit) match {
                        case Left(err) =>
                          complete(StatusCodes.BadRequest, ErrorResponse(err))
                        case Right(_) =>
                      validatePanelTypeOpt(request.`type`) match {
                        case Left(err) =>
                          complete(StatusCodes.BadRequest, ErrorResponse(err))
                        case Right(panelTypeOpt) =>
                          val now           = Instant.now()
                          val appearanceOpt = request.appearance.map(p =>
                            PanelAppearance(
                              background   = RequestValidation.normalizePanelBackground(p.background),
                              color        = RequestValidation.normalizePanelColor(p.color),
                              transparency = RequestValidation.normalizeTransparency(p.transparency),
                              chart        = p.chart
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

                          def applyContentUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                            if (!hasContent) Future.successful(panelOpt)
                            else panelOpt match {
                              case None    => Future.successful(None)
                              case Some(_) => panelRepo.updateContent(PanelId(panelId), request.content, now)
                            }

                          def applyBindingUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                            if (!hasBinding) Future.successful(panelOpt)
                            else panelOpt match {
                              case None => Future.successful(None)
                              case Some(panel) =>
                                val newTypeId       = request.typeId.fold(panel.typeId)(_.map(DataTypeId(_)))
                                val newFieldMapping = request.fieldMapping.fold(panel.fieldMapping)(identity)
                                panelRepo.updateTypeBinding(PanelId(panelId), newTypeId, newFieldMapping, now)
                            }

                          def applyImageUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                            if (!hasImage) Future.successful(panelOpt)
                            else panelOpt match {
                              case None    => Future.successful(None)
                              case Some(_) => panelRepo.updateImage(PanelId(panelId), request.imageUrl, request.imageFit, now)
                            }

                          val coreFuture: Future[Option[Panel]] =
                            if (!hasOtherField) {
                              panelRepo.findById(PanelId(panelId))
                            } else {
                              val titleFuture: Future[Option[Panel]] = trimmedTitle match {
                                case Some(title) =>
                                  panelRepo.updateTitle(PanelId(panelId), title, now).flatMap { result =>
                                    appearanceOpt match {
                                      case None             => applyTypeUpdate(result).flatMap(applyContentUpdate)
                                      case Some(appearance) =>
                                        result match {
                                          case None    => Future.successful(None)
                                          case Some(_) =>
                                            panelRepo.updateAppearance(PanelId(panelId), appearance, now)
                                              .flatMap(applyTypeUpdate)
                                              .flatMap(applyContentUpdate)
                                        }
                                    }
                                  }
                                case None =>
                                  appearanceOpt match {
                                    case Some(appearance) =>
                                      panelRepo.updateAppearance(PanelId(panelId), appearance, now)
                                        .flatMap(applyTypeUpdate)
                                        .flatMap(applyContentUpdate)
                                    case None =>
                                      if (panelTypeOpt.isDefined)
                                        panelRepo.updateType(PanelId(panelId), panelTypeOpt.get, now)
                                          .flatMap(applyContentUpdate)
                                      else
                                        panelRepo.updateContent(PanelId(panelId), request.content, now)
                                  }
                              }
                              titleFuture
                            }

                          onSuccess(coreFuture.flatMap(applyBindingUpdate).flatMap(applyImageUpdate).flatMap {
                            case None        => Future.successful(None)
                            case Some(panel) => resolveTypeBinding(panel).map(Some(_))
                          }) {
                            case Some(panel) => complete(PanelResponse.fromDomain(panel))
                            case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                          }
                      }
                      }
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
              case Some(panel) =>
                aclDirective.authorizeResourceWithSharing(
                  "dashboard",
                  panel.dashboardId.value,
                  Some(user),
                  "Dashboard not found"
                ) { access =>
                  access match {
                    case ResourceAccess.Viewer =>
                      complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                    case ResourceAccess.Editor | ResourceAccess.Owner =>
                      onSuccess(panelRepo.duplicate(PanelId(panelId), user.id)) {
                        case Some(panel) => complete(StatusCodes.Created, PanelResponse.fromDomain(panel))
                        case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                      }
                  }
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
