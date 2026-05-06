package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.HttpOrigin
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.cors.scaladsl.CorsDirectives._
import org.apache.pekko.http.cors.scaladsl.model.HttpOriginMatcher
import org.apache.pekko.http.cors.scaladsl.settings.CorsSettings
import com.helio.api.routes._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository, PipelineRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}

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
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = "",
    corsAllowedOrigins: Seq[String] = Seq("http://localhost:5173")
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec = system.executionContext

  private val registry = new ResourceTypeRegistry(
    ResourceType("dashboard",   id => dashboardRepo.findById(com.helio.domain.DashboardId(id)).map(_.map(_.ownerId.value))),
    ResourceType("panel",       id => panelRepo.findById(com.helio.domain.PanelId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-source", id => dataSourceRepo.findById(com.helio.domain.DataSourceId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-type",   id => dataTypeRepo.findById(com.helio.domain.DataTypeId(id)).map(_.map(_.ownerId.value)))
  )

  private val authDirectives = new AuthDirectives(userSessionRepo)
  private val aclDirective   = new AclDirective(permissionRepo, registry)
  private val health         = new HealthRoutes()
  private val auth           = new AuthRoutes(userRepo, googleClientId, googleClientSecret, googleRedirectUri)

  private val corsSettings = CorsSettings.defaultSettings
    .withAllowedOrigins(HttpOriginMatcher(corsAllowedOrigins.map(HttpOrigin(_)): _*))
    .withAllowedMethods(Seq(HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.PATCH, HttpMethods.DELETE, HttpMethods.HEAD, HttpMethods.OPTIONS))

  val routes: Route =
    cors(corsSettings) {
      health.routes ~
        pathPrefix("api") {
          concat(
            pathPrefix("auth") { auth.routes },
            authDirectives.optionalAuthenticate { userOpt =>
              new PublicDashboardRoutes(dashboardRepo, panelRepo, permissionRepo, aclDirective, userOpt, Some(dataTypeRepo)).routes
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
                        val futures = scala.collection.mutable.ListBuffer[scala.concurrent.Future[Unit]]()

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
                            futures += userPreferenceRepo.upsertDashboardZoom(userId, com.helio.domain.DashboardId(dashId), zoom)
                          }
                        }

                        val updateFuture = scala.concurrent.Future.sequence(futures.toSeq)
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
                new DashboardRoutes(dashboardRepo, panelRepo, authenticatedUser, Some(dataTypeRepo)).routes,
                new PanelRoutes(panelRepo, dashboardRepo, dataTypeRepo, permissionRepo, aclDirective, authenticatedUser).routes,
                new PermissionRoutes(dashboardRepo, permissionRepo, aclDirective, authenticatedUser).routes,
                new DataTypeRoutes(dataTypeRepo, aclDirective, authenticatedUser).routes,
                new DataSourceRoutes(dataSourceRepo, dataTypeRepo, fileSystem, aclDirective, authenticatedUser).routes,
                new SourceRoutes(dataSourceRepo, dataTypeRepo, connector, authenticatedUser).routes,
                new PipelineRoutes(pipelineRepo).routes
              )
            }
          )
        }
    }
}
