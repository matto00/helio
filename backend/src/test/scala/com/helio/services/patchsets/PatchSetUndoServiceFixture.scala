package com.helio.services.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.patchsets.{Edit, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.domain._
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** Service-level coverage for `PatchSetUndoService.undo` (HEL-413, tasks.md 5.3) —
 *  embedded-Postgres integration tests, mirroring `PatchSetApplyServiceSpec`'s fixture
 *  convention exactly. Route-level 404/409 status mapping lives in `PatchSetUndoRoutesSpec`
 *  (tasks.md 5.4). */
trait PatchSetUndoServiceFixture extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  protected implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  protected implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  protected var embeddedPostgres: EmbeddedPostgres         = _
  protected var db: JdbcBackend.Database                   = _
  protected var dashboardRepo: DashboardRepository         = _
  protected var panelRepo: PanelRepository                 = _
  protected var dataSourceRepo: DataSourceRepository       = _
  protected var permissionRepo: ResourcePermissionRepository = _
  protected var pipelineRepo: PipelineRepository           = _
  protected var pipelineStepRepo: PipelineStepRepository   = _
  protected var outputRepo: OutputRepository               = _
  protected var applicationRepo: PatchSetApplicationRepository = _

  protected var dashboardService: DashboardService   = _
  protected var panelService: PanelService           = _
  protected var dataSourceService: DataSourceService = _
  protected var pipelineService: PipelineService     = _
  protected var applyService: PatchSetApplyService   = _
  protected var undoService: PatchSetUndoService      = _

  protected val userAId = UUID.randomUUID().toString
  protected val userBId = UUID.randomUUID().toString
  protected val userA   = AuthenticatedUser(UserId(userAId))
  protected val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dashboardRepo    = new DashboardRepository(ctx)
    panelRepo         = new PanelRepository(ctx)
    dataSourceRepo    = new DataSourceRepository(ctx)
    permissionRepo    = new ResourcePermissionRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo  = new PipelineStepRepository(ctx)
    outputRepo        = new OutputRepository(ctx)
    applicationRepo   = new PatchSetApplicationRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-undo-service-spec"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService        = new PanelService(panelRepo, accessChecker, dashboardRepo, null, outputRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)

    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo, outputRepo = outputRepo
    )
    undoService = new PatchSetUndoService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      applicationRepo, outputRepo = outputRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  protected def await[T](f: Future[T]): T = Await.result(f, 10.seconds)


  protected def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  protected def seedDashboard(owner: AuthenticatedUser, name: String = "Dashboard"): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some(name)), owner))._1

  protected def seedPanel(dashboardId: DashboardId, owner: AuthenticatedUser, title: String = "Panel"): Panel =
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("divider"), None), owner)) match {
      case Right((p, _)) => p
      case Left(e)  => fail(s"seedPanel failed: $e")
    }

  /** A real, persisted Output -- `panels.output_id` is FK-constrained against `outputs`, so a
   *  placement test needs a genuine row, not a synthetic id (the DB-level FK is checked
   *  regardless of the app-level existence CHECK). */
  protected def seedOutput(pipeline: PipelineSummaryResponse, owner: AuthenticatedUser, name: String = "Output"): Output =
    await(outputRepo.insertInternal(PipelineId(pipeline.id), None, owner.id, name, OutputKind.Table, explicitRootId = None))

  // HEL-904: no companion DataType to look up anymore — returns just the DataSourceId
  // (every call site already discarded the old tuple's second element).
  protected def seedDatasetSource(owner: AuthenticatedUser, name: String = "Source"): DataSourceId = {
    val ds = await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      owner
    )) match {
      case Right(d) => d
      case Left(e)  => fail(s"seedDatasetSource failed: $e")
    }
    ds.id
  }

  protected def seedPipeline(owner: AuthenticatedUser, sourceId: DataSourceId, name: String = "Pipeline"): PipelineSummaryResponse =
    await(pipelineService.create(CreatePipelineRequest(name, Vector(CreatePipelineRootRequest(Some(sourceId.value)))), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipeline failed: $e")
    }

  protected def seedPipelineStep(
      pipelineId: PipelineId,
      owner: AuthenticatedUser,
      kind: String,
      config: JsObject,
      enabled: Option[Boolean] = None,
      parentStepId: Option[String] = None
  ): PipelineStepResponse =
    await(
      pipelineService.addStep(
        pipelineId,
        CreatePipelineStepRequest(kind, config, enabled = enabled, parentStepId = parentStepId),
        owner
      )
    ) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipelineStep failed: $e")
    }

  protected def applySuccessfully(edits: Vector[Edit], user: AuthenticatedUser = userA): String =
    await(applyService.apply(PatchSet(None, edits), user)) match {
      case Right(r) if r.applicationId.isDefined => r.applicationId.get
      case other                                  => fail(s"expected a successful, journaled apply, got $other")
    }
}
