package com.helio.app

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.Behavior
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.api.ApiRoutes
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{ApiTokenRepository, BinaryRefRepository, Database, DashboardRepository, DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext, GcsFileSystem, LocalFileSystem, PanelRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository}
import com.typesafe.config.ConfigFactory

import scala.concurrent.{Await, Future}
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

      val config      = ConfigFactory.load()
      // HEL-274: two pools — app (non-privileged) and privileged (BYPASSRLS).
      // initApp runs Flyway migrations; initPrivileged opens the pool only.
      // DbContext routes withUserContext → app pool, withSystemContext → privileged pool.
      val db          = Database.initApp(config)
      val privilegedDb = Database.initPrivileged(config)
      val ctx         = new DbContext(db, privilegedDb)

      def requireEnv(name: String): String =
        sys.env.get(name).filter(_.nonEmpty).getOrElse {
          logger.error(s"Missing required environment variable: $name")
          system.terminate()
          throw new IllegalStateException(s"Missing required environment variable: $name")
        }

      val googleClientId     = requireEnv("GOOGLE_CLIENT_ID")
      val googleClientSecret = requireEnv("GOOGLE_CLIENT_SECRET")
      val googleRedirectUri  = requireEnv("GOOGLE_REDIRECT_URI")

      val dashboardRepo      = new DashboardRepository(ctx)
      val panelRepo          = new PanelRepository(ctx)
      val dataSourceRepo     = new DataSourceRepository(ctx)
      val dataTypeRepo       = new DataTypeRepository(ctx)
      val userRepo           = new UserRepository(db)
      val userSessionRepo    = new SlickUserSessionRepository(db)
      val userPreferenceRepo = new UserPreferenceRepository(db)
      val permissionRepo     = new ResourcePermissionRepository(ctx)
      val pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
      val pipelineStepRepo   = new PipelineStepRepository(ctx)
      val pipelineRunRepo    = new PipelineRunRepository(ctx)
      val dataTypeRowRepo    = new DataTypeRowRepository(ctx)
      val apiTokenRepo       = new ApiTokenRepository(ctx)
      val binaryRefRepo      = new BinaryRefRepository(ctx)

      val fileSystem = sys.env.get("HELIO_UPLOADS_BACKEND").map(_.toLowerCase) match {
        case None | Some("local") => LocalFileSystem.fromEnv()
        case Some("gcs") => GcsFileSystem.fromEnv()
        case Some(unknown) =>
          logger.error("Unknown HELIO_UPLOADS_BACKEND value: {}. Supported values: local, gcs", unknown)
          system.terminate()
          throw new IllegalStateException(s"Unknown HELIO_UPLOADS_BACKEND value: $unknown")
      }

      val sparkMasterUrl    = config.getString("spark.masterUrl")
      val pipelineRunCache  = new PipelineRunCache()
      val sparkJobSubmitter = new SparkJobSubmitter(sparkMasterUrl, dataSourceRepo, pipelineRepo, pipelineRunRepo)
      // Eagerly initialise SparkSession to absorb cold-start penalty
      Future(sparkJobSubmitter.initialize())(ec)

      DemoData.seedIfEmpty(dashboardRepo, panelRepo)

      // HEL-256: surface any data_sources rows that lack a linked DataType
      // (orphans render empty schemas on the Sources page). Defense-in-depth
      // beside DataTypeService.delete guard and refresh upsert primitive.
      SourceSchemaHealthCheck.run(ctx, logger)

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
        pipelineStepRepo,
        pipelineRunCache,
        sparkJobSubmitter,
        pipelineRunRepo,
        dataTypeRowRepo,
        apiTokenRepo,
        binaryRefRepo,
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
