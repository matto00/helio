package com.helio.services.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.domain.model._
import com.helio.domain.steps.LimitConfig
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1482 item 7: pins the pipeline-grant branches of the patch-set pipelineStep gate
 *  (`PatchSetResolverSupport.authorizeEditorOrOwnerOnPipeline`) against the REST step rule
 *  (`PipelineService.requireEditorAccess`): the owner or an `editor` grantee may edit steps, a `viewer`
 *  grantee gets 403. Before this spec no test granted a pipeline role and then submitted a pipelineStep
 *  patch-set edit, so weakening either grant branch left every targeted spec green.
 *
 *  Viewer cases assert the EXACT pre-validation `Left(ServiceError.Forbidden())`: forward apply
 *  re-checks editor access through `PipelineService`, so a weakened gate alone would end as
 *  `Right(... failure ...)` (HTTP 200) with nothing mutated, which a "nothing mutated" check cannot tell
 *  from the correct 403. Both entry points are covered: apply via [[PatchSetApplyService]] and preview via
 *  [[PatchSetPreviewService]] (they share `resolveAll`). */
class PatchSetPipelineStepGrantSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var pipelineService: PipelineService             = _
  private var dataSourceService: DataSourceService         = _
  private var applyService: PatchSetApplyService           = _
  private var previewService: PatchSetPreviewService       = _

  private val ownerId   = UUID.randomUUID().toString
  private val granteeId = UUID.randomUUID().toString
  private val owner     = AuthenticatedUser(UserId(ownerId))
  private val grantee   = AuthenticatedUser(UserId(granteeId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dashboardRepo  = new DashboardRepository(ctx)
    val panelRepo      = new PanelRepository(ctx)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val permissionRepo = new ResourcePermissionRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo   = new PipelineStepRepository(ctx)
    val outputRepo     = new OutputRepository(ctx)
    val applicationRepo = new PatchSetApplicationRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-pipeline-step-grant-spec"))

    val dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    val panelService     = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dataSourceService    = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    val outputService    = new OutputService(outputRepo, panelRepo, accessChecker)

    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo,
      outputRepo, outputService
    )
    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, outputRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, ${s"grantee-$granteeId@helio.test"}, now())"""
    )))
  }

  private def grantPipelineRole(pipelineId: String, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pipelineId, ${granteeId}::uuid, $role, now())"""
    ))
  }

  /** A fresh owner-owned pipeline with one `limit` step (count 5) and `grantee` granted `role` on it. */
  private def seedGrantedPipeline(role: String): (PipelineSummaryResponse, PipelineStepResponse) = {
    val source = await(dataSourceService.createStatic(
      StaticDataSourceRequest("Grant source", "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      owner
    )).getOrElse(fail("seed source failed"))
    val pipeline = await(pipelineService.create(CreatePipelineRequest("Grant pipeline", Vector(CreatePipelineRootRequest(Some(source.id.value)))), owner))
      .getOrElse(fail("seed pipeline failed"))
    val step = await(pipelineService.addStep(PipelineId(pipeline.id), CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(5))), owner))
      .getOrElse(fail("seed step failed"))
    grantPipelineRole(pipeline.id, role)
    (pipeline, step)
  }

  private def updateEdit(stepId: String): Edit =
    Edit(EditTarget("pipelineStep", Some(stepId)), "update", None, None, None, None,
      Some(UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(10))), None)), None)

  private def deleteEdit(stepId: String): Edit =
    Edit(EditTarget("pipelineStep", Some(stepId)), "delete", None, None, None, None, None, None)

  private def createEdit(pipelineId: String): Edit =
    Edit(EditTarget("pipelineStep", None, Some(pipelineId)), "create", None, None, None, None, None,
      Some(JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1)))))

  private def applyAs(edit: Edit) = await(applyService.apply(PatchSet(None, Vector(edit)), grantee))

  private def stepLimit(stepId: String): Int =
    await(pipelineStepRepo.findByIdInternal(PipelineStepId(stepId))).getOrElse(fail("step vanished")).configValue
      .asInstanceOf[LimitConfig].count

  "patch-set pipelineStep gate, editor pipeline grantee (same as PipelineService.requireEditorAccess)" should {

    "apply a pipelineStep update and change the step" in {
      val (_, step) = seedGrantedPipeline("editor")
      val resp = applyAs(updateEdit(step.id)).getOrElse(fail("expected an editor grantee's update to be accepted"))
      resp.failure shouldBe None
      resp.edits.head.status shouldBe "applied"
      stepLimit(step.id) shouldBe 10
    }

    "apply a pipelineStep delete and remove the step" in {
      val (_, step) = seedGrantedPipeline("editor")
      val resp = applyAs(deleteEdit(step.id)).getOrElse(fail("expected an editor grantee's delete to be accepted"))
      resp.failure shouldBe None
      resp.edits.head.status shouldBe "applied"
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(step.id))) shouldBe None
    }

    "apply a pipelineStep create naming the granted pipeline and create the step" in {
      val (pipeline, _) = seedGrantedPipeline("editor")
      val resp = applyAs(createEdit(pipeline.id)).getOrElse(fail("expected an editor grantee's create to be accepted"))
      resp.failure shouldBe None
      resp.edits.head.status shouldBe "applied"
      val newId = resp.edits.head.newId.getOrElse(fail("no newId"))
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(newId))) shouldBe defined
    }

    "accept a pipelineStep update on preview and write nothing" in {
      val (_, step) = seedGrantedPipeline("editor")
      val result = await(previewService.preview(PatchSet(None, Vector(updateEdit(step.id))), grantee))
      result.isRight shouldBe true
      stepLimit(step.id) shouldBe 5
    }
  }

  "patch-set pipelineStep gate, viewer pipeline grantee (REST step rule: 403)" should {

    "refuse a pipelineStep update with exactly Forbidden, leaving the step unchanged" in {
      val (_, step) = seedGrantedPipeline("viewer")
      applyAs(updateEdit(step.id)) shouldBe Left(ServiceError.Forbidden())
      stepLimit(step.id) shouldBe 5
    }

    "refuse a pipelineStep delete with exactly Forbidden, leaving the step in place" in {
      val (_, step) = seedGrantedPipeline("viewer")
      applyAs(deleteEdit(step.id)) shouldBe Left(ServiceError.Forbidden())
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(step.id))) shouldBe defined
    }

    "refuse a pipelineStep create with exactly Forbidden, creating nothing" in {
      val (pipeline, _) = seedGrantedPipeline("viewer")
      applyAs(createEdit(pipeline.id)) shouldBe Left(ServiceError.Forbidden())
      await(pipelineStepRepo.listByPipelineInternal(PipelineId(pipeline.id))).size shouldBe 1
    }

    "refuse a pipelineStep update on preview with exactly Forbidden" in {
      val (_, step) = seedGrantedPipeline("viewer")
      await(previewService.preview(PatchSet(None, Vector(updateEdit(step.id))), grantee)) shouldBe Left(ServiceError.Forbidden())
    }
  }

  "patch-set pipelineStep gate, pipeline owner" should {

    "apply a pipelineStep update with no grant at all" in {
      val (_, step) = seedGrantedPipeline("viewer") // the grant belongs to `grantee`; the owner needs none
      val resp = await(applyService.apply(PatchSet(None, Vector(updateEdit(step.id))), owner)).getOrElse(fail("owner update must be accepted"))
      resp.failure shouldBe None
      stepLimit(step.id) shouldBe 10
    }
  }
}
