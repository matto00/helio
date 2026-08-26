package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.HttpOrigin
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import org.apache.pekko.http.cors.scaladsl.CorsDirectives._
import org.apache.pekko.http.cors.scaladsl.model.HttpOriginMatcher
import org.apache.pekko.http.cors.scaladsl.settings.CorsSettings
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.ai.{ClaudeClient, ClaudeConfig, HttpClaudeTransport}
import com.helio.api.http._
import com.helio.api.routes.agents._
import com.helio.api.routes.alerts._
import com.helio.api.routes.assistant._
import com.helio.api.routes.audit._
import com.helio.api.routes.auth._
import com.helio.api.routes.dashboards._
import com.helio.api.routes.hooks._
import com.helio.api.routes.metrics._
import com.helio.api.routes.panels._
import com.helio.api.routes.patchsets._
import com.helio.api.routes.pipelines._
import com.helio.api.routes.proposals._
import com.helio.api.routes.sources._
import com.helio.api.routes.workspace._
import com.helio.domain.model.{DashboardId, DataSourceId, DataTypeId, PanelId, PipelineId}
import com.helio.domain.connectors.RestApiConnector
import com.helio.email.{EmailConfig, EmailSender, HttpResendEmailSender}
import com.helio.services.agents.{AgentMemoryService, AgentPreferencesService}
import com.helio.services.alerts.{AlertEvaluationService, AlertEventService, AlertRuleService}
import com.helio.services.auth.{ApiTokenService, AuthService, BetaAccessService, ChatAccessService, MfaService, PermissionService, PipelinePermissionService, UserTierConfig}
import com.helio.services.assistant.{AssistantConversationService, AssistantService}
import com.helio.services.panels.{AutoLayoutService, BoundPanelService, PanelCapabilityService, PanelService}
import com.helio.services.proposals.{CombinedProposalService, DashboardAuthoringService, DashboardProposalService}
import com.helio.services.sources.{ContentSourceSupport, DataSourceService, ImageUploadService, SourceService}
import com.helio.services.dashboards.{DashboardContentsService, DashboardService}
import com.helio.services.pipelines.{DataTypeService, PipelineProposalService, PipelineRunService, PipelineScheduleService, PipelineService, PipelineShapeService}
import com.helio.services.hooks.HookTriggerService
import com.helio.services.metrics.MetricService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService, PatchSetUndoService, RefinementGrounding, RefinementService}
import com.helio.services.ratelimit.{InMemoryRateLimiter, RateLimitConfig}
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService, WorkspaceTeardownService}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.infrastructure.persistence.agents.{AgentMemoryRepository, AgentPreferencesRepository}
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.services.audit.AuditService
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, InviteCodeRepository, MfaRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.assistant.{AssistantConversationRepository, AssistantDailyUsageRepository}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.{DataSourceRepository, ImageUploadRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.FileSystem
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
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
    metricRepo: MetricRepository = null,
    // HEL-472 (420-A): same nullable-optional wiring pattern as the repos
    // above — fixtures that don't pass an AgentPreferencesRepository simply
    // don't get the /api/preferences routes mounted
    // (agentPreferencesServiceOpt.fold(reject)). Appended last for the same
    // purely-additive reason.
    agentPreferencesRepo: AgentPreferencesRepository = null,
    // HEL-478 (420-B): same nullable-optional wiring pattern as the repos
    // above — fixtures that don't pass an AgentMemoryRepository simply don't
    // get the /api/agent/memory routes mounted
    // (agentMemoryServiceOpt.fold(reject)). Appended last for the same
    // purely-additive reason.
    agentMemoryRepo: AgentMemoryRepository = null,
    // HEL-702: same nullable-optional wiring pattern as the repos above —
    // fixtures that don't pass an MfaRepository simply get an AuthService
    // built with `mfaService = None` (its own default), and neither the
    // authenticated MFA routes nor the public verify route are mounted.
    // Appended last for the same purely-additive reason.
    mfaRepo: MfaRepository = null,
    // HEL-477: same nullable-optional wiring pattern as the repos above —
    // fixtures that don't pass an AuditEventRepository get every mutating
    // service constructed with `auditService = null` (each service's own
    // `audit(...)` helper no-ops on `null` — see design.md Decision 1).
    auditEventRepo: AuditEventRepository = null
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private val log = LoggerFactory.getLogger(getClass)

  private implicit val ec = system.executionContext
  private implicit val mat: Materializer = SystemMaterializer(system).materializer

  // HEL-477: constructed once, shared by every mutating service below —
  // `null` when no AuditEventRepository was passed (fixtures), matching the
  // rest of this file's nullable-optional convention.
  private val auditService: AuditService = Option(auditEventRepo).map(new AuditService(_)).orNull

  // HEL-488: same nullable-optional wiring pattern as auditService above —
  // fixtures that don't pass an AuditEventRepository simply don't get the
  // GET /api/audit-events route mounted (see the `.fold(reject)` mount site
  // below). Unlike auditService (write path, several consuming services),
  // this Option is consumed by exactly one route class, so it stays local
  // rather than becoming a `...Opt` field mirrored on every service.
  private val auditEventRepoOpt: Option[AuditEventRepository] = Option(auditEventRepo)

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
  // HEL-495: same-instance-once construction as authDirectives/aclDirective above. Config is
  // read from env once here (fromEnv-once-inject-explicitly convention, design.md D6).
  private val rateLimitConfig    = RateLimitConfig.fromEnv()
  private val rateLimitDirective = new RateLimitDirective(
    new InMemoryRateLimiter(),
    userSessionRepo,
    Option(apiTokenRepo),
    rateLimitConfig.requestsPerWindow,
    rateLimitConfig.windowSeconds
  )
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
  // HEL-703: read once, shared by authService (register/login/OAuth tier assignment) and
  // chatAccessServiceOpt (beta daily cap) below — mirrors cookieConfig's fromEnv-once convention.
  private val userTierConfig    = UserTierConfig.fromEnv()
  // HEL-702: same nullable-optional wiring pattern as apiTokenServiceOpt
  // below — fixtures that don't pass an MfaRepository get `mfaServiceOpt =
  // None`, which AuthService's own defaulted ctor param treats identically
  // to the feature being entirely absent (design.md D3).
  private val mfaServiceOpt: Option[MfaService] = Option(mfaRepo).map(new MfaService(_, userRepo, auditService))
  private val authService       = new AuthService(userRepo, userTierConfig, mfaServiceOpt, auditService)
  private val dashboardService  = new DashboardService(dashboardRepo, accessChecker, auditService)
  // HEL-500: metricRepo may be null for fixtures that don't pass one (same
  // nullable-optional wiring convention as the constructor param above) —
  // safe because PanelService only touches it when a panel actually carries
  // a `metricId`.
  private val panelService      = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo, auditService)
  // HEL-549: metricRepo threaded in the same nullable-optional way as panelService
  // above — only touched when a proposal panel actually carries a metricId.
  private val proposalService   = new DashboardProposalService(dashboardService, panelService, dataTypeRepo, metricRepo)
  // HEL-363: atomic replace-contents — reuses the same dashboardRepo/panelService/
  // dataTypeRepo/accessChecker instances the other dashboard/panel services use.
  private val dashboardContentsService = new DashboardContentsService(dashboardRepo, panelService, dataTypeRepo, accessChecker, metricRepo, auditService)
  // HEL-367: reuses the same dashboardRepo/panelRepo/accessChecker instances
  // the other dashboard/panel services use; PanelPacker (the pure geometry)
  // is invoked internally, no extra wiring needed here.
  private val autoLayoutService = new AutoLayoutService(dashboardRepo, panelRepo, accessChecker, auditService)
  private val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, dataSourceUrlResolveHost, dataSourceUrlIsBlocked, auditService)
  private val sourceService     = new SourceService(dataSourceRepo, dataTypeRepo, connector, auditService)
  private val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo, auditService)
  // HEL-365: separate from dataTypeService (CRUD-only, design.md D6) — reads
  // the same dataTypeRepo/dataTypeRowRepo to build the panel-capabilities report.
  private val panelCapabilityService = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
  // HEL-381: threads the same RestApiConnector instance sourceService already
  // receives — analyzeProposal's inline rest_api branch needs it (dataSourceRepo/
  // dataTypeRepo above cover every other analyzeProposal branch).
  private val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo, connector, auditService)
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
  // HEL-758: threads the same RestApiConnector instance sourceService/
  // pipelineService already receive — runPipeline/previewStep now execute
  // rest_api sources in-process via InProcessPipelineEngine (design.md D3).
  val pipelineRunService = new PipelineRunService(
    pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo,
    dataTypeRowRepo, pipelineRunCache, runRegistry, fileSystem, binaryRefRepo,
    alertEvaluationServiceOpt.orNull, connector, auditService
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
  // HEL-413: owner-scoped journal repository `PatchSetApplyService`'s successful-apply write and
  // `PatchSetUndoService`'s read both share -- constructed unconditionally (mirrors
  // patchSetApplyService's own always-constructed pattern below) since `dbContext` being null only
  // matters to fixtures that never exercise a genuinely successful patch-set apply/undo call.
  private val patchSetApplicationRepo = new PatchSetApplicationRepository(dbContext)
  // HEL-406: atomic patch-set apply — composes the same, already-constructed
  // per-resource services (panelService/dashboardService/dataSourceService/
  // dataTypeService/pipelineService) plus the repos/accessChecker its
  // pre-validation pass reads directly (design.md D2/D2a); no direct DB
  // writes of its own. HEL-413: also takes patchSetApplicationRepo, to
  // journal a successful (no `failure`) apply (design.md D2).
  private val patchSetApplyService = new PatchSetApplyService(
    panelService, dashboardService, dataSourceService, dataTypeService, pipelineService,
    panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
    metricRepo, accessChecker, patchSetApplicationRepo
  )
  // HEL-408: read-only diff/impact preview -- reuses PatchSetApplyResolvers
  // (same package) for pre-validation; needs only the repos/accessChecker
  // its projection reads directly (design.md D1a/D4), never the per-resource
  // *Service instances apply's forward path writes through.
  private val patchSetPreviewService = new PatchSetPreviewService(
    panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
    metricRepo, accessChecker
  )
  // HEL-413: restores a successfully-journaled apply's edits (design.md D4/D5) -- composes the
  // same per-resource services/repos patchSetApplyService does (minus metricRepo/accessChecker,
  // which undo's own Phase-1/Phase-2 passes never need -- design.md D4/D4a), plus
  // patchSetApplicationRepo to load the journal row.
  private val patchSetUndoService = new PatchSetUndoService(
    panelService, dashboardService, dataSourceService, dataTypeService, pipelineService,
    panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
    patchSetApplicationRepo
  )
  // HEL-364: compound POST /api/panels/bound — composes the four services
  // above (constructed after all of them, same DI-ordering convention this
  // file already follows) plus the repos it needs directly (dataSourceRepo
  // for the owner-scoped sourceDataSourceId re-verify, panelRepo to persist
  // the panel PanelService.buildForCreate only builds — design.md D1).
  private val boundPanelService = new BoundPanelService(
    dataSourceService, pipelineService, pipelineRunService, panelService,
    dataSourceRepo, dataTypeRepo, dataTypeRowRepo, panelRepo, accessChecker, auditService
  )
  private val permissionService           = new PermissionService(permissionRepo, accessChecker)
  private val pipelinePermissionService   = new PipelinePermissionService(permissionRepo, accessChecker)
  // Optional wiring mirrors the nullable constructor param: fixtures that
  // don't pass an ApiTokenRepository get session-only auth and no /api/tokens.
  // HEL-369: ApiTokenService now also takes pipelineRepo (always constructed
  // above, never null) to validate a create request's scopedPipelineIds.
  private val apiTokenServiceOpt          = Option(apiTokenRepo).map(new ApiTokenService(_, pipelineRepo, auditService))
  // HEL-369: same nullable-optional wiring pattern as apiTokenServiceOpt
  // above — fixtures that don't pass a PipelineRunRepository simply don't
  // get the /api/hooks/run route mounted (hookTriggerServiceOpt.fold(reject)).
  private val hookTriggerServiceOpt: Option[HookTriggerService] =
    Option(pipelineRunRepo).map(new HookTriggerService(pipelineRunService, _, pipelineRepo))
  // HEL-246: same optional-wiring pattern — fixtures that don't pass an
  // ImageUploadRepository simply don't get the /api/uploads/image routes.
  private val imageUploadServiceOpt       = Option(imageUploadRepo).map(new ImageUploadService(_, fileSystem, auditService))
  // HEL-447: same optional-wiring pattern — fixtures that don't pass an
  // AlertRuleRepository simply don't get the /api/alert-rules routes.
  private val alertRuleServiceOpt         = Option(alertRuleRepo).map(new AlertRuleService(_, dataTypeRepo))
  // HEL-455: same optional-wiring pattern — fixtures that don't pass an
  // AlertEventRepository simply don't get the /api/alerts routes.
  private val alertEventServiceOpt        = Option(alertEventRepo).map(new AlertEventService(_))
  // HEL-414: same optional-wiring pattern — fixtures that don't pass a
  // PipelineScheduleRepository simply don't get the
  // /api/pipelines/:id/schedule routes.
  private val pipelineScheduleServiceOpt  = Option(pipelineScheduleRepo).map(new PipelineScheduleService(_, pipelineRepo, auditService))
  // HEL-493: same optional-wiring pattern — fixtures that don't pass a
  // MetricRepository simply don't get the /api/metrics routes.
  private val metricServiceOpt            = Option(metricRepo).map(new MetricService(_, dataTypeRepo))
  // HEL-472 (420-A): same optional-wiring pattern — fixtures that don't pass
  // an AgentPreferencesRepository simply don't get the /api/preferences
  // routes.
  private val agentPreferencesServiceOpt  = Option(agentPreferencesRepo).map(new AgentPreferencesService(_))
  // HEL-478 (420-B): same optional-wiring pattern — fixtures that don't pass
  // an AgentMemoryRepository simply don't get the /api/agent/memory routes.
  // HEL-531 (420-E): also requires agentPreferencesServiceOpt (AgentMemoryService's new
  // AgentPreferencesService dependency, design.md Decision 4) — a fixture that passes
  // agentMemoryRepo without agentPreferencesRepo (none currently do) simply doesn't get the
  // /api/agent/memory routes either, same nullable-optional discipline as every other pair here.
  private val agentMemoryServiceOpt: Option[AgentMemoryService] =
    for {
      memoryRepo      <- Option(agentMemoryRepo)
      preferencesSvc  <- agentPreferencesServiceOpt
    } yield new AgentMemoryService(memoryRepo, preferencesSvc)
  // HEL-663: same nullable-optional wiring pattern as metricServiceOpt above — fixtures that don't
  // pass a DbContext simply don't get the /api/assistant-conversations routes mounted
  // (assistantConversationServiceOpt.fold(reject)). fileSystem is always present (a required,
  // non-nullable constructor param) — this is the same FileSystem instance dataSourceService/
  // pipelineRunService/imageUploadServiceOpt already share, no new selection logic (design.md D2).
  private val assistantConversationServiceOpt: Option[AssistantConversationService] =
    Option(dbContext).map(ctx => new AssistantConversationService(new AssistantConversationRepository(ctx), fileSystem))
  // HEL-703: same nullable-optional wiring pattern as assistantConversationServiceOpt above (both
  // depend on the same `dbContext`, so they're always Some/None together) — fixtures that don't
  // pass a DbContext simply don't get a tier gate, but they also don't get the
  // /api/assistant-conversations routes mounted at all in that case (see the combined `.fold`
  // below), so there is no route reachable without one.
  private val chatAccessServiceOpt: Option[ChatAccessService] =
    Option(dbContext).map(ctx => new ChatAccessService(userRepo, new AssistantDailyUsageRepository(ctx), userTierConfig))
  // HEL-704 design.md D6: same fromEnv-once-inject-explicitly convention as ClaudeConfig above --
  // a missing RESEND_API_KEY/HELIO_EMAIL_FROM degrades ONLY POST /api/beta-access/request to its
  // own 503 (BetaAccessError.EmailUnconfigured), never the whole backend boot. Constructed once
  // here (not per-request) since HttpResendEmailSender is a cheap, stateless wrapper over the
  // shared Pekko HTTP client, mirroring HttpClaudeTransport's own reuse.
  private val emailSenderOpt: Option[EmailSender] =
    EmailConfig.fromEnv() match {
      case Left(reason) =>
        log.warn(s"POST /api/beta-access/request will return 503 (email unconfigured): $reason")
        None
      case Right(config) =>
        Some(new HttpResendEmailSender(config))
    }
  // HEL-704: same nullable-optional wiring pattern as chatAccessServiceOpt/metricServiceOpt above
  // -- fixtures that don't pass a DbContext simply don't get the /api/beta-access routes mounted
  // (betaAccessServiceOpt.fold(reject)). emailSenderOpt is a SECOND, independently nullable
  // dependency (env-sourced) -- BetaAccessService itself is always constructed once dbContext is
  // present; a missing emailSenderOpt degrades only its own request-access flow internally
  // (design.md D6), never the whole route family the way a nullable dbContext does.
  private val betaAccessServiceOpt: Option[BetaAccessService] =
    Option(dbContext).map(ctx =>
      new BetaAccessService(new InviteCodeRepository(ctx), userRepo, userTierConfig, emailSenderOpt)
    )
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
  // choke point sample rows need. HEL-521 (420-C): reuses the EXISTING
  // agentPreferencesServiceOpt/agentMemoryServiceOpt values already constructed above (420-A/
  // 420-B) — no new repo/service construction here, just threading the two already-Option-guarded
  // collaborators into this one construction site (design.md Decision 2).
  private val workspaceContextService = new WorkspaceContextService(
    dashboardService,
    dataSourceService,
    dataTypeService,
    pipelineService,
    agentPreferencesServiceOpt,
    agentMemoryServiceOpt,
    Some(panelRepo)
  )
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
  // HEL-411: unconditional (not Option-guarded) — every dependency (dashboardRepo/panelRepo/
  // pipelineService/workspaceContextService/panelCapabilityService) is already constructed
  // unconditionally above, mirroring workspaceContextService's own "no nullable-repo gate to
  // check" precedent (design.md D1). RefinementGrounding itself doubles as RefinementService's
  // target-resolution + ACL check.
  private val refinementGrounding = new RefinementGrounding(dashboardRepo, panelRepo, pipelineService, workspaceContextService, panelCapabilityService)
  // HEL-411 design.md D3/D5: SAME nullable-optional wiring pattern as dashboardAuthoringServiceOpt
  // above, gated on the SAME ClaudeConfig.fromEnv() + authoringConversationRepoOpt (one shared
  // conversation store, AC4 — no parallel gate). A fresh ClaudeClient/HttpClaudeTransport pair is
  // constructed here rather than reusing dashboardAuthoringServiceOpt's local one (out of scope
  // outside that match arm) — both are cheap, stateless wrappers over the same pooled Pekko HTTP
  // client, so this costs nothing beyond one extra object allocation per process.
  private val refinementServiceOpt: Option[RefinementService] =
    (ClaudeConfig.fromEnv(), authoringConversationRepoOpt) match {
      case (Left(reason), _) =>
        log.warn(s"POST /api/refinements disabled: $reason")
        None
      case (Right(_), None) =>
        log.warn("POST /api/refinements disabled: no DbContext configured")
        None
      case (Right(claudeConfig), Some(conversationRepo)) =>
        val claudeClient = new ClaudeClient(claudeConfig, new HttpClaudeTransport(claudeConfig.apiKey))
        Some(new RefinementService(refinementGrounding, patchSetPreviewService, claudeClient, conversationRepo))
    }

  // HEL-665 (reopened composer ticket) design.md D2: SAME nullable-optional wiring pattern as
  // dashboardAuthoringServiceOpt/refinementServiceOpt above, gated on ClaudeConfig.fromEnv() AND
  // metricServiceOpt (metricServiceOpt is a genuinely NEW gating dimension neither of those two
  // needs — WorkspaceSearchService's 5th dependency, metricService, only exists behind that
  // nullable-metricRepo gate, independent of dbContext). Constructs WorkspaceSearchService (HEL-661)
  // for the first time anywhere in this file. A fresh ClaudeClient/HttpClaudeTransport pair is
  // constructed here (never shared), mirroring both sibling *ServiceOpt vals' own "fresh client per
  // service" convention exactly.
  private val assistantServiceOpt: Option[AssistantService] =
    (ClaudeConfig.fromEnv(), metricServiceOpt) match {
      case (Left(reason), _) =>
        log.warn(s"POST /api/assistant-conversations/:id/converse disabled: $reason")
        None
      case (Right(_), None) =>
        log.warn("POST /api/assistant-conversations/:id/converse disabled: no MetricRepository configured")
        None
      case (Right(claudeConfig), Some(metricService)) =>
        val claudeClient           = new ClaudeClient(claudeConfig, new HttpClaudeTransport(claudeConfig.apiKey))
        val workspaceSearchService = new WorkspaceSearchService(dashboardService, dataSourceService, dataTypeService, pipelineService, metricService, workspaceContextService)
        Some(new AssistantService(claudeClient, workspaceSearchService, panelCapabilityService, proposalService, pipelineProposalService, combinedProposalService, patchSetPreviewService, sourceService))
    }

  private val auth  = new AuthRoutes(authService, authDirectives, cookieConfig)
  private val oauth = new OAuthRoutes(authService, googleClientId, googleClientSecret, googleRedirectUri, cookieConfig)
  // HEL-702: constructed once (like auth/oauth above), not per-request — its
  // public `verifyRoute` has no identity to resolve, and its authenticated
  // `authenticatedRoutes(user)` is a method taking the identity the
  // `authenticate` block below already resolved.
  private val mfaRoutesOpt: Option[MfaRoutes] = mfaServiceOpt.map(new MfaRoutes(_, cookieConfig))

  private val corsSettings = CorsSettings.defaultSettings
    .withAllowedOrigins(HttpOriginMatcher(corsAllowedOrigins.map(HttpOrigin(_)): _*))
    .withAllowedMethods(Seq(HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.PATCH, HttpMethods.DELETE, HttpMethods.HEAD, HttpMethods.OPTIONS))

  // HEL-750: no ExceptionHandler/RejectionHandler was registered anywhere in the
  // backend before this. Pekko's default handling for an unhandled exception or
  // rejection runs OUTSIDE the `cors(corsSettings) { ... }` scope below (it's applied
  // by the server binding, wrapping the route this class exposes), so the resulting
  // failure response reached the client with no CORS headers at all -- surfacing to a
  // browser as a confusing "CORS Missing Allow Origin" error instead of a clean 5xx.
  // Registering `TopLevelErrorHandlers.topLevelExceptionHandler`/`topLevelRejectionHandler`
  // immediately inside `cors(corsSettings)` guarantees `cors()` always sees the final
  // response and attaches headers to it, regardless of how the request fails.
  // `TopLevelErrorHandlers.corsRejectionHandler` wraps `cors(corsSettings)` from the
  // OUTSIDE (fold-in, design.md D6) -- the only placement that can catch the
  // `CorsRejection` `cors()` itself raises for a disallowed `Origin`, since that
  // rejection is minted before control ever reaches the pair registered inside it.
  // See `TopLevelErrorHandlers.scala` for the handlers themselves (extracted, design.md D5).

  val routes: Route =
    handleRejections(TopLevelErrorHandlers.corsRejectionHandler) {
    cors(corsSettings) {
      handleExceptions(TopLevelErrorHandlers.topLevelExceptionHandler) {
      handleRejections(TopLevelErrorHandlers.topLevelRejectionHandler) {
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
            // HEL-495 design.md D4: the outermost directive inside requireCsrfHeader,
            // wrapping confineScopedToken (and everything beneath it) in its entirety
            // so every request under /api — regardless of which of the three
            // downstream auth branches ultimately handles it — is counted against its
            // rate-limit bucket before any auth-confinement or route logic runs.
            rateLimitDirective.rateLimit() {
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
              // HEL-702: mfaRoutesOpt's public verifyRoute (POST
              // /api/auth/mfa/verify) sits alongside auth.routes/oauth.routes
              // — like register/login/the OAuth callback, no session cookie
              // exists on this request yet, so requireCsrfHeader above is
              // naturally inert.
              pathPrefix("auth") { concat(auth.routes, oauth.routes, mfaRoutesOpt.fold(reject: Route)(_.verifyRoute)) },
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
                  // HEL-702: GET/POST /api/auth/mfa/... — status, enroll,
                  // enroll/confirm, backup-codes/regenerate, disable.
                  pathPrefix("auth") {
                    mfaRoutesOpt.fold(reject: Route)(_.authenticatedRoutes(authenticatedUser))
                  },
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
                  new DataTypeRoutes(dataTypeService, panelCapabilityService, pipelineRunService, authenticatedUser).routes,
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
                  // HEL-406: brand-new top-level `patch-sets` prefix (mirrors
                  // `proposals` above) — shares no path space with any
                  // existing route, so mount order is irrelevant.
                  new PatchSetRoutes(patchSetApplyService, patchSetPreviewService, authenticatedUser).routes,
                  // HEL-413: brand-new `patch-sets/:id/undo` path (id = applicationId) — own
                  // route file since it's a path-segment id, unlike apply/preview's bare
                  // PatchSet-in-body shape; mount order relative to PatchSetRoutes is irrelevant.
                  new PatchSetUndoRoutes(patchSetUndoService, authenticatedUser).routes,
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
                  // HEL-663: same `.fold(reject)`-gated optional-wiring pattern as metricServiceOpt
                  // above — fixtures that don't pass a DbContext simply don't get the
                  // /api/assistant-conversations routes mounted. HEL-665 (reopened composer ticket)
                  // design.md D3/D4: assistantServiceOpt is passed in as a SECOND, independently
                  // nullable dependency — the whole route family stays gated on dbContext alone
                  // (Pattern A, unaffected); only the new POST /:id/converse route additionally
                  // checks assistantServiceOpt and degrades to its own 503 when it's None.
                  // HEL-703: chatAccessServiceOpt is combined via a for-comprehension with
                  // assistantConversationServiceOpt (both derive from the same `dbContext`, so
                  // they're always Some/None together) — the route family stays reachable only
                  // when both are present, same net gating as before this ticket.
                  (for {
                    svc        <- assistantConversationServiceOpt
                    chatAccess <- chatAccessServiceOpt
                  } yield new AssistantConversationRoutes(svc, assistantServiceOpt, chatAccess, authenticatedUser).routes)
                    .fold(reject: Route)(identity),
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
                  new DashboardAuthoringRoutes(dashboardAuthoringServiceOpt, authenticatedUser).routes,
                  // HEL-411: mounted UNCONDITIONALLY, same reasoning as DashboardAuthoringRoutes
                  // above — a missing ANTHROPIC_API_KEY/DbContext must degrade this route to a
                  // clean 503, not a bare 404. RefinementRoutes itself handles the `None` case.
                  new RefinementRoutes(refinementServiceOpt, authenticatedUser).routes,
                  // HEL-472 (420-A): same `.fold(reject)`-gated optional-wiring pattern as
                  // metricServiceOpt above — fixtures that don't pass an
                  // AgentPreferencesRepository simply don't get the /api/preferences routes
                  // mounted.
                  agentPreferencesServiceOpt.fold(reject: Route)(svc => new AgentPreferencesRoutes(svc, authenticatedUser).routes),
                  // HEL-478 (420-B): same `.fold(reject)`-gated optional-wiring pattern as
                  // agentPreferencesServiceOpt above — fixtures that don't pass an
                  // AgentMemoryRepository simply don't get the /api/agent/memory routes mounted.
                  agentMemoryServiceOpt.fold(reject: Route)(svc => new AgentMemoryRoutes(svc, authenticatedUser).routes),
                  // HEL-704: same `.fold(reject)`-gated optional-wiring pattern as the repos above
                  // — fixtures that don't pass a DbContext simply don't get the /api/beta-access
                  // routes mounted. A missing RESEND_API_KEY/HELIO_EMAIL_FROM degrades only the
                  // request-access endpoint internally (BetaAccessService), not this mount.
                  betaAccessServiceOpt.fold(reject: Route)(svc => new BetaAccessRoutes(svc, authenticatedUser).routes),
                  // HEL-488: same `.fold(reject)`-gated optional-wiring pattern as the repos
                  // above — fixtures that don't pass an AuditEventRepository simply don't get
                  // the GET /api/audit-events route mounted.
                  auditEventRepoOpt.fold(reject: Route)(repo => new AuditEventRoutes(repo, authenticatedUser).routes)
                )
              }
            )
            }
            }
          }
        }
      }
      }
      }
    }
    }
}
