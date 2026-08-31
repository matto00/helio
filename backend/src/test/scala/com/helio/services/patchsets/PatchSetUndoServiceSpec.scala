package com.helio.services.patchsets


import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.metrics.UpdateMetricRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse, UpdateDataTypeRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.metrics.MetricService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetUndoService}
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
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

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Service-level coverage for `PatchSetUndoService.undo` (HEL-413, tasks.md 5.3) —
 *  embedded-Postgres integration tests, mirroring `PatchSetApplyServiceSpec`'s fixture
 *  convention exactly. Route-level 404/409 status mapping lives in `PatchSetUndoRoutesSpec`
 *  (tasks.md 5.4). */
class PatchSetUndoServiceSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll with JsonProtocols {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres         = _
  private var db: JdbcBackend.Database                   = _
  private var dashboardRepo: DashboardRepository         = _
  private var panelRepo: PanelRepository                 = _
  private var dataSourceRepo: DataSourceRepository       = _
  private var dataTypeRepo: DataTypeRepository           = _
  private var dataTypeRowRepo: DataTypeRowRepository     = _
  private var metricRepo: MetricRepository               = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository           = _
  private var pipelineStepRepo: PipelineStepRepository   = _
  private var applicationRepo: PatchSetApplicationRepository = _

  private var dashboardService: DashboardService   = _
  private var panelService: PanelService           = _
  private var dataSourceService: DataSourceService = _
  private var dataTypeService: DataTypeService     = _
  private var pipelineService: PipelineService     = _
  private var metricService: MetricService         = _
  private var applyService: PatchSetApplyService   = _
  private var undoService: PatchSetUndoService      = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

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
    dataTypeRepo      = new DataTypeRepository(ctx)
    dataTypeRowRepo   = new DataTypeRowRepository(ctx)
    metricRepo        = new MetricRepository(ctx)
    permissionRepo    = new ResourcePermissionRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    pipelineStepRepo  = new PipelineStepRepository(ctx)
    applicationRepo   = new PatchSetApplicationRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-undo-service-spec"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker)
    panelService        = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
    dataTypeService     = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
    metricService        = new MetricService(metricRepo, dataTypeRepo)

    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker, applicationRepo
    )
    undoService = new PatchSetUndoService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      applicationRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)


  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  private def seedDashboard(owner: AuthenticatedUser, name: String = "Dashboard"): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some(name)), owner))._1

  private def seedPanel(dashboardId: DashboardId, owner: AuthenticatedUser, title: String = "Panel"): Panel =
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("divider"), None), owner)) match {
      case Right(p) => p
      case Left(e)  => fail(s"seedPanel failed: $e")
    }

  private def seedStaticSource(owner: AuthenticatedUser, name: String = "Source"): (DataSourceId, DataTypeId) = {
    val ds = await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      owner
    )) match {
      case Right(d) => d
      case Left(e)  => fail(s"seedStaticSource failed: $e")
    }
    val companion = await(dataTypeRepo.findBySourceId(ds.id, owner.id)).headOption.getOrElse(fail("companion type missing"))
    (ds.id, companion.id)
  }

  private def seedPipelineOutputType(owner: AuthenticatedUser, name: String): DataType = {
    val now = Instant.now()
    val dt = DataType(DataTypeId(UUID.randomUUID().toString), None, name, Vector(DataField("value", "value", "integer", nullable = true)), Vector.empty, 1, now, now, owner.id)
    await(dataTypeRepo.insert(dt, owner))
  }

  private def seedPipeline(owner: AuthenticatedUser, sourceId: DataSourceId, name: String = "Pipeline"): PipelineSummaryResponse =
    await(pipelineService.create(CreatePipelineRequest(name, sourceId.value), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipeline failed: $e")
    }

  private def seedPipelineStep(
      pipelineId: PipelineId,
      owner: AuthenticatedUser,
      kind: String,
      config: JsObject,
      enabled: Option[Boolean] = None
  ): PipelineStepResponse =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest(kind, config, enabled = enabled), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipelineStep failed: $e")
    }

  private def seedMetric(owner: AuthenticatedUser, dataTypeId: DataTypeId, name: String = "Metric"): MetricId = {
    val now = Instant.now()
    val m = MetricDefinition(
      id                = MetricId(UUID.randomUUID().toString),
      ownerId           = owner.id,
      dataTypeId        = dataTypeId,
      name              = name,
      description       = None,
      measureField      = "value",
      aggregation       = "sum",
      allowedDimensions = Vector.empty,
      format            = MetricFormat(None, None, None, None),
      createdAt         = now,
      updatedAt         = now
    )
    await(metricRepo.insert(m, owner)) match {
      case Right(inserted) => inserted.id
      case Left(err)       => fail(s"seedMetric failed: $err")
    }
  }

  private def applySuccessfully(edits: Vector[Edit], user: AuthenticatedUser = userA): String =
    await(applyService.apply(PatchSet(None, edits), user)) match {
      case Right(r) if r.applicationId.isDefined => r.applicationId.get
      case other                                  => fail(s"expected a successful, journaled apply, got $other")
    }


  "PatchSetUndoService.undo" should {

    // HEL-904 task 3.3: `dataType` dropped from this scenario's edit set --
    // `dataType` is no longer a valid target.kind at all.
    "restore panel/dashboard/dataSource/pipeline/pipelineStep update edits to their pre-apply state (5.3a)" in {
      val dashboard          = seedDashboard(userA, "Dashboard v1")
      val panel               = seedPanel(dashboard.id, userA, "Panel v1")
      val (dataSourceId, _)   = seedStaticSource(userA, "Source v1")
      val (pipelineSrcId, _)  = seedStaticSource(userA, "Pipeline source v1")
      val pipeline             = seedPipeline(userA, pipelineSrcId, "Pipeline v1")
      // HEL-705 (2.6): seeded DISABLED so the full-revert undo path is asserted to preserve the
      // captured `enabled` state, mirroring 5.3c's delete-and-recreate coverage below.
      val step                  = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("a" -> JsString("b"))), enabled = Some(false)
      )

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Panel v2"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Dashboard v2"), None, None)), None, None, None, None),
        Edit(EditTarget("dataSource", Some(dataSourceId.value)), "update",
          None, None, Some(UpdateDataSourceRequest(name = Some("Source v2"))), None, None, None),
        Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
          None, None, None, Some(UpdatePipelineRequest(name = "Pipeline v2")), None, None),
        Edit(EditTarget("pipelineStep", Some(step.id)), "update",
          None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(JsObject("renames" -> JsObject("x" -> JsString("y")))), None)), None)
      )
      val applicationId = applySuccessfully(edits)

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(response) => response.edits.map(_.status) shouldBe Vector.fill(5)("restored")
        case Left(err)         => fail(s"expected success, got $err")
      }

      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Panel v1")
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Dashboard v1")
      await(dataSourceRepo.findByIdInternal(dataSourceId)).map(_.name) shouldBe Some("Source v1")
      await(pipelineRepo.findByIdInternal(PipelineId(pipeline.id))).map(_.name) shouldBe Some("Pipeline v1")
      val restoredStep = await(pipelineStepRepo.findByIdInternal(PipelineStepId(step.id))).getOrElse(fail("step missing"))
      restoredStep.asInstanceOf[RenameStep].config.renames shouldBe Map("a" -> "b")
      // HEL-705 (2.6): the full-revert undo must NOT silently come back enabled.
      restoredStep.enabled shouldBe false
    }


    "restore a panel create edit by deleting the created panel, and a panel delete edit by recreating it under a new id (5.3b)" in {
      val dashboard     = seedDashboard(userA)
      val panelToDelete = seedPanel(dashboard.id, userA, "Delete me")

      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("Created by patch set"),
        "type"        -> JsString("divider")
      )
      val edits = Vector(
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch)),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None)
      )
      val applyResponse = await(applyService.apply(PatchSet(None, edits), userA)) match {
        case Right(r) if r.applicationId.isDefined => r
        case other                                  => fail(s"expected a successful, journaled apply, got $other")
      }
      val createdPanelId = applyResponse.edits.find(_.index == 0).flatMap(_.newId).getOrElse(fail("expected newId"))
      val applicationId  = applyResponse.applicationId.get

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      val createUndo = undoResponse.edits.find(_.index == 0).getOrElse(fail("missing outcome"))
      createUndo.status shouldBe "restored"
      // skeptic-final-2.md CR1: `newId` carries the just-deleted resource's OWN id (not a
      // freshly-minted one -- nothing new was created) so a caller can still identify which
      // resource was removed once `resultingState`/`priorState` are both unavailable.
      createUndo.newId shouldBe Some(createdPanelId)
      val deleteUndo = undoResponse.edits.find(_.index == 1).getOrElse(fail("missing outcome"))
      deleteUndo.status shouldBe "recreated"
      val recreatedId = deleteUndo.newId.getOrElse(fail("expected newId"))
      recreatedId should not be panelToDelete.id.value

      await(panelRepo.findByIdInternal(PanelId(createdPanelId))) shouldBe None
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe None
      await(panelRepo.findByIdInternal(PanelId(recreatedId))).map(_.title) shouldBe Some("Delete me")
    }

    // skeptic-final-2.md CR1: a `dashboard` `create` edit's undo has no parent id to fall back
    // to on the frontend (unlike a panel create, whose original patch still carries a
    // `dashboardId`) -- `newId` on the `EditUndoOutcome` itself is the ONLY surviving way to
    // identify which dashboard was removed once `resultingState`/`priorState` are both absent.
    "restore a dashboard create edit by deleting the created dashboard, with newId populated on the undo outcome (5.3b-dashboard)" in {
      val createPatch = JsObject("name" -> JsString("Created by patch set"))
      val edit = Edit(EditTarget("dashboard", None), "create", None, None, None, None, None, Some(createPatch))
      val applyResponse = await(applyService.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(r) if r.applicationId.isDefined => r
        case other                                  => fail(s"expected a successful, journaled apply, got $other")
      }
      val createdDashboardId = applyResponse.edits.head.newId.getOrElse(fail("expected newId"))
      val applicationId      = applyResponse.applicationId.get

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      val outcome = undoResponse.edits.head
      outcome.status shouldBe "restored"
      outcome.newId shouldBe Some(createdDashboardId)
      outcome.resultingState shouldBe None

      await(dashboardRepo.findByIdInternal(DashboardId(createdDashboardId))) shouldBe None
    }

    "restore a pipelineStep delete edit by recreating it with its content restored (5.3c)" in {
      val (sourceId, _) = seedStaticSource(userA, "Step-delete pipeline source")
      val pipeline        = seedPipeline(userA, sourceId, "Step-delete pipeline")
      // HEL-705: seeded DISABLED so the delete-and-recreate undo path is asserted to preserve
      // (not silently drop) the captured `enabled` state.
      val step              = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("old" -> JsString("new"))), enabled = Some(false)
      )

      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "delete", None, None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit))

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      undoResponse.edits.head.status shouldBe "recreated"
      val recreatedId = undoResponse.edits.head.newId.getOrElse(fail("expected newId"))

      await(pipelineStepRepo.findByIdInternal(PipelineStepId(step.id))) shouldBe None
      val recreated = await(pipelineStepRepo.findByIdInternal(PipelineStepId(recreatedId))).getOrElse(fail("recreated step missing"))
      recreated.asInstanceOf[RenameStep].config.renames shouldBe Map("old" -> "new")
      // HEL-705: the recreated step must NOT silently come back enabled.
      recreated.enabled shouldBe false
    }

    // ── 5.3d: structurally-unrecoverable delete-kind blocks the WHOLE undo ──

    "refuse the whole undo when the application contains a structurally-unrecoverable delete edit, restoring nothing else in that application (5.3d)" in {
      val dashboard      = seedDashboard(userA)
      val panel            = seedPanel(dashboard.id, userA, "Before")
      val (sourceId, _)    = seedStaticSource(userA, "Unrecoverable pipeline source")
      val pipeline          = seedPipeline(userA, sourceId, "To delete")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("After"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("pipeline", Some(pipeline.id)), "delete", None, None, None, None, None, None)
      )
      val applicationId = applySuccessfully(edits)

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Left(ServiceError.Conflict(msg)) => msg.toLowerCase should include("unrecoverable")
        case other                              => fail(s"expected Conflict, got $other")
      }
      // Nothing was restored -- the panel-update edit's undo never ran.
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("After")
    }


    "refuse the whole undo when a touched resource conflicts, restoring none of the application's edits (5.3e)" in {
      val dashboard = seedDashboard(userA, "Conflict dashboard v1")
      val panel     = seedPanel(dashboard.id, userA, "Conflict panel v1")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Conflict panel v2"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Conflict dashboard v2"), None, None)), None, None, None, None)
      )
      val applicationId = applySuccessfully(edits)

      // Independent change since the apply -- a genuine conflict on the panel's title.
      await(panelService.update(panel.id, UpdatePanelRequest(Some("Changed by someone else"), None, None, None), userA)) match {
        case Right(_) => ()
        case Left(err) => fail(s"setup failed: $err")
      }

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Left(ServiceError.Conflict(_)) => succeed
        case other                            => fail(s"expected Conflict, got $other")
      }
      // Neither edit was restored -- the dashboard-update edit's undo never ran either.
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Conflict dashboard v2")
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Changed by someone else")
    }

    // ── 5.3f: an unforeseeable Phase-2 failure reports an honest mixed outcome ─

    "report a Phase-2 runtime failure honestly: the failed edit failed, earlier-index edits notAttempted, later-index edits still restored (5.3f)" in {
      val dashboardMain = seedDashboard(userA, "Main dashboard")
      val panelA          = seedPanel(dashboardMain.id, userA, "Panel A v1")
      val dashboardDoomed = seedDashboard(userA, "Doomed dashboard")
      val panelB            = seedPanel(dashboardDoomed.id, userA, "Panel B")
      val panelC              = seedPanel(dashboardMain.id, userA, "Panel C v1")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panelA.id.value)), "update",
          Some(UpdatePanelRequest(Some("Panel A v2"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelB.id.value)), "delete", None, None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelC.id.value)), "update",
          Some(UpdatePanelRequest(Some("Panel C v2"), None, None, None)), None, None, None, None, None)
      )
      val applicationId = applySuccessfully(edits)

      // Independently delete panel B's dashboard AFTER the apply -- Phase 1 can't detect this
      // (a delete edit's undo is always "eligible", no live state to check), but Phase 2's
      // recreate (which targets the original dashboardId) now genuinely fails.
      await(dashboardService.delete(dashboardDoomed.id, userA)) match {
        case Right(_)  => ()
        case Left(err) => fail(s"setup failed: $err")
      }

      val response = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected a 200 with a mixed outcome (design.md D4), got $err")
      }
      response.edits.find(_.index == 2).map(_.status) shouldBe Some("restored")
      response.edits.find(_.index == 1).map(_.status) shouldBe Some("failed")
      response.edits.find(_.index == 0).map(_.status) shouldBe Some("notAttempted")

      // Panel C (higher index, restored earlier in the reverse walk) really was reverted...
      await(panelRepo.findByIdInternal(panelC.id)).map(_.title) shouldBe Some("Panel C v1")
      // ...but panel A (lower index, notAttempted) was NOT compensated back -- still at its
      // post-apply value, per design.md D4's documented narrower guarantee.
      await(panelRepo.findByIdInternal(panelA.id)).map(_.title) shouldBe Some("Panel A v2")
    }


    "reject undoing another user's application (404), touching nothing (5.3g)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Owner only")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Should never apply"), None, None, None)), None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit))

      await(undoService.undo(PatchSetApplicationId(applicationId), userB)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound, got $other")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Should never apply")
    }

    "reject undoing a nonexistent applicationId (404) -- the same behavior a pruned id would exhibit (5.3g)" in {
      await(undoService.undo(PatchSetApplicationId(UUID.randomUUID().toString), userA)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound, got $other")
      }
    }


    // HEL-904: metric-bound raw-override conflict detection (5.3h) removed -- metrics no longer exist.

    "NOT treat an unrelated metric deprecation (no raw-field change) as a conflict (5.3h negative)" in {
      val dashboard  = seedDashboard(userA)
      val outputType = seedPipelineOutputType(userA, "Metric deprecation type")
      val metricId   = seedMetric(userA, outputType.id, "Metric to deprecate")
      val panel      = seedPanel(dashboard.id, userA, "Bound panel for deprecation")

      val bindPatch = JsObject("metricId" -> JsString(metricId.value))
      val bindEdit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(None, None, None, Some(bindPatch))), None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(bindEdit))

      // Deprecate the metric -- no raw config field on the panel itself changes.
      await(metricService.update(metricId, UpdateMetricRequest.Empty.copy(deprecated = Some(true)), userA)) match {
        case Right(_)  => ()
        case Left(err) => fail(s"setup failed: $err")
      }

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(response) => response.edits.head.status shouldBe "restored"
        case Left(err)         => fail(s"expected success (no conflict), got $err")
      }
    }
  }
}
