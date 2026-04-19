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
    userSessionRepo: UserSessionRepository,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = ""
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec = system.executionContext

  private val authDirectives = new AuthDirectives(userSessionRepo)
  private val aclDirective   = new AclDirective()
  private val health         = new HealthRoutes()
  private val auth           = new AuthRoutes(userRepo, googleClientId, googleClientSecret, googleRedirectUri)
  private val dataTypes      = new DataTypeRoutes(dataTypeRepo)
  private val dataSources    = new DataSourceRoutes(dataSourceRepo, dataTypeRepo, fileSystem)
  private val sources        = new SourceRoutes(dataSourceRepo, dataTypeRepo, connector)

  /** Resolvers for ACL ownership checks — each maps a resource ID to its owner's user ID string. */
  private def dashboardOwnerResolver(id: String): scala.concurrent.Future[Option[String]] =
    dashboardRepo.findById(com.helio.domain.DashboardId(id)).map(_.map(_.meta.createdBy))

  private def panelOwnerResolver(id: String): scala.concurrent.Future[Option[String]] =
    panelRepo.findById(com.helio.domain.PanelId(id)).map(_.map(_.meta.createdBy))

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
              new DashboardRoutes(dashboardRepo, panelRepo, authenticatedUser, aclDirective, dashboardOwnerResolver).routes,
              new PanelRoutes(panelRepo, dashboardRepo, authenticatedUser, aclDirective, panelOwnerResolver).routes,
              dataTypes.routes,
              dataSources.routes,
              sources.routes
            )
          }
        )
      }
}
