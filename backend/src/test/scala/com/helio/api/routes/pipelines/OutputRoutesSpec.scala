package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.ErrorResponse
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.pipelines.{AssertionStatusResponse, CreateOutputRequest, DeleteOutputResponse, OutputPanelPlacementResponse, OutputResponse, OutputsResponse, PipelinePreviewResponse, UpdateOutputRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineRunService}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.api.protocols.panels.CreatePanelRequest
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-906 (P1.3) — HTTP-layer ACL coverage for `GET/POST
 *  /api/pipelines/:id/outputs` and `GET/PATCH/DELETE /api/outputs/:id`:
 *  owner/grantee(editor)/other -> 200/200/404, plus the cascading-delete
 *  placement report (task 2.3). */
class OutputRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var appDb: JdbcBackend.Database                  = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var pipelineRepo: PipelineRepository             = _
  private var outputRepo: OutputRepository                 = _
  private var nodeSnapshotRepo: NodeSnapshotRepository      = _
  private var pipelineRunRepo: PipelineRunRepository       = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var panelRepo: PanelRepository                   = _
  private var dashboardRepo: DashboardRepository            = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var accessChecker: AccessChecker                 = _
  private var outputService: OutputService                 = _
  private var dashboardService: DashboardService            = _
  private var panelService: PanelService                    = _

  private val ownerId   = UUID.randomUUID().toString
  private val granteeId = UUID.randomUUID().toString
  private val otherId   = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))
  private val grantee = AuthenticatedUser(UserId(granteeId))
  private val other   = AuthenticatedUser(UserId(otherId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))

    // Non-superuser app-pool role for the RLS-backed sharing/owner-only
    // checks this spec exercises (`outputs_select`/`outputs_update`/
    // `outputs_delete`, V94) -- a superuser connection would make every
    // `withUserContext` assertion below vacuous (RLS is bypassed entirely
    // for a superuser or `helio_privileged`/BYPASSRLS role). Mirrors
    // `V94OutputsMigrationSpec`'s role setup exactly.
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute("CREATE ROLE helio_app_test_output_routes NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN")
      stmt.execute("GRANT helio_app_test_output_routes TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test_output_routes")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test_output_routes")
      stmt.close()
    } finally {
      superConn.close()
    }
    val appCfg = new HikariConfig()
    appCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test_output_routes")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(10))

    val ctx = new DbContext(appDb, db)(routeEc)

    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo     = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    pipelineRunRepo  = new PipelineRunRepository(ctx)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    outputService = new OutputService(outputRepo, panelRepo, accessChecker, auditService = null, pipelineRunRepo, nodeSnapshotRepo)(routeEc)
    dashboardService = new DashboardService(dashboardRepo, accessChecker)(routeEc)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, null, outputRepo)(routeEc)

    seedUsers()
  }

  override def afterAll(): Unit = {
    appDb.close(); db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, ${s"grantee-$granteeId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, ${s"other-$otherId@helio.test"}, now())"""
    )))
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    val runService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), null, new LocalFileSystem(java.nio.file.Files.createTempDirectory("output-routes-preview")),
      outputRepo = outputRepo
    )(routeEc)
    concat(
      new OutputRoutes(outputService, user)(routeEc).routes,
      new PipelineRunStatusRoutes(runService, user)(routeEc).routes
    )
  }

  /** Real source -> pipeline chain, owned by `owner`, with an editor grant
   *  on the pipeline for `grantee` (mirrors V39's `helio_can_access_pipeline`
   *  sharing rule this whole test class exercises). */
  private def newSharedPipeline(): PipelineId = {
    val now    = Instant.now()
    val source = StaticSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now)
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", createdSource.id, owner)).getOrElse(
      throw new IllegalStateException("newSharedPipeline fixture: pipeline create failed")
    )
    val pipelineId = PipelineId(pipeline.id)
    await(permissionRepo.insert(ResourcePermission("pipeline", pipelineId.value, Some(grantee.id), Role.Editor, now)))
    pipelineId
  }

  "POST /pipelines/:id/outputs" should {
    "let the owner create an Output (200/201)" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "My Output", None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        // Raw-JSON assertion FIRST, on the raw parsed JsObject -- not just the unmarshalled case
        // class. `resp.nodeStepId shouldBe None` alone cannot distinguish "key omitted" from
        // "key present as null" (spray-json's default OptionFormat, with no NullOptions mixed in
        // anywhere in this backend, DROPS a None field entirely rather than writing `null` --
        // same class of imprecision the pipeline-shape-registry `expand` spec fix caught).
        val rawJson = responseAs[JsObject]
        rawJson.fields.keySet should not contain "nodeStepId"
        rawJson.convertTo[OutputResponse].name shouldBe "My Output"
      }
    }

    "let an editor grantee create an Output (200/201)" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Grantee Output", None)) ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    // AccessChecker.requireAccess's existing, pre-existing-codebase-wide rule (identical to
    // PanelService.create's dashboard ACL check): an AUTHENTICATED caller with no grant on a
    // resource that DOES exist gets 403, not 404 -- 404 (existence-not-leaked) is reserved for an
    // ANONYMOUS caller with no public-viewer grant. This is not a new rule invented for Outputs.
    "403 an unrelated authenticated caller with no pipeline grant" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Other Output", None)) ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "400 a create with an unknown fieldMapping slot name, naming the valid slots (HEL-892)" in {
      val pipelineId = newSharedPipeline()
      val config = JsObject("fieldMapping" -> JsObject("bogusSlot" -> JsString("amount")))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "metric", "Bad Metric", Some(config))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        val message = responseAs[ErrorResponse].message
        message should include("bogusSlot")
        message should include("value")
      }
    }

    "200/201 a create whose fieldMapping uses only valid slots for the kind (HEL-892)" in {
      val pipelineId = newSharedPipeline()
      val config = JsObject("fieldMapping" -> JsObject("value" -> JsString("amount"), "label" -> JsString("category")))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "metric", "Good Metric", Some(config))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
    }
  }

  "GET /pipelines/:id/outputs" should {
    "list for the owner and the editor grantee, but 403 for an unrelated authenticated caller" in {
      val pipelineId = newSharedPipeline()
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "out-1", OutputKind.Table))

      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputsResponse].items should have size 1
      }
      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputsResponse].items should have size 1
      }
      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }
  }

  "GET /outputs/:id" should {
    "200 for the owner and the editor grantee (sharing-aware RLS select), 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "shared-out", OutputKind.Metric))

      Get(s"/outputs/${output.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/outputs/${output.id.value}") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/outputs/${output.id.value}") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "PATCH /outputs/:id" should {
    "let the owner rename the Output, but 404 for a non-owner grantee (owner-only RLS)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "old-name", OutputKind.Table))

      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(Some("new-name"), None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputResponse].name shouldBe "new-name"
      }
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(Some("hijacked"), None)) ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(outputRepo.findByIdInternal(output.id)).map(_.name) shouldBe Some("new-name")
    }

    "merge a partial chart.legend config one level deep instead of replacing config wholesale (HEL-877)" in {
      val pipelineId = newSharedPipeline()
      val initialConfig = JsObject("legend" -> JsObject("show" -> JsBoolean(true), "position" -> JsString("top")), "title" -> JsString("Chart"))
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "chart-out", OutputKind.Chart, config = initialConfig))

      val patch = JsObject("legend" -> JsObject("position" -> JsString("bottom")))
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, Some(patch))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val config = responseAs[OutputResponse].config.asJsObject
        config.fields("title") shouldBe JsString("Chart")
        val legend = config.fields("legend").asJsObject
        legend.fields("show") shouldBe JsBoolean(true)
        legend.fields("position") shouldBe JsString("bottom")
      }
    }

    "400 a PATCH whose merged fieldMapping has an unknown slot name (HEL-892)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "metric-out", OutputKind.Metric))

      val patch = JsObject("fieldMapping" -> JsObject("bogusSlot" -> JsString("amount")))
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, Some(patch))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("bogusSlot")
      }
      // Never written -- the config on disk is still empty.
      await(outputRepo.findConfigById(output.id, owner)).map(_.fields.keySet) shouldBe Some(Set.empty)
    }

    "404 an empty-body (no fields to update) PATCH from a non-owner grantee, not a 200 no-op (evaluation-1.md suggestion)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "untouched-name", OutputKind.Table))

      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, None)) ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /outputs/:id/panels" should {
    "list every panel placement for the owner and the editor grantee, 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "placements-out", OutputKind.Table))
      val (dashboard, _) = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("placements-dash")), owner))
      val config = JsObject("outputId" -> JsString(output.id.value))
      val panel = await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), None, Some("output"), Some(config)), owner))
        .getOrElse(throw new IllegalStateException("panel create fixture failed"))

      Get(s"/outputs/${output.id.value}/panels") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val placements = responseAs[Vector[OutputPanelPlacementResponse]]
        placements.map(_.panelId) shouldBe Vector(panel.id.value)
        placements.head.dashboardId shouldBe dashboard.id.value
      }
      Get(s"/outputs/${output.id.value}/panels") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[OutputPanelPlacementResponse]].map(_.panelId) shouldBe Vector(panel.id.value)
      }
      Get(s"/outputs/${output.id.value}/panels") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "an empty result for an Output with no placements" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "no-placements-out", OutputKind.Table))

      Get(s"/outputs/${output.id.value}/panels") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[OutputPanelPlacementResponse]] shouldBe empty
      }
    }
  }

  "DELETE /outputs/:id" should {
    "cascade-delete every panel placement and report the removed ids" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "del-out", OutputKind.Table))
      val (dashboard, _) = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("dash")), owner))
      def newOutputPanel(): PanelId = {
        val config = JsObject("outputId" -> JsString(output.id.value))
        await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), None, Some("output"), Some(config)), owner))
          .getOrElse(throw new IllegalStateException("panel create fixture failed")).id
      }
      val panel1Id = newOutputPanel()
      val panel2Id = newOutputPanel()

      Delete(s"/outputs/${output.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val removed = responseAs[DeleteOutputResponse].removedPanelIds.toSet
        removed shouldBe Set(panel1Id.value, panel2Id.value)
      }
      await(panelRepo.findByIdInternal(panel1Id)) shouldBe None
      await(panelRepo.findByIdInternal(panel2Id)) shouldBe None
      await(outputRepo.findByIdInternal(output.id)) shouldBe None
    }

    "404 for a non-owner grantee, leaving the Output intact (owner-only RLS)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "guarded-out", OutputKind.Table))

      Delete(s"/outputs/${output.id.value}") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(outputRepo.findByIdInternal(output.id)) should not be None
    }
  }

  "GET /outputs/:id/assertion-status" should {
    "invalid = false, failedRuleCount = 0 for an Output on the pipeline's raw source (no step to assert against)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "source-out", OutputKind.Table))

      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AssertionStatusResponse]
        resp.outputId shouldBe output.id.value
        resp.invalid shouldBe false
        resp.failedRuleCount shouldBe 0
      }
    }

    "invalid = false when the node's latest run has no failed error-severity assertions" in {
      val pipelineId = newSharedPipeline()
      val step = await(pipelineStepRepoFor(pipelineId))
      val output = await(outputRepo.insertInternal(pipelineId, Some(step), owner.id, "clean-out", OutputKind.Table))
      seedRunWithAssertions(pipelineId, step, passing = true)

      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AssertionStatusResponse]
        resp.invalid shouldBe false
        resp.failedRuleCount shouldBe 0
      }
    }

    "invalid = true, failedRuleCount > 0 when the node's latest run has a failed error-severity assertion" in {
      val pipelineId = newSharedPipeline()
      val step = await(pipelineStepRepoFor(pipelineId))
      val output = await(outputRepo.insertInternal(pipelineId, Some(step), owner.id, "failing-out", OutputKind.Table))
      seedRunWithAssertions(pipelineId, step, passing = false)

      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AssertionStatusResponse]
        resp.invalid shouldBe true
        resp.failedRuleCount shouldBe 1
      }
    }

    "a failed assertion on a DIFFERENT step does not mark this Output's own node invalid" in {
      val pipelineId = newSharedPipeline()
      val step1 = await(pipelineStepRepoFor(pipelineId))
      val step2 = await(pipelineStepRepoFor(pipelineId))
      val output = await(outputRepo.insertInternal(pipelineId, Some(step1), owner.id, "unaffected-out", OutputKind.Table))
      seedRunWithAssertions(pipelineId, step2, passing = false)

      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AssertionStatusResponse]
        resp.invalid shouldBe false
        resp.failedRuleCount shouldBe 0
      }
    }

    "200 for the owner and the editor grantee, 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "acl-out", OutputKind.Table))

      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.OK }
      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(grantee) ~> check { status shouldBe StatusCodes.OK }
      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(other) ~> check { status shouldBe StatusCodes.NotFound }
    }

    // HEL-906 cycle 4 regression (evaluation-3.md CR1): a successful DRY run persists a real
    // `pipeline_runs` row (`status = "dry_run"`, `insertDryRunInternal`) -- it is NOT absent
    // from the table the way an earlier cycle's (false) doc comment claimed. A dry run started
    // AFTER the real run, with a FAILING assertion of its own, must never surface as this
    // Output's assertion status -- only the latest NON-DRY run counts. Before the fix, this
    // test would have failed: `.headOption` on the unfiltered, startedAt-desc-sorted run list
    // picks the dry run (most recent) and reports its failure as the Output's own.
    "a later dry run's failing assertion is never reported -- only the latest NON-DRY run counts" in {
      val pipelineId = newSharedPipeline()
      val step = await(pipelineStepRepoFor(pipelineId))
      val output = await(outputRepo.insertInternal(pipelineId, Some(step), owner.id, "dry-run-guard-out", OutputKind.Table))

      // Real run first: passes.
      seedRunWithAssertions(pipelineId, step, passing = true)
      // Dry run second (later `startedAt`, so it sorts first if dry runs aren't filtered): fails.
      seedDryRunWithAssertions(pipelineId, step, passing = false)

      Get(s"/outputs/${output.id.value}/assertion-status") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AssertionStatusResponse]
        resp.invalid shouldBe false
        resp.failedRuleCount shouldBe 0
      }
    }
  }

  "GET /outputs/:id/rows" should {
    "200 with the paginated node_snapshots rows for the owner and the editor grantee, 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out", OutputKind.Table))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(1)),
        JsObject("amount" -> JsNumber(2)),
        JsObject("amount" -> JsNumber(3))
      )))

      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(3)
        paged.fields("items").convertTo[Vector[JsValue]] should have size 3
      }
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "respects offset/limit" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-2", OutputKind.Table))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, (1 to 5).map(i => JsObject("i" -> JsNumber(i)))))

      Get(s"/outputs/${output.id.value}/rows?offset=2&limit=2") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(5)
        paged.fields("offset") shouldBe JsNumber(2)
        paged.fields("limit") shouldBe JsNumber(2)
        val items = paged.fields("items").convertTo[Vector[JsObject]]
        items should have size 2
        items.map(_.fields("i")) shouldBe Vector(JsNumber(3), JsNumber(4))
      }
    }

    "400 a negative offset" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-3", OutputKind.Table))
      Get(s"/outputs/${output.id.value}/rows?offset=-1") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "200 with an empty page for an Output with no snapshot written yet" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-4", OutputKind.Table))
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(0)
        paged.fields("items").convertTo[Vector[JsValue]] shouldBe empty
      }
    }
  }

  "GET /outputs (lean paginated list, HEL-906 cycle 7 task 2.6)" should {
    "return only the caller's OWN outputs, paginated, in an OutputsResponse-shaped page" in {
      val pipelineId = newSharedPipeline()
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "list-out-1", OutputKind.Table))
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "list-out-2", OutputKind.Table))
      // Owned by grantee, NOT owner -- must not appear in owner's own list (owner-scoped, not
      // sharing-aware, unlike GET /pipelines/:id/outputs).
      await(outputRepo.insertInternal(pipelineId, None, grantee.id, "grantee-owned-out", OutputKind.Table))

      Get("/outputs") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        val names = paged.fields("items").convertTo[Vector[OutputResponse]].map(_.name)
        names should contain allOf("list-out-1", "list-out-2")
        names should not contain "grantee-owned-out"
      }
    }

    "respects offset/limit" in {
      val pipelineId = newSharedPipeline()
      (1 to 3).foreach(i => await(outputRepo.insertInternal(pipelineId, None, owner.id, s"page-out-$i", OutputKind.Table)))

      Get("/outputs?offset=0&limit=1") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("limit") shouldBe JsNumber(1)
        paged.fields("items").convertTo[Vector[OutputResponse]] should have size 1
      }
    }

    "400 a negative offset" in {
      Get("/outputs?offset=-1") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "POST /pipelines/:id/preview?outputId= (single-Output arm)" should {
    "200 for the owner and the editor grantee (per-Output dry run), 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "preview-out", OutputKind.Table))

      Post(s"/pipelines/${pipelineId.value}/preview?outputId=${output.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val envelope = responseAs[PipelinePreviewResponse]
        envelope.outputs should have size 1
        envelope.outputs.head.outputId shouldBe output.id.value
      }
      Post(s"/pipelines/${pipelineId.value}/preview?outputId=${output.id.value}") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/pipelines/${pipelineId.value}/preview?outputId=${output.id.value}") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "404 for an outputId that does not exist" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/preview?outputId=${UUID.randomUUID().toString}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "does not mutate the pipeline's last_run_status/last_run_at (HTTP-level, real DB round-trip)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "preview-unchanged-out", OutputKind.Table))

      Post(s"/pipelines/${pipelineId.value}/preview?outputId=${output.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }

      val pipelineAfter = await(pipelineRepo.findByIdInternal(pipelineId)).get
      pipelineAfter.lastRunStatus shouldBe None
      pipelineAfter.lastRunAt shouldBe None
    }
  }

  "POST /pipelines/:id/preview (outputId ABSENT — all-Outputs arm, HEL-906 cycle 10)" should {
    "200 for the owner and the editor grantee, 404 for an unrelated caller, with EVERY Output's preview rows in the same envelope shape" in {
      val pipelineId = newSharedPipeline()
      val outputA = await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-out-a", OutputKind.Table))
      val outputB = await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-out-b", OutputKind.Table))

      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val envelope = responseAs[PipelinePreviewResponse]
        envelope.outputs.map(_.outputId).toSet shouldBe Set(outputA.id.value, outputB.id.value)
      }
      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "200 with an empty outputs array for a pipeline with no Outputs" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelinePreviewResponse].outputs shouldBe empty
      }
    }

    "does not mutate the pipeline's last_run_status/last_run_at (HTTP-level, real DB round-trip) -- the risk explicitly named for the all-Outputs path, where more work happens per call" in {
      val pipelineId = newSharedPipeline()
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-unchanged-out-1", OutputKind.Table))
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-unchanged-out-2", OutputKind.Table))

      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }

      val pipelineAfter = await(pipelineRepo.findByIdInternal(pipelineId)).get
      pipelineAfter.lastRunStatus shouldBe None
      pipelineAfter.lastRunAt shouldBe None
    }
  }

  /** A bare `assert` step on `pipelineId`, no parent (trunk root) -- returns its `PipelineStepId`. */
  private def pipelineStepRepoFor(pipelineId: PipelineId): Future[PipelineStepId] = {
    import com.helio.domain.AssertConfig
    pipelineStepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty)).map(_.id)
  }

  /** Seeds one persisted (non-dry) run with a single error-severity assertion on `stepId`,
   *  `passing` controlling whether it's a real regression guard (both branches exercised). */
  private def seedRunWithAssertions(pipelineId: PipelineId, stepId: PipelineStepId, passing: Boolean): Unit = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    await(pipelineRunRepo.insertRunInternal(runId, pipelineId, Instant.now()))
    await(pipelineRunRepo.updateRunTerminalInternal(runId, "succeeded", Instant.now(), Some(1)))
    await(pipelineRunRepo.insertAssertions(runId, Seq(
      AssertionResult(stepId.value, "notNull", Some("amount"), "error", passed = passing, observed = None, message = None)
    )))
  }

  /** Seeds one DRY run (`insertDryRunInternal`, `status = "dry_run"`) with a single
   *  error-severity assertion on `stepId` -- mirrors `onDryRunSuccess`'s real sequencing
   *  (`insertDryRunInternal` before `insertAssertions`, so the FK parent exists). `startedAt`
   *  is always `Instant.now()` at CALL time, so calling this after `seedRunWithAssertions`
   *  gives it a strictly later `startedAt`. */
  private def seedDryRunWithAssertions(pipelineId: PipelineId, stepId: PipelineStepId, passing: Boolean): Unit = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    await(pipelineRunRepo.insertDryRunInternal(runId, pipelineId, Instant.now(), rowCount = 1))
    await(pipelineRunRepo.insertAssertions(runId, Seq(
      AssertionResult(stepId.value, "notNull", Some("amount"), "error", passed = passing, observed = None, message = None)
    )))
  }
}
