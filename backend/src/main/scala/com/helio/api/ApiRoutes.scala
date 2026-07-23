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
import com.helio.services.{AlertEvaluationService, AlertEventService, AlertRuleService, ApiTokenService, AuthService, ContentSourceSupport, DashboardProposalService, DashboardService, DataSourceService, DataTypeService, ImageUploadService, PanelService, PermissionService, PipelinePermissionService, PipelineRunService, PipelineService, SourceService}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.infrastructure.{AlertEventRepository, AlertRuleRepository, ApiTokenRepository, BinaryRefRepository, DashboardRepository, DataSourceRepository, DataTypeRepository, DataTypeRowRepository, FileSystem, ImageUploadRepository, PanelRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import org.slf4j.LoggerFactory

import java.net.InetAddress
import scala.collection.mutable.ListBuffer
import scala.concurrent.Future
import scala.util.{Failure, Success, Try}

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
    apiTokenRepo: ApiTokenRepository = null,
    // HEL-216: first real caller of BinaryRefRepository.overwriteForDataType
    // (HEL-217 shipped the class with no wired caller). Nullable default
    // mirrors pipelineRunRepo/dataTypeRowRepo — fixtures that don't pass one
    // simply skip the binary_refs write (PipelineRunService's null-checked
    // pattern).
    binaryRefRepo: BinaryRefRepository = null,
    // HEL-246: nullable default mirrors apiTokenRepo/binaryRefRepo above —
    // fixtures that don't pass one simply don't get the
    // /api/uploads/image routes mounted (imageUploadServiceOpt.fold(reject)).
    imageUploadRepo: ImageUploadRepository = null,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = "",
    corsAllowedOrigins: Seq[String] = Seq("http://localhost:5173"),
    // HEL-287: default preserves existing test fixtures that construct
    // ApiRoutes without an explicit cookie config (dev-shaped: not Secure).
    cookieConfig: CookieConfig = CookieConfig(secure = false),
    // HEL-215 cycle-2 SSRF fix: real DNS resolution in production (never
    // overridden by Main.scala); tests may inject a fake resolver so a
    // known local-test-server hostname can be exercised end-to-end without
    // weakening the guard for any other host (see DataSourceService).
    dataSourceUrlResolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    // HEL-215 cycle-3 fix: real (host-agnostic) denylist in production (never
    // overridden by Main.scala); tests may admit a single known-safe test
    // hostname without weakening the guard for any other host (see
    // DataSourceService — this is the seam that replaced the now-removed
    // "lying resolver" test pattern once fetchUrl started pinning the actual
    // TCP connection to the resolved address).
    dataSourceUrlIsBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr),
    // HEL-447: nullable-optional wiring mirrors apiTokenRepo/binaryRefRepo/
    // imageUploadRepo above — fixtures that don't pass an AlertRuleRepository
    // simply don't get the /api/alert-rules routes mounted
    // (alertRuleServiceOpt.fold(reject)). Appended last (rather than beside
    // the other nullable repos) so it stays purely additive for every
    // existing positional caller of this constructor.
    alertRuleRepo: AlertRuleRepository = null,
    // HEL-455: same nullable-optional wiring pattern as alertRuleRepo above —
    // fixtures that don't pass an AlertEventRepository simply don't get the
    // /api/alerts routes mounted (alertEventServiceOpt.fold(reject)).
    // Appended last for the same purely-additive reason.
    alertEventRepo: AlertEventRepository = null
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private val log = LoggerFactory.getLogger(getClass)

  private implicit val ec = system.executionContext
  private implicit val mat: Materializer = SystemMaterializer(system).materializer

  // Privileged callsite: resolvers here resolve ownership FOR the ACL check —
  // they must use *Internal variants (no user context at registry resolution time).
  private val registry = new ResourceTypeRegistry(
    ResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
    ResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
    ResourceType("data-type",   id => dataTypeRepo.findByIdInternal(DataTypeId(id)).map(_.map(_.ownerId.value))),
    ResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
  )

  private val authDirectives = new AuthDirectives(userSessionRepo, Option(apiTokenRepo))
  private val aclDirective   = new AclDirective(permissionRepo, registry)
  private val runRegistry    = new PipelineRunRegistry()
  private val health         = new HealthRoutes()
  // HEL-116: propagates the Cloud Run trace id (X-Cloud-Trace-Context) into the
  // MDC for every request handled below, including the async onComplete error
  // logs in this file. Wrapped inside `cors` so it covers `health.routes` too
  // (Cloud Run tags health probes with a trace as well); one header read plus an
  // MDC put/remove is negligible and keeps the traced scope uniform.
  private val traceContext = new TraceContextDirective()

  // Services
  private val accessChecker     = new AccessCheckerImpl(permissionRepo, registry)
  private val authService       = new AuthService(userRepo)
  private val dashboardService  = new DashboardService(dashboardRepo, accessChecker)
  private val panelService      = new PanelService(panelRepo, dataTypeRepo, accessChecker)
  private val proposalService   = new DashboardProposalService(dashboardService, panelService, dataTypeRepo)
  private val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, dataSourceUrlResolveHost, dataSourceUrlIsBlocked)
  private val sourceService     = new SourceService(dataSourceRepo, dataTypeRepo, connector)
  private val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
  private val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
  // HEL-466: only build the evaluation engine when both privileged repos it
  // needs are present — mirrors alertRuleServiceOpt/alertEventServiceOpt's
  // nullable-optional pattern below. `.orNull` feeds PipelineRunService's
  // nullable constructor param so fixtures that pass neither repo simply
  // skip the onRunSuccess evaluation hook.
  private val alertEvaluationServiceOpt: Option[AlertEvaluationService] =
    for {
      ruleRepo  <- Option(alertRuleRepo)
      eventRepo <- Option(alertEventRepo)
    } yield new AlertEvaluationService(ruleRepo, eventRepo)
  private val pipelineRunService = new PipelineRunService(
    pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo,
    dataTypeRowRepo, pipelineRunCache, runRegistry, fileSystem, binaryRefRepo,
    alertEvaluationServiceOpt.orNull
  )
  private val permissionService           = new PermissionService(permissionRepo, accessChecker)
  private val pipelinePermissionService   = new PipelinePermissionService(permissionRepo, accessChecker)
  // Optional wiring mirrors the nullable constructor param: fixtures that
  // don't pass an ApiTokenRepository get session-only auth and no /api/tokens.
  private val apiTokenServiceOpt          = Option(apiTokenRepo).map(new ApiTokenService(_))
  // HEL-246: same optional-wiring pattern — fixtures that don't pass an
  // ImageUploadRepository simply don't get the /api/uploads/image routes.
  private val imageUploadServiceOpt       = Option(imageUploadRepo).map(new ImageUploadService(_, fileSystem))
  // HEL-447: same optional-wiring pattern — fixtures that don't pass an
  // AlertRuleRepository simply don't get the /api/alert-rules routes.
  private val alertRuleServiceOpt         = Option(alertRuleRepo).map(new AlertRuleService(_, dataTypeRepo))
  // HEL-455: same optional-wiring pattern — fixtures that don't pass an
  // AlertEventRepository simply don't get the /api/alerts routes.
  private val alertEventServiceOpt        = Option(alertEventRepo).map(new AlertEventService(_))

  private val auth  = new AuthRoutes(authService, authDirectives, cookieConfig)
  private val oauth = new OAuthRoutes(authService, googleClientId, googleClientSecret, googleRedirectUri, cookieConfig)

  private val corsSettings = CorsSettings.defaultSettings
    .withAllowedOrigins(HttpOriginMatcher(corsAllowedOrigins.map(HttpOrigin(_)): _*))
    .withAllowedMethods(Seq(HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.PATCH, HttpMethods.DELETE, HttpMethods.HEAD, HttpMethods.OPTIONS))

  val routes: Route =
    cors(corsSettings) {
      traceContext.withTraceContext {
      health.routes ~
        pathPrefix("api") {
          // HEL-287 D4: custom-header CSRF check for every non-GET request
          // that carries the session cookie. Applied once, ahead of the
          // public/authenticated split below, so it covers `logout` (moved
          // into the authenticated tree) uniformly; register/login exempt
          // themselves naturally since no cookie exists yet on the request
          // that is about to mint one.
          authDirectives.requireCsrfHeader {
            concat(
              pathPrefix("auth") { concat(auth.routes, oauth.routes) },
              authDirectives.optionalAuthenticate { userOpt =>
                concat(
                  new PublicDashboardRoutes(panelRepo, panelService, pipelineRepo, aclDirective, userOpt).routes,
                  imageUploadServiceOpt.fold(reject: Route)(svc => new PublicUploadRoutes(svc).routes)
                )
              },
              authDirectives.authenticate { authenticatedUser =>
                concat(
                  // POST /api/auth/logout — cookie-derived identity; clears the cookie
                  pathPrefix("auth") { auth.logoutRoute },
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
                            // HEL-311: log the full exception server-side; never echo
                            // raw exception text in the client-facing body.
                            log.error(s"GET /api/auth/me failed for user ${authenticatedUser.id.value}", ex)
                            complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
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
                              // HEL-311: log the full exception server-side; never echo
                              // raw exception text in the client-facing body.
                              log.error(s"PATCH /api/users/me/update failed for user ${authenticatedUser.id.value}", ex)
                              complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                          }
                        }
                      }
                    }
                  },
                  new DashboardProposalRoutes(proposalService, authenticatedUser).routes,
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
                  new PipelineRunStreamRoutes(pipelineRunService, authenticatedUser).routes,
                  new PipelinePermissionRoutes(pipelinePermissionService, authenticatedUser).routes,
                  apiTokenServiceOpt.fold(reject: Route)(svc => new ApiTokenRoutes(svc, authenticatedUser).routes),
                  imageUploadServiceOpt.fold(reject: Route)(svc => new UploadRoutes(svc, authenticatedUser).routes),
                  alertRuleServiceOpt.fold(reject: Route)(svc => new AlertRuleRoutes(svc, authenticatedUser).routes),
                  alertEventServiceOpt.fold(reject: Route)(svc => new AlertEventRoutes(svc, authenticatedUser).routes)
                )
              }
            )
          }
        }
      }
    }
}
