package com.helio.services.patchsets

import com.helio.api.JsonProtocols
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialRepository, ResourcePermissionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1493 fixture: a real apply -> real undo wiring over embedded Postgres where inline pipeline roots can be
 *  created (a `DataSourceService` and `SourceService` are wired). Rows are counted by the exact test owner id; the
 *  undo outcome is read through its JSON wire shape. */
trait PatchSetInlineSourceFixture
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  protected implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  protected implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  protected var embeddedPostgres: EmbeddedPostgres    = _
  protected var db: JdbcBackend.Database              = _
  protected var pipelineService: PipelineService      = _
  protected var dataSourceService: DataSourceService  = _
  protected var applyService: PatchSetApplyService    = _
  protected var undoService: PatchSetUndoService      = _
  protected var applicationRepo: PatchSetApplicationRepository = _
  protected var dashboardRepo: DashboardRepository         = _
  protected var panelRepo: PanelRepository                 = _
  protected var dataSourceRepo: DataSourceRepository       = _
  protected var pipelineRepo: PipelineRepository           = _
  protected var pipelineStepRepo: PipelineStepRepository   = _
  protected var outputRepo: OutputRepository               = _
  protected var connectorRepo: ConnectorRepository         = _
  protected var panelService: PanelService                 = _
  protected var dashboardService: DashboardService         = _

  /** HEL-1505: when true the fixture's `DataSourceService` is built WITH the real `connectorRepo` (its HEL-1497
   *  cleanup runs, as in production); the default keeps the HEL-1493 wiring that isolates `InlineSourceCleanup`. */
  protected def wireConnectorRepoIntoDataSourceService: Boolean = false

  protected val userId = UUID.randomUUID().toString
  protected val user   = AuthenticatedUser(UserId(userId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dashboardRepo        = new DashboardRepository(ctx)
    panelRepo            = new PanelRepository(ctx)
    dataSourceRepo       = new DataSourceRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    pipelineRepo         = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo     = new PipelineStepRepository(ctx)
    outputRepo           = new OutputRepository(ctx)
    connectorRepo        = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    applicationRepo      = new PatchSetApplicationRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)

    dataSourceService = new DataSourceService(
      dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-undo-inline-source")),
      connectorRepo = if (wireConnectorRepoIntoDataSourceService) connectorRepo else null
    )
    val rest = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("amount" -> JsNumber(1)))))))
    dashboardService     = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    pipelineService = new PipelineService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo,
      sourceService = new SourceService(dataSourceRepo, rest, connectorRepo = connectorRepo), dataSourceService = dataSourceService
    )
    panelService         = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo, outputRepo
    )
    undoService = new PatchSetUndoService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      applicationRepo, outputRepo
    )

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"a-$userId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  protected def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  protected def count(table: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM #$table WHERE owner_id = $userId::uuid".as[Int])).head
  }

  protected def datasetRoot(): CreatePipelineRootRequest =
    CreatePipelineRootRequest(
      `type`       = Some("dataset"),
      name         = Some(s"inline-${UUID.randomUUID()}"),
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
    )

  protected def bareUrlRestRoot(): CreatePipelineRootRequest = {
    val json = JsObject(
      "type"       -> JsString("rest_api"),
      "name"       -> JsString(s"rest-${UUID.randomUUID()}"),
      "restConfig" -> JsObject("url" -> JsString("http://example.invalid/data"), "method" -> JsString("GET"))
    )
    createPipelineRootRequestFormat.read(json)
  }

  protected def createEdit(request: CreatePipelineRequest): Edit =
    Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(createPipelineRequestFormat.write(request).asJsObject))

  /** Applies the create, returning the application id and the created pipeline id. */
  protected def applyCreate(request: CreatePipelineRequest): (String, String) = {
    val response = await(applyService.apply(PatchSet(None, Vector(createEdit(request))), user)).fold(e => fail(s"apply failed: $e"), identity)
    response.failure shouldBe None
    (response.applicationId.get, response.edits.head.newId.get)
  }

  protected def rootSourceIds(pipelineId: String): Vector[String] =
    await(pipelineService.findSummaryById(PipelineId(pipelineId), user)).fold(e => fail(s"find: $e"), identity).roots.map(_.dataSourceId)

  protected def undoOutcome(applicationId: String): JsObject = {
    val response = await(undoService.undo(PatchSetApplicationId(applicationId), user)).fold(e => fail(s"undo refused: $e"), identity)
    response.edits.head.status shouldBe "restored"
    editUndoOutcomeFormat.write(response.edits.head).asJsObject
  }

  protected def inlineSources(outcome: JsObject): Vector[JsObject] =
    outcome.fields.get("inlineSources").map { case JsArray(els) => els.map(_.asJsObject) case _ => Vector.empty[JsObject] }.getOrElse(Vector.empty)

  protected def sourceCount(id: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM data_sources WHERE id = $id".as[Int])).head
  }
}
