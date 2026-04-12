package com.helio.api

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api.routes._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository, UserRepository, UserSessionRepository}

import scala.util.{Failure, Success}

final class ApiRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    fileSystem: FileSystem,
    connector: RestApiConnector,
    userRepo: UserRepository,
    userSessionRepo: UserSessionRepository
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec = system.executionContext

  private val authDirectives = new AuthDirectives(userSessionRepo)
  private val health         = new HealthRoutes()
  private val auth           = new AuthRoutes(userRepo)
  private val dataTypes      = new DataTypeRoutes(dataTypeRepo)
  private val dataSources    = new DataSourceRoutes(dataSourceRepo, dataTypeRepo, fileSystem)
  private val sources        = new SourceRoutes(dataSourceRepo, dataTypeRepo, connector)

  val routes: Route =
    health.routes ~
      pathPrefix("api") {
        concat(
          pathPrefix("auth") { auth.routes },
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
              new DashboardRoutes(dashboardRepo, panelRepo, authenticatedUser).routes,
              new PanelRoutes(panelRepo, dashboardRepo, authenticatedUser).routes,
              dataTypes.routes,
              dataSources.routes,
              sources.routes
            )
          }
        )
      }
}
