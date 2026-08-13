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
import com.helio.ai.{ClaudeClient, ClaudeConfig, HttpClaudeTransport}
import com.helio.api.routes._
import com.helio.domain.{DashboardId, DataSourceId, DataTypeId, PanelId, PipelineId, RestApiConnector}
import com.helio.services.{AlertEvaluationService, AlertEventService, AlertRuleService, ApiTokenService, AuthService, AutoLayoutService, BoundPanelService, CombinedProposalService, ContentSourceSupport, DashboardAuthoringService, DashboardContentsService, DashboardProposalService, DashboardService, DataSourceService, DataTypeService, HookTriggerService, ImageUploadService, MetricService, PanelCapabilityService, PanelService, PermissionService, PipelinePermissionService, PipelineProposalService, PipelineRunService, PipelineScheduleService, PipelineService, PipelineShapeService, SourceService, WorkspaceContextService, WorkspaceTeardownService}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.infrastructure.{AlertEventRepository, AlertRuleRepository, ApiTokenRepository, AuthoringConversationRepository, BinaryRefRepository, DashboardRepository, DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext, FileSystem, ImageUploadRepository, MetricRepository, PanelRepository, PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository, WorkspaceTeardownRepository}
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
    alertEventRepo: AlertEventRepository = null,
    // HEL-414: same nullable-optional wiring pattern as alertRuleRepo/
    // alertEventRepo above — fixtures that don't pass a
    // PipelineScheduleRepository simply don't get the
    // /api/pipelines/:id/schedule routes mounted
    // (pipelineScheduleServiceOpt.fold(reject)). Appended last for the same
    // purely-additive reason.
    pipelineScheduleRepo: PipelineScheduleRepository = null,
    // HEL-366: same nullable-optional wiring pattern as the repos above —
    // fixtures that don't pass a DbContext simply don't get the
    // /api/workspace/teardown route mounted (workspaceTeardownServiceOpt.
    // fold(reject)). Unlike the other nullable params this is a raw
    // DbContext rather than a repository: WorkspaceTeardownRepository's
    // entire teardown transaction must run via `ctx.withUserContext` (design.md
    // Decision 3's hard constraint), which no existing repository exposes.
    dbContext: DbContext = null,
    // HEL-493: same nullable-optional wiring pattern as the repos above —
    // fixtures that don't pass a MetricRepository simply don't get the
    // /api/metrics routes mounted (metricServiceOpt.fold(reject)). Appended
    // last for the same purely-additive reason.
    metricRepo: MetricRepository = null
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
  // HEL-500: metricRepo may be null for fixtures that don't pass one (same
  // nullable-optional wiring convention as the constructor param above) —
  // safe because PanelService only touches it when a panel actually carries
  // a `metricId`.
  private val panelService      = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
  // HEL-549: metricRepo threaded in the same nullable-optional way as panelService
  // above — only touched when a proposal panel actually carries a metricId.
  private val proposalService   = new DashboardProposalService(dashboardService, panelService, dataTypeRepo, metricRepo)
  // HEL-363: atomic replace-contents — reuses the same dashboardRepo/panelService/
  // dataTypeRepo/accessChecker instances the other dashboard/panel services use.
  private val dashboardContentsService = new DashboardContentsService(dashboardRepo, panelService, dataTypeRepo, accessChecker, metricRepo)
  // HEL-367: reuses the same dashboardRepo/panelRepo/accessChecker instances
  // the other dashboard/panel services use; PanelPacker (the pure geometry)
  // is invoked internally, no extra wiring needed here.
  private val autoLayoutService = new AutoLayoutService(dashboardRepo, panelRepo, accessChecker)
  private val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, dataSourceUrlResolveHost, dataSourceUrlIsBlocked)
  private val sourceService     = new SourceService(dataSourceRepo, dataTypeRepo, connector)
  private val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
  // HEL-365: separate from dataTypeService (CRUD-only, design.md D6) — reads
  // the same dataTypeRepo/dataTypeRowRepo to build the panel-capabilities report.
  private val panelCapabilityService = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
  // HEL-381: threads the same RestApiConnector instance sourceService already
  // receives — analyzeProposal's inline rest_api branch needs it (dataSourceRepo/
  // dataTypeRepo above cover every other analyzeProposal branch).
  private val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo, connector)
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
  // HEL-415: exposed (not private) so Main.scala can hand the same instance
  // to PipelineSchedulerService — scheduled runs reuse the manual-run path's
  // PipelineRunCache/PipelineRunRegistry instead of duplicating wiring.
  val pipelineRunService = new PipelineRunService(
    pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo,
    dataTypeRowRepo, pipelineRunCache, runRegistry, fileSystem, binaryRefRepo,
    alertEvaluationServiceOpt.orNull
  )
  // HEL-383: atomic pipeline-proposal apply — composes sourceService/
  // dataSourceService/pipelineService/pipelineRunService/dataTypeService,
  // all already constructed above, plus dataSourceRepo/dataTypeRepo for the
  // read-only lookups its own scaladoc documents (no direct DB writes).
  private val pipelineProposalService = new PipelineProposalService(
    sourceService, dataSourceService, pipelineService, pipelineRunService, dataTypeService,
    dataSourceRepo, dataTypeRepo
  )
  // HEL-387: atomic combined pipeline+dashboard proposal apply — composes the
  // already-constructed pipelineProposalService/proposalService (the latter
  // is DashboardProposalService, constructed above), no repository access of
  // its own.
  private val combinedProposalService = new CombinedProposalService(pipelineProposalService, proposalService)
  // HEL-364: compound POST /api/panels/bound — composes the four services
  // above (constructed after all of them, same DI-ordering convention this
  // file already follows) plus the repos it needs directly (dataSourceRepo
  // for the owner-scoped sourceDataSourceId re-verify, panelRepo to persist
  // the panel PanelService.buildForCreate only builds — design.md D1).
  private val boundPanelService = new BoundPanelService(
    dataSourceService, pipelineService, pipelineRunService, panelService,
    dataSourceRepo, dataTypeRepo, dataTypeRowRepo, panelRepo, accessChecker
  )
  private val permissionService           = new PermissionService(permissionRepo, accessChecker)
  private val pipelinePermissionService   = new PipelinePermissionService(permissionRepo, accessChecker)
  // Optional wiring mirrors the nullable constructor param: fixtures that
  // don't pass an ApiTokenRepository get session-only auth and no /api/tokens.
  // HEL-369: ApiTokenService now also takes pipelineRepo (always constructed
  // above, never null) to validate a create request's scopedPipelineIds.
  private val apiTokenServiceOpt          = Option(apiTokenRepo).map(new ApiTokenService(_, pipelineRepo))
  // HEL-369: same nullable-optional wiring pattern as apiTokenServiceOpt
  // above — fixtures that don't pass a PipelineRunRepository simply don't
  // get the /api/hooks/run route mounted (hookTriggerServiceOpt.fold(reject)).
  private val hookTriggerServiceOpt: Option[HookTriggerService] =
    Option(pipelineRunRepo).map(new HookTriggerService(pipelineRunService, _, pipelineRepo))
  // HEL-246: same optional-wiring pattern — fixtures that don't pass an
  // ImageUploadRepository simply don't get the /api/uploads/image routes.
  private val imageUploadServiceOpt       = Option(imageUploadRepo).map(new ImageUploadService(_, fileSystem))
  // HEL-447: same optional-wiring pattern — fixtures that don't pass an
  // AlertRuleRepository simply don't get the /api/alert-rules routes.
  private val alertRuleServiceOpt         = Option(alertRuleRepo).map(new AlertRuleService(_, dataTypeRepo))
  // HEL-455: same optional-wiring pattern — fixtures that don't pass an
  // AlertEventRepository simply don't get the /api/alerts routes.
  private val alertEventServiceOpt        = Option(alertEventRepo).map(new AlertEventService(_))
  // HEL-414: same optional-wiring pattern — fixtures that don't pass a
  // PipelineScheduleRepository simply don't get the
  // /api/pipelines/:id/schedule routes.
  private val pipelineScheduleServiceOpt  = Option(pipelineScheduleRepo).map(new PipelineScheduleService(_, pipelineRepo))
  // HEL-493: same optional-wiring pattern — fixtures that don't pass a
  // MetricRepository simply don't get the /api/metrics routes.
  private val metricServiceOpt            = Option(metricRepo).map(new MetricService(_, dataTypeRepo))
  // HEL-391: dependency-free, mirrors ConnectorRoutes/ConnectorRegistry — no
  // repository, so no nullable-optional wiring needed.
  private val pipelineShapeService        = new PipelineShapeService()
  // HEL-366: same nullable-optional wiring pattern as the repos above —
  // fixtures that don't pass a DbContext simply don't get the
  // /api/workspace/teardown route mounted.
  private val workspaceTeardownServiceOpt: Option[WorkspaceTeardownService] =
    Option(dbContext).map(ctx => new WorkspaceTeardownService(new WorkspaceTeardownRepository(ctx, dataTypeRepo), fileSystem))
  // HEL-371: unconditional (not Option-guarded, unlike workspaceTeardownServiceOpt
  // above) — every dependency (dashboardService/dataSourceService/dataTypeService/
  // pipelineService) is already constructed unconditionally above, so there is
  // no nullable-repo gate to check (design.md D2). HEL-372 design.md D7: takes
  // dataTypeService (not the bare repo) — its listRows is the owner-scoping
  // choke point sample rows need.
  private val workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)
  // HEL-397: same nullable-optional wiring pattern as workspaceTeardownServiceOpt above —
  // fixtures that don't pass a DbContext simply don't get the authoring routes' persistence
  // collaborator (folded into the ClaudeConfig gate below, since DashboardAuthoringService needs
  // BOTH to be usable).
  private val authoringConversationRepoOpt: Option[AuthoringConversationRepository] =
    Option(dbContext).map(new AuthoringConversationRepository(_))
  // HEL-392 (extended by HEL-397): same nullable-optional wiring pattern as alertRuleServiceOpt/...
  // above, but gated on ClaudeConfig.fromEnv() AND authoringConversationRepoOpt rather than a bare
  // nullable repo — either a missing ANTHROPIC_API_KEY or a missing DbContext degrades ONLY this
  // route family to a clean 503, never a startup failure (mirrors HEL-390 D6's "no forced startup
  // requirement"). Composes the already-constructed workspaceContextService/panelCapabilityService/
  // proposalService above, plus a fresh ClaudeClient over the production HttpClaudeTransport.
  private val dashboardAuthoringServiceOpt: Option[DashboardAuthoringService] =
    (ClaudeConfig.fromEnv(), authoringConversationRepoOpt) match {
      case (Left(reason), _) =>
        log.warn(s"POST /api/authoring/dashboard disabled: $reason")
        None
      case (Right(_), None) =>
        log.warn("POST /api/authoring/dashboard disabled: no DbContext configured")
        None
      case (Right(claudeConfig), Some(conversationRepo)) =>
        val claudeClient = new ClaudeClient(claudeConfig, new HttpClaudeTransport(claudeConfig.apiKey))
        Some(new DashboardAuthoringService(workspaceContextService, panelCapabilityService, proposalService, claudeClient, conversationRepo))
    }

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
            // HEL-369 design.md Decision 2: the single confinement chokepoint
            // for scoped tokens, wrapping the ENTIRE three-way branch split
            // below (pathPrefix("auth") / optionalAuthenticate / authenticate).
            // Placed here — between requireCsrfHeader and the concat — so no
            // branch (present or future) ever gets a chance to independently
            // resolve a scoped token's identity before this directive has
            // confined it to /api/hooks/*. See AuthDirectives.confineScopedToken's
            // scaladoc for the full resolution walkthrough and why a round-1
            // design that applied this only inside the `authenticate` branch
            // was rejected (it left optionalAuthenticate's identical
            // token-resolution chain unconfined).
            authDirectives.confineScopedToken { tokenScope =>
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
                  new DashboardContentsRoutes(dashboardContentsService, authenticatedUser).routes,
                  new AutoLayoutRoutes(autoLayoutService, authenticatedUser).routes,
                  new DashboardRoutes(dashboardService, authenticatedUser).routes,
                  new DashboardSnapshotRoutes(dashboardService, authenticatedUser).routes,
                  // HEL-364: mounted ahead of PanelRoutes so the literal
                  // "/panels/bound" path is never shadowed by PanelRoutes'
                  // `path(PanelIdSegment)` (which would otherwise treat
                  // "bound" as a panel id — Pekko's rejection/backtracking
                  // happens to make either order work today since that
                  // branch only defines delete/patch, but explicit ordering
                  // doesn't depend on that staying true).
                  new BoundPanelRoutes(boundPanelService, authenticatedUser).routes,
                  new PanelRoutes(panelService, authenticatedUser).routes,
                  new PermissionRoutes(permissionService, authenticatedUser).routes,
                  new DataTypeRoutes(dataTypeService, panelCapabilityService, authenticatedUser).routes,
                  new DataSourceRoutes(dataSourceService, authenticatedUser).routes,
                  new DataSourcePreviewRoutes(dataSourceService, authenticatedUser).routes,
                  new SourceRoutes(sourceService, authenticatedUser).routes,
                  new SourcePreviewRoutes(sourceService, authenticatedUser).routes,
                  new ConnectorRoutes(authenticatedUser).routes,
                  // HEL-391: distinct top-level `pipeline-shapes` prefix, NOT nested under
                  // `pipelines` — mount order relative to PipelineRoutes doesn't matter (design.md
                  // Decision 6).
                  new PipelineShapeRoutes(pipelineShapeService, authenticatedUser).routes,
                  new PipelineRoutes(pipelineService, authenticatedUser).routes,
                  new PipelineStepRoutes(pipelineService, authenticatedUser).routes,
                  new PipelineProposalRoutes(pipelineProposalService, authenticatedUser).routes,
                  // HEL-387: brand-new top-level `proposals` prefix (design.md
                  // D6) — shares no path space with any existing route, so
                  // mount order relative to the others is irrelevant.
                  new CombinedProposalRoutes(combinedProposalService, authenticatedUser).routes,
                  new PipelineRunSubmitRoutes(pipelineRunService, authenticatedUser).routes,
                  new PipelineRunStatusRoutes(pipelineRunService, authenticatedUser).routes,
                  new PipelineRunHistoryRoutes(pipelineRunService, authenticatedUser).routes,
                  new PipelineRunStreamRoutes(pipelineRunService, authenticatedUser).routes,
                  new PipelinePermissionRoutes(pipelinePermissionService, authenticatedUser).routes,
                  apiTokenServiceOpt.fold(reject: Route)(svc => new ApiTokenRoutes(svc, authenticatedUser).routes),
                  // HEL-369: the only route family that consumes `tokenScope`
                  // (extracted by confineScopedToken above the branch split).
                  // Every other route class in this list keeps taking a bare
                  // `authenticatedUser`, exactly as before this change.
                  hookTriggerServiceOpt.fold(reject: Route)(svc => new HookRoutes(svc, authenticatedUser, tokenScope).routes),
                  imageUploadServiceOpt.fold(reject: Route)(svc => new UploadRoutes(svc, authenticatedUser).routes),
                  alertRuleServiceOpt.fold(reject: Route)(svc => new AlertRuleRoutes(svc, authenticatedUser).routes),
                  alertEventServiceOpt.fold(reject: Route)(svc => new AlertEventRoutes(svc, authenticatedUser).routes),
                  pipelineScheduleServiceOpt.fold(reject: Route)(svc => new PipelineScheduleRoutes(svc, authenticatedUser).routes),
                  metricServiceOpt.fold(reject: Route)(svc => new MetricRoutes(svc, authenticatedUser).routes),
                  // HEL-371: mounted unconditionally (not `.fold(reject)`-gated
                  // on workspaceTeardownServiceOpt like every other nullable-repo
                  // route family in this list) — WorkspaceRoutes itself now
                  // internally gates only its `.../teardown` sub-route on the
                  // Option, so `.../context` stays reachable regardless of
                  // whether `dbContext` was supplied (design.md D2).
                  new WorkspaceRoutes(workspaceTeardownServiceOpt, workspaceContextService, authenticatedUser).routes,
                  // HEL-392: mounted UNCONDITIONALLY (unlike the `.fold(reject)`-gated route
                  // families above) — a missing ANTHROPIC_API_KEY must degrade this specific
                  // route to a clean 503, not a bare 404 that looks like the path doesn't exist
                  // (task 4.2). DashboardAuthoringRoutes itself handles the `None` case.
                  new DashboardAuthoringRoutes(dashboardAuthoringServiceOpt, authenticatedUser).routes
                )
              }
            )
            }
          }
        }
      }
    }
}
