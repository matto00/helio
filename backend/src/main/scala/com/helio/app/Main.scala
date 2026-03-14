package com.helio.app

import akka.actor.typed.ActorSystem
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.api.ApiRoutes

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
      val logger = system.log
      val seedData = DemoData.build()

      val dashboardRegistry =
        context.spawn(DashboardRegistryActor(seedData.dashboards), "dashboard-registry")
      val panelRegistry = context.spawn(PanelRegistryActor(seedData.panels), "panel-registry")
      val host = sys.env.getOrElse("HELIO_HTTP_HOST", "0.0.0.0")
      val port = sys.env.get("HELIO_HTTP_PORT").flatMap(_.toIntOption).getOrElse(8080)
      val apiRoutes = new ApiRoutes(dashboardRegistry, panelRegistry)

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
