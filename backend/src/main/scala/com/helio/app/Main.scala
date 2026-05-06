package com.helio.app

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.Behavior
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.api.ApiRoutes
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{Database, DashboardRepository, DataSourceRepository, DataTypeRepository, LocalFileSystem, PanelRepository, PipelineRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository}
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

      def requireEnv(name: String): String =
        sys.env.get(name).filter(_.nonEmpty).getOrElse {
          logger.error(s"Missing required environment variable: $name")
          system.terminate()
          throw new IllegalStateException(s"Missing required environment variable: $name")
        }

      val googleClientId     = requireEnv("GOOGLE_CLIENT_ID")
      val googleClientSecret = requireEnv("GOOGLE_CLIENT_SECRET")
      val googleRedirectUri  = requireEnv("GOOGLE_REDIRECT_URI")

      val dashboardRepo      = new DashboardRepository(db)
      val panelRepo          = new PanelRepository(db)
      val dataSourceRepo     = new DataSourceRepository(db)
      val dataTypeRepo       = new DataTypeRepository(db)
      val userRepo           = new UserRepository(db)
      val userSessionRepo    = new SlickUserSessionRepository(db)
      val userPreferenceRepo = new UserPreferenceRepository(db)
      val permissionRepo     = new ResourcePermissionRepository(db)
      val pipelineRepo       = new PipelineRepository(db)
      val fileSystem         = LocalFileSystem.fromEnv()

      DemoData.seedIfEmpty(dashboardRepo, panelRepo)

      val connector = new RestApiConnector()
      val host      = sys.env.getOrElse("HELIO_HTTP_HOST", "0.0.0.0")
      val port      = sys.env.get("PORT")
        .orElse(sys.env.get("HELIO_HTTP_PORT"))
        .flatMap(_.toIntOption)
        .getOrElse(8080)
      val corsAllowedOrigins = sys.env
        .getOrElse("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
        .split(",")
        .map(_.trim)
        .filter(_.nonEmpty)
        .toSeq
      logger.info("CORS allowed origins: {}", corsAllowedOrigins.mkString(", "))
      val apiRoutes = new ApiRoutes(
        dashboardRepo,
        panelRepo,
        dataSourceRepo,
        dataTypeRepo,
        permissionRepo,
        fileSystem,
        connector,
        userRepo,
        userSessionRepo,
        userPreferenceRepo,
        pipelineRepo,
        googleClientId,
        googleClientSecret,
        googleRedirectUri,
        corsAllowedOrigins
      )

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
