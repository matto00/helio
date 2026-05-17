package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.HttpOrigin
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.cors.scaladsl.CorsDirectives._
import org.apache.pekko.http.cors.scaladsl.model.HttpOriginMatcher
import org.apache.pekko.http.cors.scaladsl.settings.CorsSettings
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.routes._
import com.helio.domain.{DashboardId, DataSourceId, DataTypeId, PanelId, PipelineId, RestApiConnector}
import com.helio.services.{AuthService, DashboardService, DataSourceService, DataTypeService, PanelService, PermissionService, PipelineRunService, PipelineService, SourceService}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, DataTypeRowRepository, FileSystem, PanelRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}

import scala.collection.mutable.ListBuffer
import scala.concurrent.Future
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
    userPreferenceRepo: UserPreferenceRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    pipelineRunCache: PipelineRunCache,
    sparkJobSubmitter: SparkJobSubmitter,
    pipelineRunRepo: PipelineRunRepository = null,
    dataTypeRowRepo: DataTypeRowRepository = null,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = "",
    corsAllowedOrigins: Seq[String] = Seq("http://localhost:5173")
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec = system.executionContext
  private implicit val mat: Materializer = SystemMaterializer(system).materializer

  private val registry = new ResourceTypeRegistry(
    ResourceType("dashboard",   id => dashboardRepo.findById(DashboardId(id)).map(_.map(_.ownerId.value))),
    ResourceType("panel",       id => panelRepo.findById(PanelId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-source", id => dataSourceRepo.findById(DataSourceId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-type",   id => dataTypeRepo.findById(DataTypeId(id)).map(_.map(_.ownerId.value))),
    ResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
  )

  private val authDirectives = new AuthDirectives(userSessionRepo)
  private val aclDirective   = new AclDirective(permissionRepo, registry)
  private val runRegistry    = new PipelineRunRegistry()
  private val health         = new HealthRoutes()

  // Services
  private val accessChecker     = new AccessCheckerImpl(permissionRepo, registry)
  private val authService       = new AuthService(userRepo)
  private val dashboardService  = new DashboardService(dashboardRepo)
  private val panelService      = new PanelService(panelRepo, dataTypeRepo, accessChecker)
  private val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, accessChecker)
  private val sourceService     = new SourceService(dataSourceRepo, dataTypeRepo, connector)
  private val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo, accessChecker)
  private val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataTypeRepo)
  private val pipelineRunService = new PipelineRunService(
    pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo,
    dataTypeRowRepo, pipelineRunCache, runRegistry, fileSystem
  )
  private val permissionService = new PermissionService(permissionRepo, accessChecker)

  private val auth  = new AuthRoutes(authService)
  private val oauth = new OAuthRoutes(authService, googleClientId, googleClientSecret, googleRedirectUri)

  private val corsSettings = CorsSettings.defaultSettings
    .withAllowedOrigins(HttpOriginMatcher(corsAllowedOrigins.map(HttpOrigin(_)): _*))
    .withAllowedMethods(Seq(HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.PATCH, HttpMethods.DELETE, HttpMethods.HEAD, HttpMethods.OPTIONS))

  val routes: Route =
    cors(corsSettings) {
      health.routes ~
        pathPrefix("api") {
          concat(
            pathPrefix("auth") { concat(auth.routes, oauth.routes) },
            authDirectives.optionalAuthenticate { userOpt =>
              new PublicDashboardRoutes(panelRepo, panelService, aclDirective, userOpt).routes
            },
            authDirectives.authenticate { authenticatedUser =>
              concat(
                // GET /api/auth/me — returns the current user profile
                pathPrefix("auth") {
                  path("me") {
                    get {
                      val userFuture = userRepo.findById(authenticatedUser.id)
                      val prefsFuture = userPreferenceRepo.getPreferences(authenticatedUser.id)

                      onComplete(userFuture.zip(prefsFuture)) {
                        case Success((Some(user), prefs)) =>
                          val userResponse = UserResponse.fromDomain(user).copy(
                            preferences = Some(UserPreferences(prefs.accentColor, prefs.zoomLevels))
                          )
                          complete(StatusCodes.OK, userResponse)
                        case Success((None, _)) =>
                          complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
                        case Failure(ex) =>
                          complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                      }
                    }
                  }
                },
                pathPrefix("users") {
                  path("me" / "update") {
                    patch {
                      entity(as[UpdateUserPreferenceRequest]) { req =>
                        val userId = authenticatedUser.id
                        val futures = ListBuffer[Future[Unit]]()

                        if (req.fields.contains("accentColor")) {
                          req.user.accentColor.foreach { color =>
                            futures += userPreferenceRepo.upsertGlobalPrefs(userId, color)
                          }
                        }

                        if (req.fields.contains("zoomLevel")) {
                          for {
                            zoom <- req.user.zoomLevel
                            dashId <- req.user.dashboardId
                          } {
                            futures += userPreferenceRepo.upsertDashboardZoom(userId, DashboardId(dashId), zoom)
                          }
                        }

                        val updateFuture = Future.sequence(futures.toSeq)
                        onComplete(updateFuture.flatMap(_ => userPreferenceRepo.getPreferences(userId))) {
                          case Success(prefs) =>
                            complete(StatusCodes.OK, UserPreferences(prefs.accentColor, prefs.zoomLevels))
                          case Failure(ex) =>
                            complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                        }
                      }
                    }
                  }
                },
                new DashboardRoutes(dashboardService, authenticatedUser).routes,
                new DashboardSnapshotRoutes(dashboardService, authenticatedUser).routes,
                new PanelRoutes(panelService, authenticatedUser).routes,
                new PermissionRoutes(permissionService, authenticatedUser).routes,
                new DataTypeRoutes(dataTypeService, authenticatedUser).routes,
                new DataSourceRoutes(dataSourceService, authenticatedUser).routes,
                new DataSourcePreviewRoutes(dataSourceService, authenticatedUser).routes,
                new SourceRoutes(sourceService, authenticatedUser).routes,
                new SourcePreviewRoutes(sourceService, authenticatedUser).routes,
                new PipelineRoutes(pipelineService, authenticatedUser).routes,
                new PipelineStepRoutes(pipelineService, authenticatedUser).routes,
                new PipelineRunSubmitRoutes(pipelineRunService, authenticatedUser).routes,
                new PipelineRunStatusRoutes(pipelineRunService, authenticatedUser).routes,
                new PipelineRunHistoryRoutes(pipelineRunService, authenticatedUser).routes,
                new PipelineRunStreamRoutes(pipelineRunService, authenticatedUser).routes
              )
            }
          )
        }
    }
}
