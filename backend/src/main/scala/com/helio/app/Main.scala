package com.helio.app

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.Behavior
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.api.http.CookieConfig
import com.helio.api.ApiRoutes
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.util.SystemClock
import com.helio.infrastructure.persistence.agents.{AgentMemoryRepository, AgentPreferencesRepository}
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, MfaRepository, ResourcePermissionRepository, SlickUserSessionRepository, UserPreferenceRepository, UserRepository}
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, DataTypeRepository, DataTypeRowRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.{Database, DbContext}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository, ImageUploadRepository}
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.sources.RestSourceConnectorMigration
import com.helio.infrastructure.storage.{GcsFileSystem, LocalFileSystem}
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.services.pipelines.PipelineSchedulerService
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
      val outputRepo         = new OutputRepository(ctx)
      val pipelineRunRepo    = new PipelineRunRepository(ctx)
      val dataTypeRowRepo    = new DataTypeRowRepository(ctx)
      val apiTokenRepo       = new ApiTokenRepository(ctx)
      val binaryRefRepo      = new BinaryRefRepository(ctx)
      val imageUploadRepo    = new ImageUploadRepository(ctx)
      val alertRuleRepo      = new AlertRuleRepository(ctx)
      // HEL-466: HEL-455 left this unconstructed, so /api/alerts and the
      // evaluation engine were both unreachable in production — fixes that
      // pre-existing gap (see proposal.md "Gap found during planning").
      val alertEventRepo     = new AlertEventRepository(ctx)
      val pipelineScheduleRepo = new PipelineScheduleRepository(ctx)
      // HEL-493: /api/metrics REST layer on top of HEL-446's MetricRepository.
      val metricRepo         = new MetricRepository(ctx)
      // HEL-472 (420-A): /api/preferences persistence for the in-app agent's authoring defaults.
      val agentPreferencesRepo = new AgentPreferencesRepository(ctx)
      // HEL-478 (420-B): /api/agent/memory persistence for the in-app agent's free-form memory.
      val agentMemoryRepo = new AgentMemoryRepository(ctx)
      // HEL-702: TOTP MFA — raw Slick Database, not DbContext (no RLS; read
      // pre-identity on the login path, like userRepo/userSessionRepo above).
      val mfaRepo = new MfaRepository(db)
      // HEL-471/HEL-477: audit event append-only store, wired into every
      // mutating service via ApiRoutes(auditEventRepo = ...) below.
      val auditEventRepo = new AuditEventRepository(ctx)

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

      DemoData.seedIfEmpty(dashboardRepo, panelRepo, dataSourceRepo, pipelineRepo, outputRepo)

      // HEL-256: surface any data_sources rows that lack a linked DataType
      // (orphans render empty schemas on the Sources page). Defense-in-depth
      // beside DataTypeService.delete guard and refresh upsert primitive.
      SourceSchemaHealthCheck.run(ctx, logger)

      // HEL-822 task 8.3: injected ConnectorRepository/ConnectorCredentialRepository, wired
      // as optional/defaulted constructor params so the 20 fetchOverride-based test
      // constructions of RestApiConnectorDriver keep compiling unchanged.
      val connectorMasterKeyProvider = new EnvMasterKeyProvider()
      val connectorSecretBackend     = new EncryptedSecretBackend(connectorMasterKeyProvider)
      val connectorCredentialRepo    = new ConnectorCredentialRepository(ctx, connectorSecretBackend)
      val connectorRepo              = new ConnectorRepository(ctx, connectorCredentialRepo)
      val connector = new RestApiConnectorDriver(
        connectorRepoOpt = Some(connectorRepo),
        credentialRepoOpt = Some(connectorCredentialRepo)
      )

      // HEL-822 design.md Decision 7: idempotent startup migration, after Flyway
      // (Database.initApp above) and before HttpServer.start below — the backend does not
      // begin serving traffic on a REST source until any legacy rows it owns have either
      // been migrated or explicitly logged as failed-and-skipped.
      val migrationDone: Future[Unit] = RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, logger)

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
      // HEL-287 D1: COOKIE_SECURE drives both the session cookie's `Secure`
      // attribute and its derived `SameSite` (None iff secure, else Lax) —
      // see CookieConfig and design.md for the deployment-topology evidence.
      val cookieConfig = CookieConfig.fromEnv()
      logger.info("Session cookie config: secure={} sameSite={}", cookieConfig.secure, cookieConfig.sameSite)
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
        imageUploadRepo,
        googleClientId,
        googleClientSecret,
        googleRedirectUri,
        corsAllowedOrigins,
        cookieConfig,
        alertRuleRepo = alertRuleRepo,
        alertEventRepo = alertEventRepo,
        pipelineScheduleRepo = pipelineScheduleRepo,
        dbContext = ctx,
        metricRepo = metricRepo,
        agentPreferencesRepo = agentPreferencesRepo,
        agentMemoryRepo = agentMemoryRepo,
        mfaRepo = mfaRepo,
        auditEventRepo = auditEventRepo
      )

      // HEL-415: scheduler runtime — reuses apiRoutes.pipelineRunService so
      // scheduled runs share the manual-run path's PipelineRunCache/
      // PipelineRunRegistry (design.md Decision 5).
      val schedulerTickInterval = config.getInt("helio.scheduler.tick-interval-seconds").seconds
      val pipelineSchedulerService = new PipelineSchedulerService(
        pipelineScheduleRepo,
        pipelineRepo,
        pipelineRunRepo,
        apiRoutes.pipelineRunService,
        SystemClock
      )
      context.spawn(PipelineSchedulerActor(pipelineSchedulerService, schedulerTickInterval), "pipeline-scheduler")

      // HEL-822 design.md Decision 7: the migration future is awaited (via flatMap, not
      // blocked) before HttpServer.start — the backend does not begin serving traffic on a
      // REST source until any legacy rows it owns have either been migrated or explicitly
      // logged as failed-and-skipped. A hard failure of the migration future itself (as
      // opposed to a per-row skip, which the migration handles internally) is logged and the
      // server still starts, rather than hanging startup forever on an unexpected error.
      migrationDone
        .recover { case e =>
          logger.error("RestSourceConnectorMigration failed unexpectedly; continuing startup", e)
        }
        .flatMap(_ => HttpServer.start(apiRoutes.routes, host, port))
        .onComplete {
        case Success(binding) =>
          logger.info("Helio backend listening on {}", binding.localAddress)
        case Failure(exception) =>
          logger.error("Failed to start HTTP server", exception)
          system.terminate()
      }(context.executionContext)

      Behaviors.empty
    }
}
