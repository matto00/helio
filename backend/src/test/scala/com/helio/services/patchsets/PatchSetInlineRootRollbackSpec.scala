package com.helio.services.patchsets

import com.helio.api.JsonProtocols
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.patchsets.{Edit, EditOutcome, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.sources.{RestApiConfigPayload, StaticColumnPayload, StaticDataPayload}
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

/** HEL-1475 paths 2 and 5: patch-set mid-set rollback of an inline-root pipeline create.
 *  - a bare-url REST root's implicit Connector is removed with its source;
 *  - roots that cannot be lined up (count mismatch, missing `dataSourceId`) are reported `unrecoverable`
 *    and, on a count mismatch, nothing is deleted;
 *  - the pipeline-delete-fails branch deletes no source and is `unrecoverable` (GUARD: green before the fix, added
 *    because HEL-1469 left that branch untested).
 *  Rows are counted by the exact test owner id. */
class PatchSetInlineRootRollbackSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dashboardService: DashboardService   = _
  private var pipelineService: PipelineService     = _
  private var applyService: PatchSetApplyService   = _
  private var rollbackServices: PatchSetApplyServices = _

  private val userId = UUID.randomUUID().toString
  private val user   = AuthenticatedUser(UserId(userId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dashboardRepo    = new DashboardRepository(ctx)
    val panelRepo        = new PanelRepository(ctx)
    val dataSourceRepo   = new DataSourceRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val outputRepo       = new OutputRepository(ctx)
    val connectorRepo    = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)

    val dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-inline-root-rollback")))
    val rest = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("amount" -> JsNumber(1)))))))
    dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    pipelineService  = new PipelineService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo,
      sourceService = new SourceService(dataSourceRepo, rest, connectorRepo = connectorRepo), dataSourceService = dataSourceService
    )
    val panelService = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx), outputRepo
    )
    rollbackServices = PatchSetApplyServices(panelService, dashboardService, dataSourceService, pipelineService)

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"a-$userId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def count(table: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM #$table WHERE owner_id = $userId::uuid".as[Int])).head
  }

  private def datasetRoot(): CreatePipelineRootRequest =
    CreatePipelineRootRequest(
      `type`       = Some("dataset"),
      name         = Some(s"inline-${UUID.randomUUID()}"),
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
    )

  private def bareUrlRestRoot(): JsObject = JsObject(
    "type"       -> JsString("rest_api"),
    "name"       -> JsString(s"rest-${UUID.randomUUID()}"),
    "restConfig" -> JsObject("url" -> JsString("http://example.invalid/data"), "method" -> JsString("GET"))
  )

  /** Creates the pipeline for real (so its inline sources exist) and returns it with the forward outcome the
   *  apply loop would have journaled. */
  private def forwardCreate(request: CreatePipelineRequest): (ResolvedEdit, EditOutcome) = {
    val summary = await(pipelineService.create(request, user)).fold(e => fail(s"create failed: $e"), identity)
    val edit    = ResolvedEdit(0, "pipeline", "create", None, ResolvedAction.PipelineCreate(request))
    (edit, edit.toOutcome("applied", newId = Some(summary.id), resultingState = Some(pipelineSummaryResponseFormat.write(summary))))
  }

  private def withSummaryRoots(outcome: EditOutcome, f: Vector[JsValue] => Vector[JsValue]): EditOutcome = {
    val obj   = outcome.resultingState.get.asJsObject
    val roots = obj.fields("roots") match { case JsArray(els) => els; case _ => Vector.empty }
    outcome.copy(resultingState = Some(JsObject(obj.fields.updated("roots", JsArray(f(roots))))))
  }

  private def rollBack(edit: ResolvedEdit, forward: EditOutcome): EditOutcome =
    await(PatchSetApplyRollback.rollback(Vector(edit -> forward), user, rollbackServices)).head

  "patch-set mid-set rollback of an inline bare-url REST root (HEL-1475 path 2)" should {
    "remove the implicit Connector with the source" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("rollback dash")), user))._1
      val sourcesBefore = count("data_sources"); val connectorsBefore = count("connectors")
      val create = Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(JsObject(
        "name" -> JsString("RolledBackRest"), "roots" -> JsArray(bareUrlRestRoot()), "steps" -> JsArray(), "outputs" -> JsArray()
      )))
      val failing = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update", None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      val response = await(applyService.apply(PatchSet(None, Vector(create, failing)), user)).fold(e => fail(s"expected Right, got $e"), identity)
      response.failure shouldBe defined
      response.edits.find(_.index == 0).map(_.status) shouldBe Some("rolledBack")
      count("data_sources") shouldBe sourcesBefore
      count("connectors") shouldBe connectorsBefore
    }
  }

  "PatchSetApplyRollback.deleteInlineRootSources (HEL-1475 path 5)" should {

    "report unrecoverable and delete NO source when the request and summary root counts differ" in {
      val sourcesBefore = count("data_sources")
      val request       = CreatePipelineRequest(s"mismatch-${UUID.randomUUID()}", Vector(datasetRoot(), datasetRoot()))
      val (edit, forward) = forwardCreate(request)
      count("data_sources") shouldBe sourcesBefore + 2
      val outcome = rollBack(edit, withSummaryRoots(forward, _.take(1)))
      outcome.status shouldBe "unrecoverable"
      count("data_sources") shouldBe sourcesBefore + 2
    }

    "report unrecoverable and delete the other inline sources when an inline root's summary entry has no dataSourceId" in {
      val sourcesBefore = count("data_sources")
      val request       = CreatePipelineRequest(s"missing-${UUID.randomUUID()}", Vector(datasetRoot(), datasetRoot()))
      val (edit, forward) = forwardCreate(request)
      val outcome = rollBack(edit, withSummaryRoots(forward, roots => Vector(roots.head, JsObject(roots(1).asJsObject.fields - "dataSourceId"))))
      outcome.status shouldBe "unrecoverable"
      count("data_sources") shouldBe sourcesBefore + 1
    }

    // GUARD (green before the fix, failable by mutation): the real pipeline is deleted first, so the inline source is
    // unreferenced and an ATTEMPTED source delete would drop the count; rollback's own pipeline delete then fails (not found).
    "report unrecoverable and attempt no source delete when the pipeline delete fails (guard)" in {
      val sourcesBefore = count("data_sources")
      val request       = CreatePipelineRequest(s"keep-${UUID.randomUUID()}", Vector(datasetRoot()))
      val (edit, forward) = forwardCreate(request)
      await(pipelineService.delete(PipelineId(forward.newId.get), user)).fold(e => fail(s"setup delete failed: $e"), identity)
      count("data_sources") shouldBe sourcesBefore + 1
      val outcome = rollBack(edit, forward)
      outcome.status shouldBe "unrecoverable"
      count("data_sources") shouldBe sourcesBefore + 1
    }

    "roll back normally when counts line up and every inline root carries its id (guard)" in {
      val sourcesBefore = count("data_sources")
      val request       = CreatePipelineRequest(s"lined-up-${UUID.randomUUID()}", Vector(datasetRoot()))
      val (edit, forward) = forwardCreate(request)
      rollBack(edit, forward).status shouldBe "rolledBack"
      count("data_sources") shouldBe sourcesBefore
    }
  }
}
