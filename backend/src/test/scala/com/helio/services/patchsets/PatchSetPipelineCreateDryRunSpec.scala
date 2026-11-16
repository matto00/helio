package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, UpdatePipelineRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.JsonProtocols
import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
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

/** HEL-1638 D1b: a patch-set `pipeline` create edit runs the shared create dry run at resolve (apply AND preview). */
class PatchSetPipelineCreateDryRunSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceService: DataSourceService = _
  private var pipelineRepo: PipelineRepository     = _
  private var pipelineService: PipelineService     = _
  private var applyService: PatchSetApplyService   = _
  private var previewService: PatchSetPreviewService = _

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
    pipelineRepo         = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val outputRepo       = new OutputRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)

    dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-pipeline-create-dryrun")))
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    applyService = new PatchSetApplyService(
      new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo),
      new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo),
      dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx), outputRepo
    )
    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo, null, SourceFetchBudget.default()
    )

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"a-$userId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def pipelineNames(): Set[String] = await(pipelineRepo.listSummaries(user)).map(_.name).toSet

  private def outputEdit(name: String, root: JsObject, column: String): Edit = {
    val patch = JsObject(
      "name"    -> JsString(name),
      "roots"   -> JsArray(root),
      "outputs" -> JsArray(JsObject(
        "kind" -> JsString("chart"), "name" -> JsString("Out"), "rootClientId" -> JsString("r0"),
        "config" -> JsObject("chartType" -> JsString("bar"), "fieldMapping" -> JsObject("xAxis" -> JsString("team"), "yAxis" -> JsString(column)))
      ))
    )
    Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(patch))
  }

  private def staticRoot(): JsObject = JsObject(
    "type" -> JsString("static"), "name" -> JsString("Inline"), "clientId" -> JsString("r0"),
    "staticConfig" -> JsObject(
      "columns" -> JsArray(JsObject("name" -> JsString("team"), "type" -> JsString("string")), JsObject("name" -> JsString("wins"), "type" -> JsString("integer"))),
      "rows"    -> JsArray(JsArray(JsString("a"), JsNumber(1)))
    )
  )

  private def existingRoot(sourceId: DataSourceId): JsObject =
    JsObject("sourceId" -> JsString(sourceId.value), "clientId" -> JsString("r0"))

  private def seedSource(): DataSourceId =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest("Source", "static", Vector(StaticColumnPayload("team", "string"), StaticColumnPayload("wins", "integer")), Vector(Vector(JsString("a"), JsNumber(1)))), user
    )).fold(e => fail(s"seed source failed: $e"), _.id)

  "a patch-set pipeline create edit whose Output maps a column the node lacks" should {
    "be rejected on preview and apply with the column message, creating nothing (existing-source root)" in {
      val edit = outputEdit("DryMissing", existingRoot(seedSource()), "losses")
      for (r <- Seq(await(previewService.preview(PatchSet(None, Vector(edit)), user)).swap.toOption,
                    await(applyService.apply(PatchSet(None, Vector(edit)), user)).swap.toOption)) {
        r.map(_.message).getOrElse("") should (startWith("edit 0: ") and include("losses"))
      }
      pipelineNames() should not contain "DryMissing"
    }

    "accept a mapped existing column on an inline static root, and reject a missing one" in {
      val ok = outputEdit("DryInlineOk", staticRoot(), "wins")
      await(previewService.preview(PatchSet(None, Vector(ok)), user)).isRight shouldBe true
      val bad = outputEdit("DryInlineBad", staticRoot(), "losses")
      await(previewService.preview(PatchSet(None, Vector(bad)), user)).swap.toOption.map(_.message).getOrElse("") should (startWith("edit 0: ") and include("losses"))
      await(applyService.apply(PatchSet(None, Vector(bad)), user)).swap.toOption.map(_.message).getOrElse("") should include("losses")
      pipelineNames() should not contain "DryInlineBad"
    }
  }
}
