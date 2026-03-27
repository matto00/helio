package com.helio.api

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api.routes._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository}

final class ApiRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    fileSystem: FileSystem,
    connector: RestApiConnector
)(implicit system: ActorSystem[_])
    extends Directives {

  private val health      = new HealthRoutes()
  private val dashboards  = new DashboardRoutes(dashboardRepo, panelRepo)
  private val panels      = new PanelRoutes(panelRepo, dashboardRepo)
  private val dataTypes   = new DataTypeRoutes(dataTypeRepo)
  private val dataSources = new DataSourceRoutes(dataSourceRepo, dataTypeRepo, fileSystem)
  private val sources     = new SourceRoutes(dataSourceRepo, dataTypeRepo, connector)

  val routes: Route =
    health.routes ~
      pathPrefix("api") {
        concat(
          dashboards.routes,
          panels.routes,
          dataTypes.routes,
          dataSources.routes,
          sources.routes
        )
      }
}
