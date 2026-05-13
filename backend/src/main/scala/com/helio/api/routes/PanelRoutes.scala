package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.PanelIdSegment
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, DataTypeRepository, PanelRepository, ResourcePermissionRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}

final class PanelRoutes(
    panelRepo: PanelRepository,
    @annotation.unused dashboardRepo: DashboardRepository,
    dataTypeRepo: DataTypeRepository,
    @annotation.unused permissionRepo: ResourcePermissionRepository,
    aclDirective: AclDirective,
    user: AuthenticatedUser,
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private val patchService = new PanelPatchService(panelRepo, dataTypeRepo, user)

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
                              content     = request.content,
                              typeId      = request.dataTypeId.map(DataTypeId(_))
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
        path(PanelIdSegment) { panelId =>
          concat(
            delete {
              onSuccess(panelRepo.findById(panelId)) {
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
                        onSuccess(panelRepo.delete(panelId)) {
                          case true  => complete(StatusCodes.NoContent)
                          case false => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                        }
                    }
                  }
              }
            },
            patch {
              entity(as[UpdatePanelRequest]) { request =>
                onSuccess(panelRepo.findById(panelId)) {
                  case None =>
                    complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  case Some(existing) =>
                    aclDirective.authorizeResourceWithSharing(
                      "dashboard",
                      existing.dashboardId.value,
                      Some(user),
                      "Dashboard not found"
                    ) {
                      case ResourceAccess.Viewer =>
                        complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                      case ResourceAccess.Editor | ResourceAccess.Owner =>
                        patchService.resolvePatch(request) match {
                          case Left(err)   => complete(StatusCodes.BadRequest, ErrorResponse(err))
                          case Right(spec) =>
                            onSuccess(patchService.applyPanelPatch(panelId, spec)) {
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
        path(PanelIdSegment / "query") { panelId =>
          get {
            onSuccess(panelRepo.findById(panelId)) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
              case Some(panel) =>
                Panel.buildQuery(panel) match {
                  case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel is not bound to a data type"))
                  case Some(query) => complete(query)
                }
            }
          }
        },
        path(PanelIdSegment / "duplicate") { panelId =>
          post {
            onSuccess(panelRepo.findById(panelId)) {
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
                      onSuccess(panelRepo.duplicate(panelId, user.id)) {
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
}
