package com.helio.api

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api.routes._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository, UserRepository, UserSessionRepository}

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
    extends Directives {

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
          authDirectives.authenticate { user =>
            concat(
              new DashboardRoutes(dashboardRepo, panelRepo, user).routes,
              new PanelRoutes(panelRepo, dashboardRepo, user).routes,
              dataTypes.routes,
              dataSources.routes,
              sources.routes
            )
          }
        )
      }
}
