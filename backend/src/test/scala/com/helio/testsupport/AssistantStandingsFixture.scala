package com.helio.testsupport

import com.helio.api.JsonProtocols
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.domain.model._
import com.helio.services.assistant.AssistantToolExecutor
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{PanelCapabilityService, PanelService}
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService, PatchSetUndoService}
import com.helio.services.pipelines.{OutputService, PipelineProposalService, PipelineService}
import com.helio.services.proposals.{CombinedProposalService, DashboardProposalService}
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.mockito.Mockito.mock
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1639 D0/D8: an EmbeddedPostgres mirror of the 2026-10-16 "Standings" transcript workspace
 *  -- a Sleeper rosters source, a users source, the existing lookup pipeline with its "Standings
 *  Table" Output, and a "Standings" dashboard holding one table panel bound to that Output --
 *  plus the REAL services the assistant's tools run on, wired the way `ApiRoutes` wires them.
 *  Nothing here calls a model or reads a `.env` file: the test JVM has no `DATABASE_URL` or API
 *  key (HEL-1450), so the fixture owns its own database. */
trait AssistantStandingsFixture
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  protected implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  protected implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  protected var embeddedPostgres: EmbeddedPostgres           = _
  protected var db: JdbcBackend.Database                     = _
  protected var dashboardRepo: DashboardRepository           = _
  protected var panelRepo: PanelRepository                   = _
  protected var dataSourceRepo: DataSourceRepository         = _
  protected var permissionRepo: ResourcePermissionRepository = _
  protected var pipelineRepo: PipelineRepository             = _
  protected var pipelineStepRepo: PipelineStepRepository     = _
  protected var outputRepo: OutputRepository                 = _
  protected var nodeSnapshotRepo: NodeSnapshotRepository     = _
  protected var applicationRepo: PatchSetApplicationRepository = _
  protected var accessChecker: AccessChecker                 = _

  protected var dashboardService: DashboardService             = _
  protected var panelService: PanelService                     = _
  protected var dataSourceService: DataSourceService           = _
  protected var pipelineService: PipelineService               = _
  protected var outputService: OutputService                   = _
  protected var patchSetApplyService: PatchSetApplyService     = _
  protected var patchSetPreviewService: PatchSetPreviewService = _
  protected var patchSetUndoService: PatchSetUndoService       = _
  protected var pipelineProposalService: PipelineProposalService = _
  protected var workspaceContextService: WorkspaceContextService = _
  protected var workspaceSearchService: WorkspaceSearchService = _
  protected var dashboardProposalService: DashboardProposalService = _

  protected val ownerIdStr: String             = UUID.randomUUID().toString
  protected val otherIdStr: String             = UUID.randomUUID().toString
  protected val owner: AuthenticatedUser       = AuthenticatedUser(UserId(ownerIdStr))
  protected val otherUser: AuthenticatedUser   = AuthenticatedUser(UserId(otherIdStr))

  protected def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dashboardRepo    = new DashboardRepository(ctx)
    panelRepo        = new PanelRepository(ctx)
    dataSourceRepo   = new DataSourceRepository(ctx)
    permissionRepo   = new ResourcePermissionRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    applicationRepo  = new PatchSetApplicationRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("assistant-standings-fixture"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService       = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dataSourceService  = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService    = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    outputService      = new OutputService(outputRepo, panelRepo, accessChecker)

    patchSetApplyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo,
      outputRepo, outputService
    )
    patchSetPreviewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo, null, SourceFetchBudget.default()
    )
    patchSetUndoService = new PatchSetUndoService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      applicationRepo, outputRepo = outputRepo
    )
    // `validate` (the only PipelineProposalService method a propose tool calls) touches only
    // `dataSourceRepo` and `outputRepo`.
    pipelineProposalService = new PipelineProposalService(null, null, pipelineService, null, dataSourceRepo, outputRepo, SourceFetchBudget.default())
    dashboardProposalService = new DashboardProposalService(dashboardService, panelService, outputRepo, null, dataSourceRepo)
    workspaceContextService = new WorkspaceContextService(
      dashboardService, dataSourceService, outputRepo, pipelineService,
      None, None, Some(panelRepo), None, Some(nodeSnapshotRepo), Some(pipelineStepRepo)
    )
    workspaceSearchService = new WorkspaceSearchService(dashboardService, dataSourceService, outputRepo, pipelineService, workspaceContextService)

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  /** The assistant's tool dispatcher over the real services. A FRESH one per call, exactly as
   *  `AssistantService.converse` builds one per turn. */
  protected def newExecutor(forUser: AuthenticatedUser = owner): AssistantToolExecutor =
    new AssistantToolExecutor(
      workspaceSearchService,
      new PanelCapabilityService(outputRepo, nodeSnapshotRepo),
      dashboardProposalService,
      pipelineProposalService,
      new CombinedProposalService(pipelineProposalService, dashboardProposalService),
      patchSetPreviewService,
      mock(classOf[SourceService]),
      forUser
    )

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerIdStr::uuid, ${s"owner-$ownerIdStr@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherIdStr::uuid, ${s"other-$otherIdStr@helio.test"}, now())"""
    )))
  }

  /** Grants `grantee` a role ("editor" / "viewer") on a resource, as the sharing routes do. */
  protected def grantRole(resourceType: String, resourceId: String, granteeId: String, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, ${granteeId}::uuid, $role, now())"""
    ))
  }

  // ── The Standings workspace ─────────────────────────────────────────────────────────────────

  /** Ids of everything the Standings seed created, so a test can address them exactly. */
  final case class Standings(
      rostersSourceId: String,
      usersSourceId: String,
      pipelineId: String,
      lookupStepId: String,
      computeStepId: String,
      tableOutputId: String,
      dashboardId: String,
      tablePanelId: String
  )

  protected def sleeperRosterColumns: Vector[StaticColumnPayload] =
    Vector("owner_id" -> "string", "roster_id" -> "integer", "settings.wins" -> "integer", "settings.losses" -> "integer",
      "settings.ties" -> "integer", "settings.fpts" -> "integer", "settings.fpts_decimal" -> "integer")
      .map { case (n, t) => StaticColumnPayload(n, t) }

  protected def sleeperRosterRows: Vector[Vector[JsValue]] = Vector(
    Vector(JsString("u1"), JsNumber(1), JsNumber(10), JsNumber(3), JsNumber(0), JsNumber(1500), JsNumber(42)),
    Vector(JsString("u2"), JsNumber(2), JsNumber(8), JsNumber(5), JsNumber(0), JsNumber(1400), JsNumber(7)),
    Vector(JsString("u3"), JsNumber(3), JsNumber(6), JsNumber(7), JsNumber(0), JsNumber(1300), JsNumber(91))
  )

  protected def seedStatic(name: String, columns: Vector[StaticColumnPayload], rows: Vector[Vector[JsValue]], forUser: AuthenticatedUser = owner): DataSourceId =
    await(dataSourceService.createStatic(StaticDataSourceRequest(name, "static", columns, rows), forUser)) match {
      case Right(ds) => ds.id
      case Left(e)   => fail(s"seedStatic($name) failed: $e")
    }

  /** The transcript's workspace: rosters + users sources; pipeline "Sleeper League Pipeline" with
   *  `lookup` (adds display_name) -> `compute` (adds points_for); Output "Standings Table" at the
   *  compute node; dashboard "Standings" with one table panel bound to that Output. */
  protected def seedStandings(forUser: AuthenticatedUser = owner, suffix: String = ""): Standings = {
    val rosters = seedStatic(s"Sleeper rosters$suffix", sleeperRosterColumns, sleeperRosterRows, forUser)
    val users = seedStatic(
      s"Sleeper users$suffix",
      Vector(StaticColumnPayload("user_id", "string"), StaticColumnPayload("display_name", "string")),
      Vector(
        Vector(JsString("u1"), JsString("Alice")),
        Vector(JsString("u2"), JsString("Bob")),
        Vector(JsString("u3"), JsString("Cara"))
      ),
      forUser
    )
    val lookupCfg = JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(users.value)),
      "sourceKey"      -> JsString("owner_id"),
      "lookupKey"      -> JsString("user_id"),
      "columns"        -> JsArray(JsString("display_name"))
    )
    val computeCfg = JsObject(
      "column"     -> JsString("points_for"),
      "expression" -> JsString("round($settings.fpts + $settings.fpts_decimal / 100, 2)")
    )
    val summary = await(pipelineService.create(
      CreatePipelineRequest(
        name = s"Sleeper League Pipeline$suffix",
        roots = Vector(CreatePipelineRootRequest(sourceId = Some(rosters.value))),
        steps = Vector(
          CreatePipelineTransactionalStepRequest("lk", "lookup", lookupCfg),
          CreatePipelineTransactionalStepRequest("pf", "compute", computeCfg, parentStepId = Some("lk"))
        ),
        outputs = Vector(CreatePipelineTransactionalOutputRequest(Some("pf"), "table", "Standings Table"))
      ),
      forUser
    )) match {
      case Right(s) => s
      case Left(e)  => fail(s"seed pipeline failed: $e")
    }
    val steps = await(pipelineStepRepo.listByPipelineInternal(PipelineId(summary.id)))
    val lookupStep  = steps.find(_.kind == "lookup").getOrElse(fail("no lookup step persisted"))
    val computeStep = steps.find(_.kind == "compute").getOrElse(fail("no compute step persisted"))
    val output = await(outputRepo.listByPipelineInternal(PipelineId(summary.id))).headOption.getOrElse(fail("no Output persisted"))
    val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some(s"Standings$suffix")), forUser))._1
    val panel = await(panelService.create(
      CreatePanelRequest(Some(dashboard.id.value), Some("Standings Table"), Some("output"), Some(JsObject("outputId" -> JsString(output.id.value)))),
      forUser
    )) match {
      case Right((p, _)) => p
      case Left(e)       => fail(s"seed panel failed: $e")
    }
    Standings(rosters.value, users.value, summary.id, lookupStep.id.value, computeStep.id.value, output.id.value, dashboard.id.value, panel.id.value)
  }
}
