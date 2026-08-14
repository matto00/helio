package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.{ResourceType => AclResourceType}
import com.helio.api.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure._
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
  private var dataTypeRepo: DataTypeRepository           = _
  private var dataTypeRowRepo: DataTypeRowRepository     = _
  private var metricRepo: MetricRepository               = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository           = _
  private var pipelineStepRepo: PipelineStepRepository   = _

  private var dashboardService: DashboardService   = _
  private var panelService: PanelService           = _
  private var dataSourceService: DataSourceService = _
  private var dataTypeService: DataTypeService     = _
  private var pipelineService: PipelineService     = _
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
    dataTypeRepo      = new DataTypeRepository(ctx)
    dataTypeRowRepo   = new DataTypeRowRepository(ctx)
    metricRepo        = new MetricRepository(ctx)
    permissionRepo    = new ResourcePermissionRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    pipelineStepRepo  = new PipelineStepRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-type",   id => dataTypeRepo.findByIdInternal(DataTypeId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-apply-service-spec"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker)
    panelService        = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
    dataTypeService     = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    service = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, dataTypeService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo,
      metricRepo, accessChecker
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── DB / seed helpers ────────────────────────────────────────────────────

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
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("metric"), None), owner)) match {
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
    await(pipelineService.create(CreatePipelineRequest(name, sourceId.value, "Output"), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipeline failed: $e")
    }

  private def seedPipelineStep(pipelineId: PipelineId, owner: AuthenticatedUser, kind: String, config: JsObject): PipelineStepResponse =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest(kind, config), owner)) match {
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

  private def dataTypeResponseNormalized(json: JsValue): DataTypeResponse = {
    val r = json.convertTo[DataTypeResponse]
    r.copy(createdAt = "", updatedAt = "")
  }

  // ── 7.2: mixed patch set applies cleanly ────────────────────────────────

  "PatchSetApplyService.apply" should {

    "apply a mixed patch set (panel update + panel delete + dashboard update) cleanly, each reported applied (7.2)" in {
      val dashboard      = seedDashboard(userA)
      val panelToUpdate  = seedPanel(dashboard.id, userA, "To update")
      val panelToDelete  = seedPanel(dashboard.id, userA, "To delete")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToUpdate.id.value)), "update",
          Some(UpdatePanelRequest(Some("Updated title"), None, None, None)), None, None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete",
          None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Renamed dashboard"), None, None)), None, None, None, None, None)
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

    // ── 7.3: mid-set failure rolls back every edit ────────────────────────

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
          Some(UpdatePanelRequest(Some("Changed title"), None, None, None)), None, None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete",
          None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
      )

      val result = await(service.apply(PatchSet(None, edits), userA))
      val response = result match {
        case Right(r) => r
        case Left(err) => fail(s"expected Right with failure reported, got Left($err)")
      }
      response.failure shouldBe defined
      response.edits.map(_.status).toSet shouldBe Set("rolledBack", "recreated")

      // panel update reverted
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

    // skeptic-final-1.md CR1 regression: a rolled-back panel-update must
    // actually CLEAR an Option config field the forward edit had SET, not
    // just leave it at whatever the forward edit wrote. `encodeConfig`
    // omits a None-valued Option field entirely (plain jsonFormatN), and
    // Patch.decode treats an absent key as "leave the current value
    // unchanged" -- so a naive inverse built from the bare encoded config
    // would silently fail to restore an unset->set transition, even though
    // `status` still reports "rolledBack".
    "genuinely clear a config Option field that transitioned None->Some, when the update rolling it back is itself rolled back (skeptic-final-1.md CR1)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Aggregation panel")
      // Seeded via config = None -> decodeCreateConfig defaults to Empty ->
      // aggregation is unset before any edit in this patch set runs.
      await(panelRepo.findByIdInternal(panel.id)).collect { case mp: MetricPanel => mp.config.aggregation } shouldBe Some(None)

      val setAggregation = JsObject("aggregation" -> JsObject("op" -> JsString("sum")))
      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(None, None, None, Some(setAggregation))), None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
      )

      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right with failure reported, got Left($err)")
      }
      response.failure shouldBe defined
      val panelOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing panel-update outcome"))
      panelOutcome.status shouldBe "rolledBack"

      // The actual assertion this regression test exists for: not just
      // `status == "rolledBack"`, but the DB row's aggregation is genuinely
      // back to unset -- not left at the forward edit's Some(...) value.
      await(panelRepo.findByIdInternal(panel.id)).collect { case mp: MetricPanel => mp.config.aggregation } shouldBe Some(None)
    }

    // ── 7.4: pre-apply rejection, editor-vs-owner-only split ──────────────

    "reject an edit targeting a nonexistent resource pre-apply, changing nothing (7.4a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Untouched")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Should never apply"), None, None, None)), None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(UUID.randomUUID().toString)), "update",
          None, Some(UpdateDashboardRequest(Some("Nonexistent"), None, None)), None, None, None, None, None)
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
        Some(UpdatePanelRequest(Some("Edited by grantee"), None, None, None)), None, None, None, None, None, None)
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
        None, None, None, None, None, None, None)
      val result = await(service.apply(PatchSet(None, Vector(edit)), userB))
      result match {
        case Left(ServiceError.Forbidden(_)) => succeed
        case other                            => fail(s"expected Forbidden, got $other")
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)) shouldBe defined
    }

    // ── 7.5: create rejected pre-apply where no viable path exists ────────

    "reject a create edit targeting dataType or pipelineStep pre-apply with a clear message (7.5)" in {
      val dataTypeCreate = Edit(EditTarget("dataType", None), "create", None, None, None, None, None, None, Some(JsObject()))
      await(service.apply(PatchSet(None, Vector(dataTypeCreate)), userA)) match {
        case Left(ServiceError.BadRequest(msg)) => msg.toLowerCase should include("datatype")
        case other                                => fail(s"expected BadRequest, got $other")
      }

      val stepCreate = Edit(EditTarget("pipelineStep", None), "create", None, None, None, None, None, None, Some(JsObject()))
      await(service.apply(PatchSet(None, Vector(stepCreate)), userA)) match {
        case Left(ServiceError.BadRequest(msg)) => msg.toLowerCase should include("pipelinestep")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    // ── 7.6: dashboard create rejects ifExists ─────────────────────────────

    "reject a dashboard-create edit whose createPatch sets ifExists (7.6)" in {
      val createPatch = JsObject("name" -> JsString("Should not be created"), "ifExists" -> JsString("return"))
      val edit = Edit(EditTarget("dashboard", None), "create", None, None, None, None, None, None, Some(createPatch))
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                              => fail(s"expected BadRequest, got $other")
      }
    }

    // ── 7.7: unrecoverable delete rollback is reported honestly ───────────

    "report an unrecoverable delete rollback honestly, not silently hidden (7.7)" in {
      val standaloneType = seedPipelineOutputType(userA, "Standalone")
      val dashboard       = seedDashboard(userA)

      val edits = Vector(
        Edit(EditTarget("dataType", Some(standaloneType.id.value)), "delete", None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
      )
      val response = await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
      response.failure shouldBe defined
      val dtOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing dataType edit outcome"))
      dtOutcome.status shouldBe "unrecoverable"
      dtOutcome.resultingState shouldBe None

      await(dataTypeRepo.findByIdInternal(standaloneType.id)) shouldBe None
    }

    // ── 7.9 (design.md D2a): embedded cross-resource reference checks ─────

    "reject a patch set with a panel-create targeting an inaccessible dashboard, touching nothing (7.9a)" in {
      val dashboard        = seedDashboard(userA)
      val panelToDelete    = seedPanel(dashboard.id, userA, "Should survive")
      val foreignDashboard = seedDashboard(userB)

      val createPatch = JsObject(
        "dashboardId" -> JsString(foreignDashboard.id.value),
        "title"       -> JsString("Sneaky"),
        "type"        -> JsString("metric")
      )
      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None, None),
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, None, Some(createPatch))
      )
      val result = await(service.apply(PatchSet(None, edits), userA))
      result shouldBe a[Left[_, _]]
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe defined
    }

    "reject a panel-update edit binding to an owned companion DataType (7.9b)" in {
      val dashboard              = seedDashboard(userA)
      val panel                   = seedPanel(dashboard.id, userA)
      val (_, companionTypeId)    = seedStaticSource(userA, "Companion source")

      val configPatch = JsObject("dataTypeId" -> JsString(companionTypeId.value))
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(None, None, None, Some(configPatch))), None, None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                              => fail(s"expected BadRequest, got $other")
      }
    }

    "accept (not reject) a panel-update edit whose dataTypeId is foreign-owned (7.9b negative)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA)
      // Foreign-OWNED but genuinely existing (satisfies the panels_type_id_fkey
      // constraint) -- distinct from a truly nonexistent id, which the FK
      // itself would reject regardless of this check's own pass-through rule.
      val foreignType = seedPipelineOutputType(userB, "ForeignOutputForNegativeCase")

      val configPatch = JsObject("dataTypeId" -> JsString(foreignType.id.value))
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(None, None, None, Some(configPatch))), None, None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) => response.edits.head.status shouldBe "applied"
        case Left(err)         => fail(s"expected the foreign dataTypeId to pass through unchanged, got $err")
      }
    }

    "reject a panel-update edit referencing a foreign-owned metricId (7.9c)" in {
      val dashboard          = seedDashboard(userA)
      val panel                = seedPanel(dashboard.id, userA)
      val foreignOutputType    = seedPipelineOutputType(userB, "ForeignOutput")
      val foreignMetricId      = seedMetric(userB, foreignOutputType.id)

      val configPatch = JsObject("metricId" -> JsString(foreignMetricId.value))
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(None, None, None, Some(configPatch))), None, None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                              => fail(s"expected BadRequest, got $other")
      }
    }

    "reject a pipelineStep-update edit referencing a foreign-owned JoinConfig rightDataSourceId (7.9d)" in {
      val (sourceId, _)       = seedStaticSource(userA, "Pipeline source")
      val (rightSourceId, _)   = seedStaticSource(userA, "Right source")
      val (foreignSourceId, _) = seedStaticSource(userB, "Foreign source")
      val pipeline              = seedPipeline(userA, sourceId, "Join pipeline")
      val joinConfig = JsObject(
        "rightDataSourceId" -> JsString(rightSourceId.value),
        "joinKey"            -> JsString("value"),
        "joinType"           -> JsString("inner")
      )
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "join", joinConfig)

      val updatedJoinConfig = JsObject(
        "rightDataSourceId" -> JsString(foreignSourceId.value),
        "joinKey"            -> JsString("value"),
        "joinType"           -> JsString("inner")
      )
      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(updatedJoinConfig), None)), None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound (data source not found), got $other")
      }
    }

    // ── 7.10 (design.md D4a): priorState capture ───────────────────────────

    "populate a panel-update edit's priorState with the existing PanelResponse shape, field-for-field (7.10a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Original")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Changed"), None, None, None)), None, None, None, None, None, None)
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
        "type"        -> JsString("metric")
      )
      val edit = Edit(EditTarget("panel", None), "create", None, None, None, None, None, None, Some(createPatch))
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) => response.edits.head.priorState shouldBe None
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "still populate priorState for an unrecoverable dataType-delete edit (7.10c)" in {
      val standaloneType = seedPipelineOutputType(userA, "StandaloneForPriorState")
      val dashboard       = seedDashboard(userA)
      val edits = Vector(
        Edit(EditTarget("dataType", Some(standaloneType.id.value)), "delete", None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
      )
      await(service.apply(PatchSet(None, edits), userA)) match {
        case Right(response) =>
          val dtOutcome = response.edits.find(_.index == 0).getOrElse(fail("missing outcome"))
          dtOutcome.status shouldBe "unrecoverable"
          val priorJson = dtOutcome.priorState.getOrElse(fail("expected priorState"))
          dataTypeResponseNormalized(priorJson) shouldBe dataTypeResponseNormalized(DataTypeResponse.fromDomain(standaloneType).toJson)
        case Left(err) => fail(s"expected Right, got Left($err)")
      }
    }

    "populate a pipeline-update edit's priorState with the joined PipelineSummaryResponse shape (7.10d)" in {
      val (sourceId, _) = seedStaticSource(userA, "PipelineSrcForPriorState")
      val pipeline        = seedPipeline(userA, sourceId, "MyPipeline")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
        None, None, None, None, Some(UpdatePipelineRequest(name = "Renamed pipeline")), None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) =>
          val priorJson = response.edits.head.priorState.getOrElse(fail("expected priorState"))
          val prior     = priorJson.convertTo[PipelineSummaryResponse]
          prior.sourceDataSourceName shouldBe "PipelineSrcForPriorState"
          prior.outputDataTypeName shouldBe "Output"
          prior.name shouldBe "MyPipeline"
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    // ── 7.11 (design.md D4b): resultingState capture ───────────────────────

    "populate a panel-create edit's resultingState with the created panel's PanelResponse, including its new id (7.11a)" in {
      val dashboard = seedDashboard(userA)
      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("Created panel"),
        "type"        -> JsString("metric")
      )
      val edit = Edit(EditTarget("panel", None), "create", None, None, None, None, None, None, Some(createPatch))
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
        Some(UpdatePanelRequest(Some("After"), None, None, None)), None, None, None, None, None, None)
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
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "delete", None, None, None, None, None, None, None)
      await(service.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(response) => response.edits.head.resultingState shouldBe None
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "populate a recreated delete-rollback's resultingState with the newly-recreated panel's PanelResponse (7.11d)" in {
      val dashboard      = seedDashboard(userA)
      val panelToDelete  = seedPanel(dashboard.id, userA, "Recreate me")
      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None, None)
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
  }
}
