package com.helio.api

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api.routes._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository, ResourcePermissionRepository, UserRepository, UserSessionRepository}

import scala.util.{Failure, Success}

final class ApiRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    permissionRepo: ResourcePermissionRepository,
    fileSystem: FileSystem,
    connector: RestApiConnector,
    userRepo: UserRepository,
    userSessionRepo: UserSessionRepository,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = ""
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec = system.executionContext

  private val registry = new ResourceTypeRegistry(
    ResourceType("dashboard",   id => dashboardRepo.findById(com.helio.domain.DashboardId(id)).map(_.map(_.ownerId.value))),
    ResourceType("panel",       id => panelRepo.findById(com.helio.domain.PanelId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-source", id => dataSourceRepo.findById(com.helio.domain.DataSourceId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-type",   id => dataTypeRepo.findById(com.helio.domain.DataTypeId(id)).map(_.map(_.ownerId.value)))
  )

  private val authDirectives = new AuthDirectives(userSessionRepo)
  private val aclDirective   = new AclDirective(permissionRepo, registry)
  private val health         = new HealthRoutes()
  private val auth           = new AuthRoutes(userRepo, googleClientId, googleClientSecret, googleRedirectUri)

  val routes: Route =
    health.routes ~
      pathPrefix("api") {
        concat(
          pathPrefix("auth") { auth.routes },
          authDirectives.optionalAuthenticate { userOpt =>
            new PublicDashboardRoutes(dashboardRepo, panelRepo, permissionRepo, aclDirective, userOpt, Some(dataTypeRepo)).routes
          },
          authDirectives.authenticate { authenticatedUser =>
            concat(
              // GET /api/auth/me — returns the current user profile
              pathPrefix("auth") {
                path("me") {
                  get {
                    onComplete(userRepo.findById(authenticatedUser.id)) {
                      case Success(Some(user)) =>
                        complete(StatusCodes.OK, UserResponse.fromDomain(user))
                      case Success(None) =>
                        complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
                      case Failure(ex) =>
                        complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                    }
                  }
                }
              },
              new DashboardRoutes(dashboardRepo, panelRepo, authenticatedUser, Some(dataTypeRepo)).routes,
              new PanelRoutes(panelRepo, dashboardRepo, dataTypeRepo, permissionRepo, aclDirective, authenticatedUser).routes,
              new PermissionRoutes(dashboardRepo, permissionRepo, aclDirective, authenticatedUser).routes,
              new DataTypeRoutes(dataTypeRepo, aclDirective, authenticatedUser).routes,
              new DataSourceRoutes(dataSourceRepo, dataTypeRepo, fileSystem, aclDirective, authenticatedUser).routes,
              new SourceRoutes(dataSourceRepo, dataTypeRepo, connector, authenticatedUser).routes
            )
          }
        )
      }
}
