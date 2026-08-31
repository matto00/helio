package com.helio.services.patchsets


import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.UpdatePipelineStepRequest
import com.helio.api.protocols.sources.UpdateDataSourceRequest
import com.helio.api.protocols.dashboards.{DashboardResponse, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelAppearancePayload, PanelResponse, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet, PatchSetPreviewResponse}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineStepRequest, PipelineStepResponse, PipelineSummaryResponse, UpdatePipelineRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService}
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.JsonProtocols
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Service-level coverage for `PatchSetPreviewService.preview` (HEL-408,
 *  tasks.md 6.1-6.5) — embedded-Postgres integration tests.
 *
 *  **Real RLS, not the simplified `DbContext(db, db)` pattern most ordinary
 *  service specs use.** `PanelRepository.existsBoundToType` (design.md D4's
 *  detection mechanism) is raw SQL with NO `owner_id` predicate — its entire
 *  cross-owner-narrowing correctness depends on Postgres RLS actually being
 *  evaluated under `withUserContext` (tasks.md 6.5, round-3 REFUTE finding).
 *  Mirrors `WorkspaceTeardownServiceSpec`'s dual-pool harness (a real,
 *  non-superuser `helio_app_test` app-pool role + a `helio_privileged`
 *  pool) for the WHOLE spec, not just the RLS-dependent assertions — every
 *  OTHER assertion here (before/after diff correctness, content-check
 *  rejections) is unaffected by RLS actually being enforced (the app-layer
 *  ACL these edits go through already agrees with the RLS policies), so
 *  there is no need to juggle two different `DbContext`s in one file; this
 *  also satisfies tasks.md 6.5's "isolated ... rather than mixed into a
 *  superuser-harness spec" requirement by construction — there IS no
 *  superuser-harness portion of this spec to accidentally mix into. */
class PatchSetPreviewServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll
    with JsonProtocols {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _

  private var dashboardRepo: DashboardRepository             = _
  private var panelRepo: PanelRepository                     = _
  private var dataSourceRepo: DataSourceRepository           = _
  private var permissionRepo: ResourcePermissionRepository   = _
  private var pipelineRepo: PipelineRepository               = _
  private var pipelineStepRepo: PipelineStepRepository       = _

  private var dashboardService: DashboardService     = _
  private var panelService: PanelService             = _
  private var dataSourceService: DataSourceService   = _
  private var pipelineService: PipelineService        = _
  private var service: PatchSetPreviewService         = _
  private var applyService: PatchSetApplyService      = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)(routeEc)

    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo         = new PanelRepository(ctx)(routeEc)
    dataSourceRepo    = new DataSourceRepository(ctx)(routeEc)
    permissionRepo    = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo  = new PipelineStepRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("patch-set-preview-service-spec"))

    dashboardService   = new DashboardService(dashboardRepo, accessChecker)
    panelService        = new PanelService(panelRepo, accessChecker, dashboardRepo)
    dataSourceService   = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService      = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)

    service = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker
    )
    val applicationRepo = new PatchSetApplicationRepository(ctx)(routeEc)
    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)


  private def seedUsers(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  private def grantRole(resourceType: String, resourceId: String, granteeId: String, role: String): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ($resourceType, $resourceId, ${granteeId}::uuid, $role, now())"""
    ))
  }

  private def seedDashboard(owner: AuthenticatedUser, name: String = "Dashboard"): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some(name)), owner))._1

  private def seedPanel(dashboardId: DashboardId, owner: AuthenticatedUser, title: String = "Panel"): Panel =
    await(panelService.create(CreatePanelRequest(Some(dashboardId.value), Some(title), Some("divider"), None), owner)) match {
      case Right(p) => p
      case Left(e)  => fail(s"seedPanel failed: $e")
    }

  // HEL-904 task 4.1: `seedMetricPanelBoundTo`/`seedChartPanel` removed --
  // Text/Markdown's data-bound "Source mode" no longer exists, so no panel
  // kind can be seeded with a real `dataTypeId` binding anymore.

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
    await(pipelineService.create(CreatePipelineRequest(name, sourceId.value), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipeline failed: $e")
    }

  private def seedPipelineStep(pipelineId: PipelineId, owner: AuthenticatedUser, kind: String, config: JsObject): PipelineStepResponse =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest(kind, config), owner)) match {
      case Right(s) => s
      case Left(e)  => fail(s"seedPipelineStep failed: $e")
    }

  // See `PatchSetApplyServiceSpec`'s identical helper/comment — Postgres
  // TIMESTAMPTZ microsecond rounding makes a freshly-minted domain object's
  // timestamps unreliable to compare bit-exact against a DB round-trip.
  // These assertions care about CONTENT fidelity, not clock precision.
  private def panelResponseNormalized(json: JsValue): PanelResponse = {
    val r = json.convertTo[PanelResponse]
    r.copy(meta = r.meta.copy(createdAt = "", lastUpdated = ""))
  }

  private def dashboardResponseNormalized(json: JsValue): DashboardResponse = {
    val r = json.convertTo[DashboardResponse]
    r.copy(meta = r.meta.copy(createdAt = "", lastUpdated = ""))
  }

  private def preview(edits: Vector[Edit], user: AuthenticatedUser): Either[ServiceError, PatchSetPreviewResponse] =
    await(service.preview(PatchSet(None, edits), user))

  // ── 6.1: mixed patch set computes correct before/after, writes nothing ──

  "PatchSetPreviewService.preview" should {

    "compute correct before/after for a mixed patch set (panel update + panel delete + dashboard update) and write nothing (6.1)" in {
      val dashboard      = seedDashboard(userA, "Original dashboard")
      val panelToUpdate  = seedPanel(dashboard.id, userA, "Original title")
      val panelToDelete  = seedPanel(dashboard.id, userA, "Delete me")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panelToUpdate.id.value)), "update",
          Some(UpdatePanelRequest(Some("Updated title"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete",
          None, None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Renamed dashboard"), None, None)), None, None, None, None)
      )

      preview(edits, userA) match {
        case Right(response) =>
          response.edits should have size 3

          val panelUpdatePreview = response.edits(0)
          panelUpdatePreview.kind shouldBe "panel"
          panelUpdatePreview.op shouldBe "update"
          panelResponseNormalized(panelUpdatePreview.before.getOrElse(fail("expected before"))) shouldBe
            panelResponseNormalized(PanelResponse.fromDomain(panelToUpdate).toJson)
          panelUpdatePreview.after.getOrElse(fail("expected after")).convertTo[PanelResponse].title shouldBe "Updated title"

          val panelDeletePreview = response.edits(1)
          panelDeletePreview.op shouldBe "delete"
          panelDeletePreview.before shouldBe defined
          panelDeletePreview.after shouldBe None

          val dashboardUpdatePreview = response.edits(2)
          dashboardUpdatePreview.kind shouldBe "dashboard"
          dashboardUpdatePreview.after.getOrElse(fail("expected after")).convertTo[DashboardResponse].name shouldBe "Renamed dashboard"
        case Left(err) => fail(s"expected success, got $err")
      }

      // Nothing was ever written.
      await(panelRepo.findByIdInternal(panelToUpdate.id)).map(_.title) shouldBe Some("Original title")
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe defined
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Original dashboard")
    }

    "leave an update edit's after.meta.lastUpdated at prior's value, not a guessed write-time (design.md D3 timestamp exclusion)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Timestamp check")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Changed"), None, None, None)), None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) =>
          val before = response.edits.head.before.getOrElse(fail("expected before")).convertTo[PanelResponse]
          val after  = response.edits.head.after.getOrElse(fail("expected after")).convertTo[PanelResponse]
          after.title shouldBe "Changed"
          after.meta.lastUpdated shouldBe before.meta.lastUpdated
        case Left(err) => fail(s"expected success, got $err")
      }
    }


    "give a create edit's after the '(pending)' id sentinel, and a delete edit's after is None (6.2)" in {
      val dashboard = seedDashboard(userA)
      val panelToDelete = seedPanel(dashboard.id, userA)
      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("New panel"),
        "type"        -> JsString("divider")
      )
      val edits = Vector(
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch)),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None)
      )

      preview(edits, userA) match {
        case Right(response) =>
          response.edits(0).before shouldBe None
          response.edits(0).after.getOrElse(fail("expected after")).asJsObject.fields("id") shouldBe JsString("(pending)")
          response.edits(1).after shouldBe None
        case Left(err) => fail(s"expected success, got $err")
      }

      // Nothing created or deleted -- only the one pre-existing panel remains.
      await(panelRepo.findAllByDashboardId(dashboard.id, Some(userA), Page(0, 10))).total shouldBe 1
    }


    "reject an edit targeting a nonexistent resource, changing nothing, identically to apply (6.3a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Untouched")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Should never preview"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(UUID.randomUUID().toString)), "update",
          None, Some(UpdateDashboardRequest(Some("Nonexistent"), None, None)), None, None, None, None)
      )

      val previewResult = preview(edits, userA)
      val applyResult    = await(applyService.apply(PatchSet(None, edits), userA))

      previewResult match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound, got $other")
      }
      applyResult match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected apply's NotFound too, got $other")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Untouched")
    }

    "reject a dashboard-delete edit from an editor (non-owner) grantee, identically to apply (6.3b)" in {
      val dashboard = seedDashboard(userA)
      grantRole("dashboard", dashboard.id.value, userBId, "editor")

      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "delete",
        None, None, None, None, None, None)

      preview(Vector(edit), userB) match {
        case Left(ServiceError.Forbidden(_)) => succeed
        case other                             => fail(s"expected Forbidden, got $other")
      }
      await(dashboardRepo.findByIdInternal(dashboard.id)) shouldBe defined
    }


    "reject a panel-update edit with a blank title, matching PATCH /api/panels/:id (6.4a)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA)
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("  "), None, None, None)), None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("title must not be blank")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }

    // HEL-904: scatter/aggregation conflict check (6.4b) removed -- ChartPanel no longer exists.

    "reject a pipeline-rename edit with a blank name, matching PipelineService.updateName (6.4c)" in {
      val sourceId = seedStaticSource(userA, "Pipeline source")
      val pipeline        = seedPipeline(userA, sourceId, "My pipeline")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
        None, None, None, Some(UpdatePipelineRequest(name = "  ")), None, None)

      preview(Vector(edit), userA) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("name must not be empty")
        case other                                => fail(s"expected BadRequest, got $other")
      }
    }






    "hint that pipeline output rows will be stale on a pipeline-update edit (6.5a)" in {
      val sourceId = seedStaticSource(userA, "PipelineUpdateSrc")
      val pipeline        = seedPipeline(userA, sourceId, "Original name")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
        None, None, None, Some(UpdatePipelineRequest(name = "Renamed")), None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "hint stale rows + cascade on a pipeline-delete edit (6.5b)" in {
      val sourceId = seedStaticSource(userA, "PipelineDeleteSrc")
      val pipeline        = seedPipeline(userA, sourceId, "To delete")
      val edit = Edit(EditTarget("pipeline", Some(pipeline.id)), "delete", None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) =>
          response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
          response.edits.head.impact should contain("Cascades to this pipeline's steps and run history.")
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    "hint that pipeline output rows will be stale on a pipelineStep update/delete edit (6.5c)" in {
      val sourceId = seedStaticSource(userA, "StepSrc")
      val pipeline        = seedPipeline(userA, sourceId, "Step pipeline")
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(5)))

      val updateEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(10))), None)), None)
      preview(Vector(updateEdit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
        case Left(err)         => fail(s"expected success, got $err")
      }

      val deleteEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "delete", None, None, None, None, None, None)
      preview(Vector(deleteEdit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Pipeline output rows will be stale until re-run.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    // ══ HEL-814 task 6.2 / 7.2 — the GUARD and its replacement PROOF, sited
    //    together so the pair is legible in one place. ═══════════════════════
    //
    // GUARD (6.2). This test keeps its `Right` expectation, and that is NOT a
    // reverted hardening. Its fixture OMITS `joinKey` entirely (its own
    // comment below says so) — it is an ABSENCE case, not a wrong-type one.
    //
    // HEL-814 deliberately preserves preview acceptance of an absence-only
    // draft:
    //   * D1 keeps the READ path tolerant of an absent key, because every read
    //     of a stored step decodes its config and a decode failure there is a
    //     500 — making absence raise would 500 the pipeline editor for any
    //     step a user has added but not finished configuring (20 such rows
    //     measured live across dev and prod).
    //   * D2 rejects wrong-TYPE values only on the write path, and the
    //     `pipeline-step-config-rejection` spec states in terms that absence
    //     SHALL NOT be rejected. This edit is indistinguishable from a draft.
    //   * Completeness is enforced instead at RUN and ANALYZE time (D3) — see
    //     `PipelineStepRequiredConfigSpec`, which proves a `join` step with an
    //     empty `joinKey` now fails the run naming the step and the field.
    //
    // What actually closes the gap this test was written to expose is the
    // wrong-TYPE proof immediately below. Inverting THIS test instead would
    // contradict the approved D2 and the rejection spec, and faking the flip
    // would be worse than not having it.
    //
    // Failable by mutation, not by reverting the fix: make `StepCodecUtil.str`
    // raise on an absent key, or make `validateRawConfig` reject absence, and
    // this goes red while the proof below stays green.
    //
    // ── Original HEL-671 note, kept verbatim for provenance ────────────────
    // HEL-671 skeptic-final-1.md CR-2: proves the ticket's CENTRAL claim as a tested fact, not a
    // code-read inference — a wrong-shape `join` edit (missing `joinKey`, decodes silently to
    // `joinKey = ""` per `JoinConfig.decode`/`RefinementEditShapeSpec`'s negative-control test)
    // passes `preview` (i.e. `PatchSetApplyResolvers.validateEmbeddedStepReferences`'s
    // `case Success(jc: JoinConfig) => ... findByIdOwned check ...`) because that check only
    // validates `rightDataSourceId` referentially — it never inspects `joinKey`/`joinType` at all.
    // CHARACTERIZATION-TEST WARNING (added post skeptic-final-2.md CONFIRM): this test
    // deliberately asserts that preview ACCEPTS (`Right`) a wrong-shape edit today. HEL-814
    // predicted THIS TEST SHOULD FAIL when the hardening landed. It did not, for the reason
    // recorded above — the prediction assumed absence would be made to raise, and the caller
    // analysis HEL-814 ran (which the ticket itself demanded) showed that is not safe to do.
    "GUARD: preview still ACCEPTS a join edit that OMITS joinKey — absence is a draft, and HEL-814 deliberately keeps it savable (completeness is enforced at run/analyze instead)" in {
      val leftSourceId = seedStaticSource(userA, "JoinLeftSrc")
      val rightSourceId = seedStaticSource(userA, "JoinRightSrc")
      val pipeline = seedPipeline(userA, leftSourceId, "Join pipeline")
      val step = seedPipelineStep(
        PipelineId(pipeline.id), userA, "join",
        JsObject("rightDataSourceId" -> JsString(rightSourceId.value), "joinKey" -> JsString("id"), "joinType" -> JsString("inner"))
      )

      // Hand-constructed config: joinKey is OMITTED entirely (never "" explicitly) — this is the
      // ABSENCE case, which stays tolerant on both the read and the write path by design.
      val wrongShapeConfig = JsObject("rightDataSourceId" -> JsString(rightSourceId.value), "joinType" -> JsString("inner"))
      val updateEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(wrongShapeConfig), None)), None)

      preview(Vector(updateEdit), userA) match {
        case Right(_)  => succeed
        case Left(err) => fail(s"expected preview to ACCEPT an absence-only draft edit, but it rejected it: $err")
      }
    }

    // PROOF (7.2), shown red before the fix. THIS is the test that closes the
    // gap the guard above was written to expose.
    //
    // The assertion is deliberately on a SPECIFIC ServiceError and a message
    // naming `joinKey`, never merely on `Left`. The same config is ALSO caught
    // by D1's decode raise, which this function reports as a `BadRequest`
    // (400) — so an assertion that accepted any `Left` would still pass with
    // the `validateRawConfig` wiring omitted entirely, making it vacuous as
    // proof of this ticket's actual defect. Asserting the 422 from D2's
    // `validateRawConfig` is what binds this test to the wiring.
    "PROOF: preview REJECTS a join edit whose joinKey is PRESENT but of the wrong JSON type, with a 422 naming the key" in {
      val leftSourceId = seedStaticSource(userA, "JoinLeftTypeSrc")
      val rightSourceId = seedStaticSource(userA, "JoinRightTypeSrc")
      val pipeline = seedPipeline(userA, leftSourceId, "Join type pipeline")
      val step = seedPipelineStep(
        PipelineId(pipeline.id), userA, "join",
        JsObject("rightDataSourceId" -> JsString(rightSourceId.value), "joinKey" -> JsString("id"), "joinType" -> JsString("inner"))
      )

      val mistypedConfig = JsObject(
        "rightDataSourceId" -> JsString(rightSourceId.value),
        "joinKey"           -> JsNumber(123),
        "joinType"          -> JsString("inner")
      )
      val updateEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(mistypedConfig), None)), None)

      preview(Vector(updateEdit), userA) match {
        case Right(_) =>
          fail("expected preview to REJECT a join edit whose joinKey is present but of the wrong JSON type")
        case Left(err: ServiceError.UnprocessableEntity) =>
          err.message should include("joinKey")
          err.message should include("must be a string")
          err.message should include("got a number")
        case Left(other) =>
          fail(s"expected a 422 UnprocessableEntity from validateRawConfig, got $other — a BadRequest here would mean the D1 decode raise caught it and the D2 write-path wiring is absent")
      }
    }

    // PROOF (7.1): the same rejection reaches preview for a step kind other
    // than `join`, so this is the shared `validateRawConfig` wiring rather
    // than a join-specific special case. `pivot`'s `index` is the shipped
    // rejection spec's own named example.
    "PROOF: preview REJECTS a pivot edit whose index holds a string rather than an array, with a 422 naming the key" in {
      val sourceId = seedStaticSource(userA, "PivotTypeSrc")
      val pipeline = seedPipeline(userA, sourceId, "Pivot type pipeline")
      val step = seedPipelineStep(
        PipelineId(pipeline.id), userA, "pivot",
        JsObject(
          "index"  -> JsArray(JsString("region")),
          "column" -> JsString("quarter"),
          "values" -> JsString("revenue"),
          "agg"    -> JsString("sum")
        )
      )

      val mistypedConfig = JsObject(
        "index"  -> JsString("region"),
        "column" -> JsString("quarter"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("sum")
      )
      val updateEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(mistypedConfig), None)), None)

      preview(Vector(updateEdit), userA) match {
        case Left(err: ServiceError.UnprocessableEntity) =>
          err.message should include("index")
          err.message should include("an array of strings")
        case other => fail(s"expected a 422 naming 'index', got $other")
      }
    }

    // PROOF (7.1): and for `window`, whose `orderBy` exercises the ELEMENT
    // half of the strictness — the old `flatMap(...).toOption` dropped a bad
    // element and kept its siblings, producing a partially-decoded collection
    // that preview happily accepted.
    "PROOF: preview REJECTS a window edit whose orderBy holds a bare string element, rather than silently dropping that element" in {
      val sourceId = seedStaticSource(userA, "WindowTypeSrc")
      val pipeline = seedPipeline(userA, sourceId, "Window type pipeline")
      val step = seedPipelineStep(
        PipelineId(pipeline.id), userA, "window",
        JsObject(
          "partitionBy"  -> JsArray(JsString("region")),
          "orderBy"      -> JsArray(JsObject("field" -> JsString("amount"), "direction" -> JsString("desc"))),
          "function"     -> JsString("row_number"),
          "outputColumn" -> JsString("rn")
        )
      )

      val mistypedConfig = JsObject(
        "partitionBy"  -> JsArray(JsString("region")),
        "orderBy"      -> JsArray(JsString("amount")),
        "function"     -> JsString("row_number"),
        "outputColumn" -> JsString("rn")
      )
      val updateEdit = Edit(EditTarget("pipelineStep", Some(step.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(mistypedConfig), None)), None)

      preview(Vector(updateEdit), userA) match {
        case Left(err: ServiceError.UnprocessableEntity) =>
          err.message should include("orderBy")
          err.message should include("{field, direction}")
        case other => fail(s"expected a 422 naming 'orderBy', got $other")
      }
    }

    // GUARD (7.5 / 3.5): the drafts D2 deliberately keeps savable really do
    // still pass preview. These are the shapes the live measurement found in
    // dev and prod — a step added and not yet configured. Failable by
    // mutation: make `validateRawConfig` reject an empty string and this goes
    // red while every proof above stays green.
    "GUARD: preview still ACCEPTS the real draft shapes measured in dev and prod (empty compute column/expression, empty lookup reference id)" in {
      val sourceId = seedStaticSource(userA, "DraftSrc")
      val pipeline = seedPipeline(userA, sourceId, "Draft pipeline")

      val computeStep = seedPipelineStep(
        PipelineId(pipeline.id), userA, "compute",
        JsObject("column" -> JsString("x"), "expression" -> JsString("$a + $b"), "type" -> JsString("number"))
      )
      // The untouched freshly-added compute step found in production: BOTH
      // `column` and `expression` empty.
      val emptyDraft = JsObject("column" -> JsString(""), "expression" -> JsString(""), "type" -> JsString("number"))
      val computeEdit = Edit(EditTarget("pipelineStep", Some(computeStep.id)), "update",
        None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(emptyDraft), None)), None)

      preview(Vector(computeEdit), userA) match {
        case Right(_)  => succeed
        case Left(err) => fail(s"expected preview to ACCEPT an unconfigured compute draft, but it rejected it: $err")
      }

      // And the picker's own empty-default seed for `lookup`, which
      // `pipeline-lookup-op` explicitly blesses on the write path.
      val lookupStep = seedPipelineStep(
        PipelineId(pipeline.id), userA, "lookup",
        JsObject("referenceDataSourceId" -> JsString(""), "sourceKey" -> JsString(""), "lookupKey" -> JsString(""), "columns" -> JsArray())
      )
      val lookupEdit = Edit(EditTarget("pipelineStep", Some(lookupStep.id)), "update",
        None, None, None, None,
        Some(UpdatePipelineStepRequest(None, Some(JsObject("referenceDataSourceId" -> JsString(""), "sourceKey" -> JsString(""), "lookupKey" -> JsString(""), "columns" -> JsArray())), None)), None)

      preview(Vector(lookupEdit), userA) match {
        case Right(_)  => succeed
        case Left(err) => fail(s"expected preview to ACCEPT the lookup picker's empty-default seed, but it rejected it: $err")
      }
    }

    "hint that a dataSource delete cascades to dependent pipelines (6.5d)" in {
      val sourceId = seedStaticSource(userA, "CascadeSrc")
      val edit = Edit(EditTarget("dataSource", Some(sourceId.value)), "delete", None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Cascades to any pipeline built on this source.")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    "hint the exact panel count on a dashboard-delete edit (6.5e)" in {
      val dashboard = seedDashboard(userA, "Three panels")
      seedPanel(dashboard.id, userA, "P1")
      seedPanel(dashboard.id, userA, "P2")
      seedPanel(dashboard.id, userA, "P3")
      val edit = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "delete", None, None, None, None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact should contain("Cascades to 3 panel(s).")
        case Left(err)         => fail(s"expected success, got $err")
      }
    }

    // HEL-904 task 4.1: 6.5f ("hint a rebind when a panel-update edit changes
    // config.dataTypeId") removed outright -- no panel carries a `dataTypeId`
    // binding anymore, so this scenario can no longer occur.

    "surface no impact hint for an ordinary rename (6.5g)" in {
      val sourceId = seedStaticSource(userA, "PlainRenameSrc")
      val edit = Edit(EditTarget("dataSource", Some(sourceId.value)), "update",
        None, None, Some(UpdateDataSourceRequest(Some("Renamed source"))), None, None, None)

      preview(Vector(edit), userA) match {
        case Right(response) => response.edits.head.impact shouldBe empty
        case Left(err)         => fail(s"expected success, got $err")
      }
    }


  }


  // HEL-904 task 4.1: the `PanelRepository.existsBoundToType (2.3a)` block
  // (6.5k/6.5l/6.5m) removed outright, alongside `existsBoundToType` itself
  // -- no panel can carry a `dataTypeId` binding anymore, so the method had
  // zero remaining callers.
}
