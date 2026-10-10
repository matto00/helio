package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
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

/** HEL-1469: a patch-set `pipeline` create edit with an INLINE root source must not leave that source
 *  behind when it is refused (resolve time) or rolled back (a later edit in the same apply failed).
 *  Rows are counted in `data_sources` by the exact test owner id. */
class PatchSetPipelineCreateOrphanSourceSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceService: DataSourceService = _
  private var pipelineRepo: PipelineRepository     = _
  private var dashboardService: DashboardService  = _
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

    dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("patch-set-pipeline-create-orphan-source")))
    dashboardService  = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    pipelineService   = new PipelineService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo,
      sourceService = new SourceService(dataSourceRepo, connector = null), dataSourceService = dataSourceService
    )
    applyService = new PatchSetApplyService(
      new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo),
      dashboardService,
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

  private def ownedSourceCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM data_sources WHERE owner_id = $userId::uuid".as[Int])).head
  }

  private def pipelineNames(): Set[String] =
    await(pipelineRepo.listSummaries(user)).map(_.name).toSet

  private def inlineRoot(): JsObject = JsObject(
    "type"         -> JsString("dataset"),
    "name"         -> JsString(s"inline-${UUID.randomUUID()}"),
    "staticConfig" -> JsObject(
      "columns" -> JsArray(JsObject("name" -> JsString("amount"), "type" -> JsString("number"))),
      "rows"    -> JsArray(JsArray(JsNumber(1)))
    )
  )

  private def createEdit(name: String, steps: Vector[JsObject] = Vector.empty, outputs: Vector[JsObject] = Vector.empty): Edit =
    Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(JsObject(
      "name"    -> JsString(name),
      "roots"   -> JsArray(inlineRoot()),
      "steps"   -> JsArray(steps),
      "outputs" -> JsArray(outputs)
    )))

  private val unknownTypeStep = JsObject("clientId" -> JsString("s"), "type" -> JsString("nosuchkind"), "config" -> JsObject())
  private val badOutput       = JsObject("kind" -> JsString("table"), "name" -> JsString("o"), "config" -> JsObject("notAKey" -> JsNumber(1)))

  "a patch-set inline-root pipeline create edit (HEL-1469)" should {

    "be refused on apply at resolve time (400, edit-prefixed) for an unknown step type, leaving no data source" in {
      val before = ownedSourceCount()
      await(applyService.apply(PatchSet(None, Vector(createEdit("OrphanApplyType", steps = Vector(unknownTypeStep)))), user)) match {
        case Left(ServiceError.BadRequest(msg)) => msg should (startWith("edit 0: ") and include("nosuchkind"))
        case other                              => fail(s"expected 400, got $other")
      }
      ownedSourceCount() shouldBe before
      pipelineNames() should not contain "OrphanApplyType"
    }

    "be refused on apply at resolve time (400) for a disallowed Output config key, leaving no data source" in {
      val before = ownedSourceCount()
      await(applyService.apply(PatchSet(None, Vector(createEdit("OrphanApplyOutput", outputs = Vector(badOutput)))), user)) match {
        case Left(ServiceError.BadRequest(msg)) => msg should startWith("edit 0: ")
        case other                              => fail(s"expected 400, got $other")
      }
      ownedSourceCount() shouldBe before
      pipelineNames() should not contain "OrphanApplyOutput"
    }

    "be refused on PREVIEW (4xx, edit-prefixed) instead of projecting, for an unknown step type and a bad Output config" in {
      val before = ownedSourceCount()
      for (edit <- Seq(createEdit("OrphanPreviewType", steps = Vector(unknownTypeStep)), createEdit("OrphanPreviewOutput", outputs = Vector(badOutput))))
        await(previewService.preview(PatchSet(None, Vector(edit)), user)) match {
          case Left(ServiceError.BadRequest(msg)) => msg should startWith("edit 0: ")
          case other                              => fail(s"expected 400, got $other")
        }
      ownedSourceCount() shouldBe before
    }

    "remove the pipeline AND its inline source when a LATER edit in the same apply fails (mid-set rollback)" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("rollback dash")), user))._1
      val before    = ownedSourceCount()
      val ok        = createEdit("OrphanRolledBack")
      // A blank dashboard name passes resolve-time checks but fails DashboardService.update: a genuine forward-apply-only failure.
      val failing = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update", None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      await(applyService.apply(PatchSet(None, Vector(ok, failing)), user)) match {
        case Right(response) =>
          response.failure shouldBe defined
          response.edits.find(_.index == 0).map(_.status) shouldBe Some("rolledBack")
        case Left(err) => fail(s"expected Right with failure reported, got Left($err)")
      }
      pipelineNames() should not contain "OrphanRolledBack"
      ownedSourceCount() shouldBe before
    }

    "still apply a valid inline-root create, keeping its source" in {
      val before = ownedSourceCount()
      await(applyService.apply(PatchSet(None, Vector(createEdit("OrphanValid"))), user)).fold(e => fail(s"expected Right, got $e"), _.failure shouldBe None)
      pipelineNames() should contain("OrphanValid")
      ownedSourceCount() shouldBe before + 1
    }
  }
}
