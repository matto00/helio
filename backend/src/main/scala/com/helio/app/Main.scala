package com.helio.app

import akka.actor.typed.ActorSystem
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.api.ApiRoutes
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{Database, DashboardRepository, DataSourceRepository, DataTypeRepository, LocalFileSystem, PanelRepository}
import com.typesafe.config.ConfigFactory

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt
import scala.util.Failure
import scala.util.Success

object Main {
  def main(args: Array[String]): Unit = {
    val system = ActorSystem[Nothing](guardian(), "helio")
    Await.result(system.whenTerminated, 24.hours)
  }

  private def guardian(): Behavior[Nothing] =
    Behaviors.setup[Nothing] { context =>
      implicit val system: ActorSystem[Nothing] = context.system
      implicit val ec = context.executionContext
      val logger = system.log

      val config = ConfigFactory.load()
      val db     = Database.init(config)

      val dashboardRepo   = new DashboardRepository(db)
      val panelRepo       = new PanelRepository(db)
      val dataSourceRepo  = new DataSourceRepository(db)
      val dataTypeRepo    = new DataTypeRepository(db)
      val fileSystem      = LocalFileSystem.fromEnv()

      DemoData.seedIfEmpty(dashboardRepo, panelRepo)

      val connector = new RestApiConnector()
      val host      = sys.env.getOrElse("HELIO_HTTP_HOST", "0.0.0.0")
      val port      = sys.env.get("HELIO_HTTP_PORT").flatMap(_.toIntOption).getOrElse(8080)
      val apiRoutes = new ApiRoutes(dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, fileSystem, connector)

      HttpServer.start(apiRoutes.routes, host, port).onComplete {
        case Success(binding) =>
          logger.info("Helio backend listening on {}", binding.localAddress)
        case Failure(exception) =>
          logger.error("Failed to start HTTP server", exception)
          system.terminate()
      }(context.executionContext)

      Behaviors.empty
    }
}
