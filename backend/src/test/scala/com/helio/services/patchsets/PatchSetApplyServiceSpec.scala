package com.helio.services.patchsets


import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{OutputResponse, UpdateOutputRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse}
import com.helio.api.protocols.sources.{DataSourceResponse, StaticColumnPayload, StaticDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.PatchSetApplyService
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
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.domain.model._
import com.helio.domain.panels._
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

/** Service-level coverage for `PatchSetApplyService.apply` (HEL-406,
 *  tasks.md 7.2-7.7, 7.9-7.11) — embedded-Postgres integration tests,
 *  mirroring `BoundPanelRoutesSpec`/`DashboardPanelAclSpec`'s fixture
 *  convention. Route-level cross-owner coverage (7.8) lives in
 *  `PatchSetRoutesSpec`. `ScalatestRouteTest` is mixed in solely for its
 *  implicit `ActorSystem`/`Materializer` (`DataSourceService` needs one) —
 *  mirrors `DataSourceServiceSpec`'s own identical reason, no routes are
 *  exercised here. */
class PatchSetApplyServiceSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll with JsonProtocols {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres         = _
  private var db: JdbcBackend.Database                   = _
  private var dashboardRepo: DashboardRepository         = _
  private var panelRepo: PanelRepository                 = _
  private var dataSourceRepo: DataSourceRepository       = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository           = _
  private var pipelineStepRepo: PipelineStepRepository   = _
  private var outputRepo: OutputRepository               = _
  private var applicationRepo: PatchSetApplicationRepository = _

  private var dashboardService: DashboardService   = _
  private var panelService: PanelService           = _
  private var dataSourceService: DataSourceService = _
  private var pipelineService: PipelineService     = _
  private var outputService: OutputService         = _
  private var service: PatchSetApplyService        = _

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
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-apply-service-spec"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker)
    panelService        = new PanelService(panelRepo, accessChecker, dashboardRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)
    outputService        = new OutputService(outputRepo, panelRepo, accessChecker)

    service = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo,
      outputRepo, outputService
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

  private def grantRole(resourceType: String, resourceId: String, granteeId: String, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, ${granteeId}::uuid, $role, now())"""
    ))
  }

  private def seedDashboard(owner: AuthenticatedUser, name: String = "Dashboard"): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some(name)), owner))._1

  private def seedPanel(dashboardId: DashboardId, owner: AuthenticatedUser, title: String = "Panel"): Panel =
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("divider"), None), owner)) match {
      case Right((p, _)) => p
      case Left(e)  => fail(s"seedPanel failed: $e")
    }

  // HEL-904: no companion DataType to look up anymore — returns just the DataSourceId
  // (every call site already discarded the old tuple's second element).
  private def seedStaticSource(owner: AuthenticatedUser, name: String = "Source"): DataSourceId = {
    val ds = await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      owner
    )) match {
      case Right(d) => d
      case Left(e)  => fail(s"seedStaticSource failed: $e")
    }
    ds.id
  }

  private def seedPipeline(owner: AuthenticatedUser, sourceId: DataSourceId, name: String = "Pipeline"): PipelineSummaryResponse =
    await(pipelineService.create(CreatePipelineRequest(name, Vector(CreatePipelineRootRequest(Some(sourceId.value)))), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipeline failed: $e")
    }

  private def seedPipelineStep(
      pipelineId: PipelineId,
      owner: AuthenticatedUser,
      kind: String,
      config: JsObject,
      // HEL-907 evaluator-final-2: optional branch point, mirrors PatchSetUndoServiceSpec's own
      // fixture -- needed by the rollback-side HEL-766 regression test below.
      parentStepId: Option[String] = None
  ): PipelineStepResponse =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest(kind, config, parentStepId = parentStepId), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipelineStep failed: $e")
    }

  // HEL-907 task 1.2: seeds a source-attached (nodeStepId = None) `table`-kind Output --
  // outputRepo.insertInternal is ACL-bypassing (mirrors this file's other seed helpers' direct
  // service/repo use), so no separate pipeline-access setup is needed here.
  private def seedOutput(pipelineId: PipelineId, owner: AuthenticatedUser, name: String = "Output"): Output =
    await(outputRepo.insertInternal(pipelineId, None, owner.id, name, OutputKind.Table, explicitRootId = None))

  // Postgres TIMESTAMPTZ rounds to microsecond precision on write; a JVM
  // `Instant.now()` can carry nanosecond precision, and Java's own
  // `truncatedTo(MICROS)` truncates rather than rounds -- so a domain object
  // minted just before a DB round-trip (an `update`'s captured prior state,
  // a fresh `create`'s returned object) and the SAME row read back
  // afterward can legitimately differ by up to 1us despite representing the
  // same edit. These assertions care about CONTENT fidelity (title/config/
  // appearance/ownerId/etc, per ticket.md's "shared shape" AC), not
  // bit-exact clock precision, so the two volatile timestamp fields are
  // blanked before comparing rather than chasing an inherently-noisy match.
  private def panelResponseNormalized(json: JsValue): PanelResponse = {
    val r = json.convertTo[PanelResponse]
    r.copy(meta = r.meta.copy(createdAt = "", lastUpdated = ""))
  }

  "PatchSetApplyService.apply" should {

    "apply a mixed patch set (panel update + panel delete + dashboard update) cleanly, each reported applied (7.2)" in {
      val dashboard      = seedDashboard(userA)
      val panelToUpdate  = seedPanel(dashboard.id, userA, "To update")
      val panelToDelete  = seedPanel(dashboard.id, userA, "To delete")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToUpdate.id.value)), "update",
          Some(UpdatePanelRequest(Some("Updated title"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete",
          None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Renamed dashboard"), None, None)), None, None, None, None)
      )

      val result = await(service.apply(PatchSet(None, edits), userA))
      result match {
        case Right(response) =>
          response.failure shouldBe None
          response.edits.map(_.status) shouldBe Vector("applied", "applied", "applied")
        case Left(err) => fail(s"expected success, got $err")
      }

      await(panelRepo.findByIdInternal(panelToUpdate.id)).map(_.title) shouldBe Some("Updated title")
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe None
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Renamed dashboard")
    }


    "roll back every already-applied edit on a mid-set failure (7.3)" in {
      val dashboard     = seedDashboard(userA, "Original dashboard name")
      val panelToUpdate = seedPanel(dashboard.id, userA, "Original title")
      val panelToDelete = seedPanel(dashboard.id, userA, "Delete me")

      // The dashboard-update's blank name passes THIS service's pre-validation
      // (which only checks patch presence + ACL, not value-level shape) but
      // fails at DashboardService.update's own real validation -- a genuine
      // forward-apply-only failure, not a pre-validation rejection.
      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToUpdate.id.value)), "update",
          Some(UpdatePanelRequest(Some("Changed title"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete",
          None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )

      val result = await(service.apply(PatchSet(None, edits), userA))
      val response = result match {
        case Right(r) => r
        case Left(err) => fail(s"expected Right with failure reported, got Left($err)")
      }
      response.failure shouldBe defined
      response.edits.map(_.status).toSet shouldBe Set("rolledBack", "recreated")

      await(panelRepo.findByIdInternal(panelToUpdate.id)).map(_.title) shouldBe Some("Original title")
      // deleted panel recreated under a NEW id, content restored
      val deleteOutcome = response.edits.find(_.index == 1).getOrElse(fail("missing panel-delete outcome"))
      deleteOutcome.status shouldBe "recreated"
      val newPanelId = deleteOutcome.newId.getOrElse(fail("expected newId"))
      newPanelId should not be panelToDelete.id.value
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe None
      await(panelRepo.findByIdInternal(PanelId(newPanelId))).map(_.title) shouldBe Some("Delete me")
      // dashboard unchanged (name never actually changed -- the failing edit was never applied)
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Original dashboard name")
    }

    "roll back a mid-set pipelineStep delete by recreating it under its original parentStepId, not the trunk-append default (evaluator-final-2, exercises PatchSetApplyRollback directly)" in {
      // GUARD, not a regression proof (evaluator-final round-2 non-blocking note): this test's
      // production code path (PatchSetApplyRollback.pipelineStepCreateRequestFromPrior) was
      // ALREADY correct before this cycle -- `git show d36bb991^:` on this file confirms it
      // predates the fix commit unchanged. The genuine regression this cycle fixed was
      // PatchSetUndoInverse.pipelineStepCreateRequestFromResponse (the HEL-766 test below in
      // PatchSetUndoServiceSpec, a DIFFERENT code path -- a POST-application undo call, not a
      // mid-apply rollback). This test exists to cover PatchSetApplyRollback's own
      // inverse-builder directly, fired mid-`apply` when a LATER edit in the same batch fails
      // and an already-applied pipelineStep delete must be compensated within the same request
      // -- it is mutation-failable (verified: forcing parentStepId = None here fails this test),
      // which is the right bar for a guard, but it was never red for a real defect.
      val dashboard = seedDashboard(userA, "Rollback-pipelineStep dashboard")
      val sourceId  = seedStaticSource(userA, "Rollback-pipelineStep source")
      val pipeline  = seedPipeline(userA, sourceId, "Rollback-pipelineStep pipeline")
      val rootStep  = seedPipelineStep(PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("a" -> JsString("b"))))
      // A second trunk step, so rootStep is NOT the trunk-last step -- the load-bearing part of
      // the fixture, same reasoning as the sibling undo-path test: addStep's own default
      // (parentStepId absent -> splice onto the CURRENT trunk-last step) would otherwise
      // coincidentally match the real branch point and the assertion couldn't distinguish the
      // fix from its absence.
      val trunkTail = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("c" -> JsString("d"))),
        parentStepId = Some(rootStep.id)
      )
      val branchedStep = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("old" -> JsString("new"))),
        parentStepId = Some(rootStep.id)
      )

      val edits = Vector(
        Edit(EditTarget("pipelineStep", Some(branchedStep.id)), "delete", None, None, None, None, None, None),
        // Same real-forward-apply-time-failure device as the panel/dashboard rollback test above
        // (7.3): a blank dashboard name passes this service's own pre-validation but fails at
        // DashboardService.update's real validation, forcing a genuine rollback, not a
        // pre-validation short-circuit.
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update", None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )

      val result = await(service.apply(PatchSet(None, edits), userA))
      val response = result match {
        case Right(r)   => r
        case Left(err)  => fail(s"expected Right with failure reported, got Left($err)")
      }
      response.failure shouldBe defined
      val stepOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing pipelineStep-delete outcome"))
      stepOutcome.status shouldBe "recreated"
      val recreatedId = stepOutcome.newId.getOrElse(fail("expected newId"))

      val recreated = await(pipelineStepRepo.findByIdInternal(PipelineStepId(recreatedId))).getOrElse(fail("recreated step missing"))
      recreated.parentStepId shouldBe Some(PipelineStepId(rootStep.id))
      recreated.parentStepId should not be Some(PipelineStepId(trunkTail.id))
    }

    // skeptic-final-1.md CR1 regression: a rolled-back panel-update must
    // actually CLEAR an Option config field the forward edit had SET, not
    // just leave it at whatever the forward edit wrote. `encodeConfig`
    // omits a None-valued Option field entirely (plain jsonFormatN), and
    // Patch.decode treats an absent key as "leave the current value
    // unchanged" -- so a naive inverse built from the bare encoded config
    // would silently fail to restore an unset->set transition, even though
    // `status` still reports "rolledBack".
    "genuinely clear a config Option field that transitioned None->Some, when the update rolling it back is itself rolled back (skeptic-final-1.md CR1)" in {
      // HEL-904: rewired from the retired MetricPanel's `aggregation` field
      // onto DividerPanel's `weight` -- same D5 None->Some->rollback contract,
      // a still-live optional-field kind.
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Weighted divider panel")
      await(panelRepo.findByIdInternal(panel.id)).collect { case dp: DividerPanel => dp.config.weight } shouldBe Some(None)

      val setWeight = JsObject("weight" -> JsNumber(3))
      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(None, None, None, Some(setWeight))), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )

      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right with failure reported, got Left($err)")
      }
      response.failure shouldBe defined
      val panelOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing panel-update outcome"))
      panelOutcome.status shouldBe "rolledBack"

      // The actual assertion this regression test exists for: not just
      // `status == "rolledBack"`, but the DB row's weight is genuinely back
      // to unset -- not left at the forward edit's Some(...) value.
      await(panelRepo.findByIdInternal(panel.id)).collect { case dp: DividerPanel => dp.config.weight } shouldBe Some(None)
    }


    "reject an edit targeting a nonexistent resource pre-apply, changing nothing (7.4a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Untouched")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Should never apply"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(UUID.randomUUID().toString)), "update",
          None, Some(UpdateDashboardRequest(Some("Nonexistent"), None, None)), None, None, None, None)
      )
      val result = await(service.apply(PatchSet(None, edits), userA))
      result match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                          => fail(s"expected NotFound, got $other")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Untouched")
    }

    "accept an editor grantee's panel-update edit, matching what PATCH /api/panels/:id would accept (7.4b)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Editable")
      grantRole("dashboard", dashboard.id.value, userBId, "editor")

      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Edited by grantee"), None, None, None)), None, None, None, None, None)
      val result = await(service.apply(PatchSet(None, Vector(edit)), userB))
      result match {
        case Right(response) => response.edits.head.status shouldBe "applied"
        case Left(err)        => fail(s"expected an editor grantee's update to be accepted, got $err")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Edited by grantee")
    }

    "reject a dashboard-delete edit from an editor (non-owner) grantee -- distinct from the update case (7.4c)" in {
      val dashboard = seedDashboard(userA)
      grantRole("dashboard", dashboard.id.value, userBId, "editor")

      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "delete",
        None, None, None, None, None, None)
      val result = await(service.apply(PatchSet(None, Vector(edit)), userB))
      result match {
        case Left(ServiceError.Forbidden(_)) => succeed
        case other                            => fail(s"expected Forbidden, got $other")
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)) shouldBe defined
    }


    "reject a create edit targeting dataType pre-apply with a clear message (7.5)" in {
      val dataTypeCreate = Edit(EditTarget("dataType", None), "create", None, None, None, None, None, Some(JsObject()))
      await(service.apply(PatchSet(None, Vector(dataTypeCreate)), userA)) match {
        case Left(ServiceError.BadRequest(msg)) => msg.toLowerCase should include("datatype")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    // HEL-914 task 5.1/D3: `output` still has no create op -- the parent-id gap this change
    // closes for `pipelineStep` is not exercised for `output` (patch-set-apply spec, "A create
    // edit targeting output is rejected").
    "reject a create edit targeting output pre-apply with a clear message" in {
      val outputCreate = Edit(EditTarget("output", None), "create", None, None, None, None, None, Some(JsObject()))
      await(service.apply(PatchSet(None, Vector(outputCreate)), userA)) match {
        case Left(ServiceError.BadRequest(msg)) => msg.toLowerCase should include("output")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    // HEL-914 task 5.1/5.2 (patch-set-apply spec, "pipelineStep is no longer in this rejection
    // list"): `pipelineStep` create is now accepted, naming its parent PIPELINE via
    // `target.parentId` -- the reason it used to be rejected (no field on EditTarget carried the
    // parent id) is resolved.
    "reject a pipelineStep create with no target.parentId, naming the missing parent" in {
      val stepCreate = Edit(EditTarget("pipelineStep", None), "create", None, None, None, None, None,
        Some(JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1)))))
      await(service.apply(PatchSet(None, Vector(stepCreate)), userA)) match {
        case Left(ServiceError.BadRequest(msg)) => msg.toLowerCase should include("parentid")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a panel-update edit carrying target.parentId -- rejected, not ignored" in {
      val dashboard = seedDashboard(userA)
      val panel = seedPanel(dashboard.id, userA)
      val edit = Edit(EditTarget("panel", Some(panel.id.value), Some("some-parent")), "update",
        Some(UpdatePanelRequest(title = Some("x"), appearance = None, `type` = None, config = None)),
        None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.BadRequest(msg)) => msg.toLowerCase should include("parentid")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    // patch-set-contract spec, "A create edit naming a pipeline the caller cannot write is refused".
    "reject a pipelineStep create naming a pipeline owned by another user, creating nothing" in {
      val sourceId = seedStaticSource(userA)
      val pipeline = seedPipeline(userA, sourceId)
      val createPatch = JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1)))
      val stepCreate = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))

      await(service.apply(PatchSet(None, Vector(stepCreate)), userB)) match {
        case Left(ServiceError.Forbidden(_)) | Left(ServiceError.NotFound(_)) => succeed
        case other                                                              => fail(s"expected Forbidden/NotFound, got $other")
      }
      await(pipelineStepRepo.listByPipelineInternal(PipelineId(pipeline.id))) shouldBe empty
    }

    "accept a pipelineStep create naming an existing, writable parent pipeline, and create the step" in {
      val sourceId = seedStaticSource(userA)
      val pipeline = seedPipeline(userA, sourceId)
      val createPatch = JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1)))
      val stepCreate = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))

      val result = await(service.apply(PatchSet(None, Vector(stepCreate)), userA))
      result match {
        case Right(resp) =>
          resp.failure shouldBe None
          resp.edits.head.status shouldBe "applied"
          resp.edits.head.newId shouldBe defined
          val createdId = PipelineStepId(resp.edits.head.newId.get)
          await(pipelineStepRepo.findByIdInternal(createdId)) shouldBe defined
        case Left(err) => fail(s"expected Right, got $err")
      }
    }

    // patch-set-lane-edits spec, "A create edit naming a parent that already has a child produces
    // a sibling": a pipelineStep create's `patch.parentStepId` naming an EXISTING step that
    // already has one child must add a SECOND child (a sibling lane), never reparent the
    // existing child under the new one. This is `addStep`'s own pre-existing sibling semantics
    // (HEL-911/912) -- this test proves the patch-set wiring delegates to it unmodified, rather
    // than re-deriving lane placement itself.
    "accept a pipelineStep create naming an existing step with a child, producing a sibling (not a reparent)" in {
      val sourceId = seedStaticSource(userA)
      val pipeline = seedPipeline(userA, sourceId)
      val parent = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(10)))
      val existingChild = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(5)), parentStepId = Some(parent.id))

      // HEL-908: `attachAsTail: true` uses the branch-attach primitive (new sibling, no
      // reparenting) -- the PLAIN parentStepId anchor (attachAsTail absent/false) is a SPLICE
      // insert that reparents the anchor's existing children onto the new step instead, which
      // is a different (trunk-insertion) op, not a lane/sibling add.
      val createPatch = JsObject(
        "type"         -> JsString("limit"),
        "config"       -> JsObject("count" -> JsNumber(1)),
        "parentStepId" -> JsString(parent.id),
        "attachAsTail" -> JsBoolean(true)
      )
      val stepCreate = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))

      val result = await(service.apply(PatchSet(None, Vector(stepCreate)), userA))
      result match {
        case Right(resp) =>
          resp.failure shouldBe None
          val newSiblingId    = resp.edits.head.newId.get
          val allSteps        = await(pipelineStepRepo.listByPipelineInternal(PipelineId(pipeline.id)))
          val parentIdWrapped = PipelineStepId(parent.id)
          val childrenOfParent = allSteps.filter(_.parentStepId.contains(parentIdWrapped))
          childrenOfParent.map(_.id.value) should contain theSameElementsAs Vector(existingChild.id, newSiblingId)
          // Neither child is reparented under the other.
          allSteps.find(_.id.value == newSiblingId).get.parentStepId shouldBe Some(parentIdWrapped)
          allSteps.find(_.id.value == existingChild.id).get.parentStepId shouldBe Some(parentIdWrapped)
        case Left(err) => fail(s"expected Right, got $err")
      }
    }

    // patch-set-lane-edits spec, "Omitting attachAsTail splices rather than branching": the
    // NEGATIVE case proving the sibling behavior above is opt-in, not the default. Creating a
    // pipelineStep with `patch.parentStepId` naming a step that already has a child, but WITHOUT
    // `attachAsTail: true`, applies the pre-existing trunk-insert (splice) behavior instead --
    // the existing child is REPARENTED under the newly-created step, exactly the outcome the
    // sibling test above proves does NOT happen when the flag is set. Asserts the actual
    // splice/reparent outcome, not merely that the call succeeded -- a 200 alone would prove
    // nothing, since both the sibling and splice paths return 200.
    "accept a pipelineStep create naming an existing step with a child, WITHOUT attachAsTail, splicing and reparenting the existing child" in {
      val sourceId = seedStaticSource(userA)
      val pipeline = seedPipeline(userA, sourceId)
      val parent = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(10)))
      val existingChild = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(5)), parentStepId = Some(parent.id))

      // `attachAsTail` is deliberately OMITTED here -- this is the whole point of the test.
      val createPatch = JsObject(
        "type"         -> JsString("limit"),
        "config"       -> JsObject("count" -> JsNumber(1)),
        "parentStepId" -> JsString(parent.id)
      )
      val stepCreate = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))

      val result = await(service.apply(PatchSet(None, Vector(stepCreate)), userA))
      result match {
        case Right(resp) =>
          resp.failure shouldBe None
          val newStepId       = resp.edits.head.newId.get
          val allSteps        = await(pipelineStepRepo.listByPipelineInternal(PipelineId(pipeline.id)))
          val parentIdWrapped = PipelineStepId(parent.id)
          val newStepIdWrapped = PipelineStepId(newStepId)
          // The anchor now has exactly ONE child -- the new step -- not two.
          val childrenOfParent = allSteps.filter(_.parentStepId.contains(parentIdWrapped))
          childrenOfParent.map(_.id.value) shouldBe Vector(newStepId)
          // The previously-existing child is REPARENTED under the new step, not left under the
          // original anchor -- this is the splice/reparent outcome, not a sibling.
          allSteps.find(_.id.value == existingChild.id).get.parentStepId shouldBe Some(newStepIdWrapped)
        case Left(err) => fail(s"expected Right, got $err")
      }
    }

    // HEL-914 (peer-approved fix, found during the 6b.5/7.6 title-diff sweep): a pipelineStep
    // CREATE whose config references a foreign-owned second source is now rejected at
    // PRE-VALIDATION time (same as pipelineStep update, above), creating nothing -- not merely
    // caught later by forward-apply's own atomic rollback.
    "reject a pipelineStep create referencing a foreign-owned JoinConfig secondaryInput dataSourceId, creating nothing" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val foreignSourceId = seedStaticSource(userB, "Foreign source")
      val pipeline = seedPipeline(userA, sourceId, "Join pipeline")
      val joinConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(foreignSourceId.value)),
        "joinKey"        -> JsString("value"),
        "joinType"       -> JsString("inner")
      )
      val createPatch = JsObject("type" -> JsString("join"), "config" -> joinConfig)
      val stepCreate = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))

      await(service.apply(PatchSet(None, Vector(stepCreate)), userA)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound (data source not found), got $other")
      }
      await(pipelineStepRepo.listByPipelineInternal(PipelineId(pipeline.id))) shouldBe empty
    }

    // Peer-requested confirmation (patch-set-apply spec's create-side scenarios): an empty
    // dataSourceId is an incomplete draft, not a reference -- no lookup, no 404, on create either.
    "accept a pipelineStep create whose JoinConfig.secondaryInput dataSourceId is empty (an incomplete draft, not a reference)" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val pipeline = seedPipeline(userA, sourceId, "Join pipeline")
      val joinConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
        "joinKey"        -> JsString("value"),
        "joinType"       -> JsString("inner")
      )
      val createPatch = JsObject("type" -> JsString("join"), "config" -> joinConfig)
      val stepCreate = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))

      await(service.apply(PatchSet(None, Vector(stepCreate)), userA)) match {
        case Right(resp) => resp.failure shouldBe None
        case Left(err)   => fail(s"expected success (empty id skips the ACL check), got Left($err)")
      }
    }

    "reject a dashboard-create edit whose createPatch sets ifExists (7.6)" in {
      val createPatch = JsObject("name" -> JsString("Should not be created"), "ifExists" -> JsString("return"))
      val edit = Edit(EditTarget("dashboard", None), "create", None, None, None, None, None, Some(createPatch))
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                              => fail(s"expected BadRequest, got $other")
      }
    }


    // HEL-904 task 3.3: rewritten onto a `dataSource` delete (also
    // unconditionally "unrecoverable" per `PatchSetApplyRollback` -- design.md
    // D1: cascades to pipelines) -- `dataType` is no longer a valid
    // target.kind at all, so it can no longer stand in for this scenario.
    "report an unrecoverable delete rollback honestly, not silently hidden (7.7)" in {
      val standaloneSourceId = seedStaticSource(userA, "Standalone")
      val dashboard               = seedDashboard(userA)

      val edits = Vector(
        Edit(EditTarget("dataSource", Some(standaloneSourceId.value)), "delete", None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )
      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
      response.failure shouldBe defined
      val dsOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing dataSource edit outcome"))
      dsOutcome.status shouldBe "unrecoverable"
      dsOutcome.resultingState shouldBe None

      await(dataSourceRepo.findByIdInternal(standaloneSourceId)) shouldBe None
    }

    // ── 7.9 (design.md D2a): embedded cross-resource reference checks ─────

    "reject a patch set with a panel-create targeting an inaccessible dashboard, touching nothing (7.9a)" in {
      val dashboard        = seedDashboard(userA)
      val panelToDelete    = seedPanel(dashboard.id, userA, "Should survive")
      val foreignDashboard = seedDashboard(userB)

      val createPatch = JsObject(
        "dashboardId" -> JsString(foreignDashboard.id.value),
        "title"       -> JsString("Sneaky"),
        "type"        -> JsString("divider")
      )
      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None),
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch))
      )
      val result = await(service.apply(PatchSet(None, edits), userA))
      result shouldBe a[Left[_, _]]
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe defined
    }

    // HEL-904 task 4.1: 7.9b (companion-DataType rejection) and its negative
    // removed outright, alongside `metricId` cross-owner rejection (7.9c) --
    // no panel can carry a `dataTypeId`/`metricId` binding anymore
    // (Text/Markdown's data-bound "Source mode" and metrics are both
    // removed).

    "reject a pipelineStep-update edit referencing a foreign-owned JoinConfig secondaryInput dataSourceId (7.9d)" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val rightSourceId = seedStaticSource(userA, "Right source")
      val foreignSourceId = seedStaticSource(userB, "Foreign source")
      val pipeline              = seedPipeline(userA, sourceId, "Join pipeline")
      val joinConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(rightSourceId.value)),
        "joinKey"            -> JsString("value"),
        "joinType"           -> JsString("inner")
      )
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "join", joinConfig)

      val updatedJoinConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(foreignSourceId.value)),
        "joinKey"            -> JsString("value"),
        "joinType"           -> JsString("inner")
      )
      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(updatedJoinConfig), None)), None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound (data source not found), got $other")
      }
    }

    // HEL-950 (ticket.md AC6a, RED-first live probe recorded verbatim in
    // execution-progress.md): the patch-set surface is where the empty-id join/union bug is
    // actually reachable today -- HEL-620's union fix never reached this file. This MUST
    // succeed with the second source left unset, mirroring lookup's pre-existing behavior
    // (this file had NO existing test asserting an empty second-source id per the design
    // gate's grep, so this is new coverage, not a modified assertion).
    "accept a pipelineStep-update edit clearing JoinConfig.secondaryInput dataSourceId to empty (HEL-950)" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val rightSourceId = seedStaticSource(userA, "Right source")
      val pipeline = seedPipeline(userA, sourceId, "Join pipeline")
      val joinConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(rightSourceId.value)),
        "joinKey"           -> JsString("value"),
        "joinType"          -> JsString("inner")
      )
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "join", joinConfig)

      val emptiedJoinConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
        "joinKey"           -> JsString("value"),
        "joinType"          -> JsString("inner")
      )
      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(emptiedJoinConfig), None)), None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(_)  => succeed
        case Left(err) => fail(s"expected success (empty id skips the ACL check), got Left($err)")
      }
    }

    "reject a pipelineStep-update edit referencing a foreign-owned UnionConfig.secondaryInput dataSourceId (HEL-950, the cell HEL-620 missed)" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val otherSourceId = seedStaticSource(userA, "Other source")
      val foreignSourceId = seedStaticSource(userB, "Foreign source")
      val pipeline = seedPipeline(userA, sourceId, "Union pipeline")
      val unionConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(otherSourceId.value)),
        "mode"              -> JsString("byPosition")
      )
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "union", unionConfig)

      val updatedUnionConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(foreignSourceId.value)),
        "mode"              -> JsString("byPosition")
      )
      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(updatedUnionConfig), None)), None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound (data source not found), got $other")
      }
    }

    "accept a pipelineStep-update edit clearing UnionConfig.secondaryInput dataSourceId to empty (HEL-950, the cell HEL-620 missed)" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val otherSourceId = seedStaticSource(userA, "Other source")
      val pipeline = seedPipeline(userA, sourceId, "Union pipeline")
      val unionConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(otherSourceId.value)),
        "mode"              -> JsString("byPosition")
      )
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "union", unionConfig)

      val emptiedUnionConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
        "mode"              -> JsString("byPosition")
      )
      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(emptiedUnionConfig), None)), None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(_)  => succeed
        case Left(err) => fail(s"expected success (empty id skips the ACL check), got Left($err)")
      }
    }


    "populate a panel-update edit's priorState with the existing PanelResponse shape, field-for-field (7.10a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Original")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Changed"), None, None, None)), None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) =>
          val priorJson = response.edits.head.priorState.getOrElse(fail("expected priorState"))
          panelResponseNormalized(priorJson) shouldBe panelResponseNormalized(PanelResponse.fromDomain(panel).toJson)
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    "leave priorState absent for a panel-create edit (7.10b)" in {
      val dashboard = seedDashboard(userA)
      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("New panel"),
        "type"        -> JsString("divider")
      )
      val edit = Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch))
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) => response.edits.head.priorState shouldBe None
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    // HEL-904 task 3.3: rewritten onto a `dataSource` delete -- see 7.7's
    // identical note; `dataType` is no longer a valid target.kind.
    "still populate priorState for an unrecoverable dataSource-delete edit (7.10c)" in {
      val standaloneSourceId = seedStaticSource(userA, "StandaloneForPriorState")
      val standaloneSource        = await(dataSourceRepo.findByIdInternal(standaloneSourceId)).getOrElse(fail("source missing"))
      val dashboard               = seedDashboard(userA)
      val edits = Vector(
        Edit(EditTarget("dataSource", Some(standaloneSourceId.value)), "delete", None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )
      await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(response) =>
          val dsOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing outcome"))
          dsOutcome.status shouldBe "unrecoverable"
          val priorJson = dsOutcome.priorState.getOrElse(fail("expected priorState"))
          priorJson shouldBe dataSourceResponseFormat.write(DataSourceResponse.fromDomain(standaloneSource))
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
    }

    "populate a pipeline-update edit's priorState with the joined PipelineSummaryResponse shape (7.10d)" in {
      val sourceId = seedStaticSource(userA, "PipelineSrcForPriorState")
      val pipeline        = seedPipeline(userA, sourceId, "MyPipeline")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
        None, None, None, Some(UpdatePipelineRequest(name = "Renamed pipeline")), None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) =>
          val priorJson = response.edits.head.priorState.getOrElse(fail("expected priorState"))
          val prior     = priorJson.convertTo[PipelineSummaryResponse]
          prior.roots.map(_.dataSourceName) shouldBe Vector("PipelineSrcForPriorState")
          prior.name shouldBe "MyPipeline"
        case Left(err) => fail(s"expected success, got $err")
      }
    }


    "populate a panel-create edit's resultingState with the created panel's PanelResponse, including its new id (7.11a)" in {
      val dashboard = seedDashboard(userA)
      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("Created panel"),
        "type"        -> JsString("divider")
      )
      val edit = Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch))
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) =>
          val outcome = response.edits.head
          val newId   = outcome.newId.getOrElse(fail("expected newId"))
          val created = await(panelRepo.findByIdInternal(PanelId(newId))).getOrElse(fail("panel not found"))
          val resultingJson = outcome.resultingState.getOrElse(fail("expected resultingState"))
          panelResponseNormalized(resultingJson) shouldBe panelResponseNormalized(PanelResponse.fromDomain(created).toJson)
          resultingJson.asJsObject.fields("id") shouldBe JsString(newId)
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    "populate a panel-update edit's resultingState with the panel's PanelResponse AFTER the update (7.11b)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Before")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("After"), None, None, None)), None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) =>
          val updated = await(panelRepo.findByIdInternal(panel.id)).getOrElse(fail("panel not found"))
          response.edits.head.resultingState shouldBe Some(PanelResponse.fromDomain(updated).toJson)
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    "leave resultingState absent for a plain (non-rolled-back) panel-delete edit (7.11c)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA)
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "delete", None, None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) => response.edits.head.resultingState shouldBe None
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "populate a recreated delete-rollback's resultingState with the newly-recreated panel's PanelResponse (7.11d)" in {
      val dashboard      = seedDashboard(userA)
      val panelToDelete  = seedPanel(dashboard.id, userA, "Recreate me")
      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )
      await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(response) =>
          val outcome = response.edits.find(_.index == 0).getOrElse(fail("missing outcome"))
          outcome.status shouldBe "recreated"
          val newId     = outcome.newId.getOrElse(fail("expected newId"))
          val recreated = await(panelRepo.findByIdInternal(PanelId(newId))).getOrElse(fail("recreated panel not found"))
          val resultingJson = outcome.resultingState.getOrElse(fail("expected resultingState"))
          panelResponseNormalized(resultingJson) shouldBe panelResponseNormalized(PanelResponse.fromDomain(recreated).toJson)
          resultingJson.asJsObject.fields("id") shouldBe JsString(newId)
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
    }


    "journal a fully successful apply and return its applicationId (HEL-413 5.1a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Journaled")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Journaled - updated"), None, None, None)), None, None, None, None, None)
      val response = await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      response.failure shouldBe None
      val applicationId = response.applicationId.getOrElse(fail("expected applicationId"))

      val record = await(applicationRepo.findById(PatchSetApplicationId(applicationId), userA)).getOrElse(fail("journal row missing"))
      record.edits.map(_.index) shouldBe Vector(0)
      record.edits.head.targetKind shouldBe "panel"
      record.edits.head.op shouldBe "update"
      record.edits.head.resultingState shouldBe defined
    }

    "journal nothing and return no applicationId for a partially-rolled-back apply (HEL-413 5.1b)" in {
      val dashboard     = seedDashboard(userA, "Original")
      val panelToUpdate = seedPanel(dashboard.id, userA, "Original title")
      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToUpdate.id.value)), "update",
          Some(UpdatePanelRequest(Some("Changed"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )
      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
      response.failure shouldBe defined
      response.applicationId shouldBe None
    }

    "prune journal rows beyond the 20 most-recent per owner (HEL-413 5.1c)" in {
      val dashboard = seedDashboard(userA, "Retention dashboard")
      val applicationIds = (1 to 21).map { i =>
        val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(s"Retention $i"), None, None)), None, None, None, None)
        await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
          case Right(r)  => r.applicationId.getOrElse(fail("expected applicationId"))
          case Left(err) => fail(s"expected success, got $err")
        }
      }
      await(applicationRepo.findById(PatchSetApplicationId(applicationIds.head), userA)) shouldBe None
      await(applicationRepo.findById(PatchSetApplicationId(applicationIds.last), userA)) shouldBe defined
    }

    // HEL-904: the metricId-binding materialization regression this test
    // covered (HEL-413 5.1d) was removed outright -- metrics, and the
    // dataTypeId materialization they drove, no longer exist.

    // ── output (HEL-907 task 1.2) ─────────────────────────────────────────

    "apply an output update edit, renaming it (task 1.2)" in {
      val sourceId = seedStaticSource(userA, "Output-update source")
      val pipeline = seedPipeline(userA, sourceId, "Output-update pipeline")
      val output   = seedOutput(PipelineId(pipeline.id), userA, "Original name")

      val edit = Edit(EditTarget("output", Some(output.id.value)), "update",
        None, None, None, None, None, None, Some(UpdateOutputRequest(name = Some("Renamed output"), config = None)))

      val response = await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      response.failure shouldBe None
      response.edits.map(_.status) shouldBe Vector("applied")
      response.edits.head.resultingState.map(_.convertTo[OutputResponse].name) shouldBe Some("Renamed output")
    }

    "reject an output update edit from a non-owner (viewer grantee), leaving it unchanged (task 1.2)" in {
      val sourceId = seedStaticSource(userA, "Output-acl source")
      val pipeline = seedPipeline(userA, sourceId, "Output-acl pipeline")
      val output   = seedOutput(PipelineId(pipeline.id), userA, "Owner's output")
      grantRole("pipeline", pipeline.id, userBId, "viewer")

      val edit = Edit(EditTarget("output", Some(output.id.value)), "update",
        None, None, None, None, None, None, Some(UpdateOutputRequest(name = Some("Hijacked"), config = None)))

      val result = await(service.apply(PatchSet(None, Vector(edit)), userB))
      result shouldBe a[Left[_, _]]
      await(outputRepo.findById(output.id, userA)).map(_.name) shouldBe Some("Owner's output")
    }

    "roll back an output update edit when a later edit in the same patch set fails, restoring its original name (task 1.2)" in {
      val sourceId  = seedStaticSource(userA, "Output-rollback source")
      val pipeline  = seedPipeline(userA, sourceId, "Output-rollback pipeline")
      val output    = seedOutput(PipelineId(pipeline.id), userA, "Original name")
      val dashboard = seedDashboard(userA, "Output-rollback dashboard")

      val edits = Vector(
        Edit(EditTarget("output", Some(output.id.value)), "update",
          None, None, None, None, None, None, Some(UpdateOutputRequest(name = Some("Renamed output"), config = None))),
        // Passes pre-validation (target exists, patch present) but fails at DashboardService.
        // update's own real validation -- a genuine forward-apply-only failure, mirroring 7.3's
        // own established trick above, so the output edit above DID already apply in forward
        // order and rollback is genuinely exercised, not short-circuited at pre-validation.
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
      )

      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right (atomicity honored, not an HTTP error), got Left($err)")
      }
      response.failure shouldBe defined
      response.edits.find(_.index == 0).map(_.status) shouldBe Some("rolledBack")
      await(outputRepo.findById(output.id, userA)).map(_.name) shouldBe Some("Original name")
    }

    "mark an output delete edit unrecoverable on rollback, matching the dashboard/dataSource/pipeline delete precedent (task 1.2)" in {
      val sourceId  = seedStaticSource(userA, "Output-delete-rollback source")
      val pipeline  = seedPipeline(userA, sourceId, "Output-delete-rollback pipeline")
      val output    = seedOutput(PipelineId(pipeline.id), userA, "To delete")
      val dashboard = seedDashboard(userA, "Output-delete-rollback dashboard")

      val edits = Vector(
        Edit(EditTarget("output", Some(output.id.value)), "delete", None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
      )

      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
      response.failure shouldBe defined
      response.edits.find(_.index == 0).map(_.status) shouldBe Some("unrecoverable")
      // The Output really is gone -- "unrecoverable" is an honest report, not a silent no-op.
      await(outputRepo.findById(output.id, userA)) shouldBe None
    }

    "reject an output create edit -- no parent-pipeline-id field to target one (task 1.2)" in {
      val edit = Edit(EditTarget("output", None), "create", None, None, None, None, None,
        Some(JsObject("name" -> JsString("New Output"), "kind" -> JsString("table"))))

      val result = await(service.apply(PatchSet(None, Vector(edit)), userA))
      result shouldBe a[Left[_, _]]
    }

    // ── HEL-670 (task 1.6/5.11): full-stack proof that a create edit's target and a same-patch-set
    //    follow-up edit's target.id never fabricate/alias onto an unrelated real resource --
    //    complements RefinementEditShapeSpec's protocol-layer decode proof with the actual
    //    PatchSetApplyResolvers/PatchSetApplyForward resolution+apply behavior.

    "apply a create edit alongside a same-patch-set update edit targeting a DIFFERENT, pre-existing panel -- the update touches ONLY its own real target, never the newly-created one (HEL-670, task 1.6/5.11)" in {
      val dashboard = seedDashboard(userA, "HEL-670 dashboard")
      val existingPanel = seedPanel(dashboard.id, userA, "Pre-existing panel")

      val createEdit = Edit(EditTarget("panel", None), "create", None, None, None, None, None,
        Some(CreatePanelRequest(
          dashboardId = Some(dashboard.id.value), title = Some("Newly created panel"), `type` = Some("divider"), config = None
        ).toJson))
      val updateEdit = Edit(EditTarget("panel", Some(existingPanel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Renamed pre-existing panel"), None, None, None)), None, None, None, None, None)

      val response = await(service.apply(PatchSet(None, Vector(createEdit, updateEdit)), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      response.failure shouldBe None
      response.edits.map(_.status) shouldBe Vector("applied", "applied")

      val newPanelId = response.edits.head.newId.getOrElse(fail("expected the create edit's newId"))
      newPanelId should not be existingPanel.id.value

      // The update edit's REAL target (the pre-existing panel) was renamed -- and ONLY it.
      await(panelRepo.findByIdInternal(existingPanel.id)).map(_.title) shouldBe Some("Renamed pre-existing panel")
      // The newly-created panel kept its OWN title from the create edit's own patch -- the update
      // edit never touched it, proving the two edits resolved against two genuinely independent
      // targets rather than one aliasing onto the other.
      await(panelRepo.findByIdInternal(PanelId(newPanelId))).map(_.title) shouldBe Some("Newly created panel")
    }
  }
}
