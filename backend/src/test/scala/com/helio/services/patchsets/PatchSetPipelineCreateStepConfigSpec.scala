package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
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

/** HEL-1402: a patch-set `pipeline` create edit whose inline step config another write surface
 *  would reject fails at resolve time (422) -- for apply and for preview -- before any edit applies. */
class PatchSetPipelineCreateStepConfigSpec
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
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
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

    dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-pipeline-create-step-config")))
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    applyService = new PatchSetApplyService(
      new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo),
      new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo),
      dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx), outputRepo
    )
    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo
    )

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"a-$userId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedSource(): DataSourceId =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest("Source", "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))), user
    )).fold(e => fail(s"seed source failed: $e"), _.id)

  private def pipelineCreateEdit(sourceId: DataSourceId, name: String, computeExpression: String): Edit = {
    val patch = JsObject(
      "name"  -> JsString(name),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(sourceId.value))),
      "steps" -> JsArray(JsObject(
        "clientId" -> JsString("calc"),
        "type"     -> JsString("compute"),
        "config"   -> JsObject("column" -> JsString("c"), "expression" -> JsString(computeExpression))
      ))
    )
    Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(patch))
  }

  private def pipelineNames(): Set[String] =
    await(pipelineRepo.listSummaries(user)).map(_.name).toSet

  "a patch-set pipeline create edit with an invalid inline step config" should {

    "be rejected on apply with 422 naming the edit and step, applying no earlier edit and creating no pipeline" in {
      val sourceId = seedSource()
      val existing = await(pipelineService.create(CreatePipelineRequest("Before", Vector(CreatePipelineRootRequest(Some(sourceId.value)))), user))
        .fold(e => fail(s"seed pipeline failed: $e"), identity)
      val rename = Edit(EditTarget("pipeline", Some(existing.id)), "update", None, None, None, Some(UpdatePipelineRequest("After")), None, None)
      val bad    = pipelineCreateEdit(sourceId, "Created", "$a + nosuchfn($b)")

      await(applyService.apply(PatchSet(None, Vector(rename, bad)), user)) match {
        case Left(ServiceError.UnprocessableEntity(msg)) =>
          msg should startWith("edit 1: Step 'calc': ")
          msg should include("nosuchfn")
        case other => fail(s"expected 422, got $other")
      }
      pipelineNames() should (contain("Before") and not contain "After" and not contain "Created")
    }

    "be rejected on preview with 422" in {
      val sourceId = seedSource()
      val bad      = pipelineCreateEdit(sourceId, "PreviewCreated", "nosuchfn(1)")
      await(previewService.preview(PatchSet(None, Vector(bad)), user)) match {
        case Left(ServiceError.UnprocessableEntity(msg)) => msg should startWith("edit 0: Step 'calc': ")
        case other                                         => fail(s"expected 422, got $other")
      }
    }

    // HEL-1416: clearly invalid fillnull/window/pivot enum values, one per kind, on apply AND preview.
    "reject an invalid fillnull strategy, lag offset and pivot agg on apply and preview, creating no pipeline (HEL-1416)" in {
      val sourceId = seedSource()
      val cases = Seq(
        ("fillnull", JsObject("columns" -> JsArray(JsString("value")), "strategy" -> JsString("average")), "Unsupported fillnull strategy: 'average'"),
        ("window", JsObject("function" -> JsString("lag"), "field" -> JsString("value"), "offset" -> JsNumber(0), "outputColumn" -> JsString("o")), "requires a positive 'offset'"),
        ("pivot", JsObject("column" -> JsString("value"), "values" -> JsString("value"), "agg" -> JsString("median")), "Unsupported pivot aggregation function: 'median'")
      )
      for ((kind, cfg, frag) <- cases) {
        val name = s"enum-$kind"
        val edit = Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(JsObject(
          "name"  -> JsString(name),
          "roots" -> JsArray(JsObject("sourceId" -> JsString(sourceId.value))),
          "steps" -> JsArray(JsObject("clientId" -> JsString("s1"), "type" -> JsString(kind), "config" -> cfg))
        )))
        val results = Seq(
          withClue(s"$kind apply: ")(await(applyService.apply(PatchSet(None, Vector(edit)), user)).swap.toOption),
          withClue(s"$kind preview: ")(await(previewService.preview(PatchSet(None, Vector(edit)), user)).swap.toOption)
        )
        results.foreach {
          case Some(ServiceError.UnprocessableEntity(msg)) =>
            msg should startWith("edit 0: Step 's1': ")
            msg should include(frag)
          case other => fail(s"$kind: expected 422, got $other")
        }
        pipelineNames() should not contain name
      }
    }

    "still apply when the step config is valid" in {
      val sourceId = seedSource()
      val ok       = pipelineCreateEdit(sourceId, "ValidCreated", "1 + 1")
      await(applyService.apply(PatchSet(None, Vector(ok)), user)).fold(e => fail(s"expected Right, got $e"), _.failure shouldBe None)
      pipelineNames() should contain("ValidCreated")
    }
  }
}
