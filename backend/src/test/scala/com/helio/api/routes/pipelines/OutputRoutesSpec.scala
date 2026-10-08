package com.helio.api.routes.pipelines

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.testsupport.DatasetRowsTestSupport
import com.helio.api.JsonProtocols
import com.helio.api.ErrorResponse
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.pipelines.{AssertionStatusResponse, CreateOutputRequest, DeleteOutputResponse, OutputPanelPlacementResponse, OutputResponse, OutputsResponse, PipelinePreviewResponse, UpdateOutputRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.domain.steps.RenameConfig
import com.helio.services.pipelines.{OutputFilterCapability, OutputRowsQuery}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
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
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.concurrent.Eventually
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.sql.SQLException
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.collection.concurrent.TrieMap
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-906 (P1.3) — HTTP-layer ACL coverage for `GET/POST
 *  /api/pipelines/:id/outputs` and `GET/PATCH/DELETE /api/outputs/:id`:
 *  owner/grantee(editor)/other -> 200/200/404, plus the cascading-delete
 *  placement report (task 2.3). */
class OutputRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with Eventually with TempDirectorySupport {

  /** Give-up bound only (C6): the poll ends the moment the backfilled rows are materialized. */
  private val BackfillMaterializedStateWaitDeadline = 5.seconds

  /** Give-up bound only (HEL-1356): the await returns the moment the backfill Future completes. */
  private val BackfillCompletionDeadline = 10.seconds

  /** HEL-1356: the Future `OutputService` hands to its `backfillObserver`, keyed by Output id. */
  private val backfillFutures = new TrieMap[OutputId, Future[Unit]]()

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var appDb: JdbcBackend.Database                  = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineRootRepo: PipelineRootRepository     = _
  private var outputRepo: OutputRepository                 = _
  private var nodeSnapshotRepo: NodeSnapshotRepository      = _
  private var pipelineRunRepo: PipelineRunRepository       = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var panelRepo: PanelRepository                   = _
  private var dashboardRepo: DashboardRepository            = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var accessChecker: AccessChecker                 = _
  private var outputService: OutputService                 = _
  private var sharedRunService: PipelineRunService          = _
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
    // HEL-947: shared across every `routesFor(user)` call below (a fresh `PipelineRunService`
    // per request would work too -- `backfillOutputNode` is stateless -- but one instance mirrors
    // how the real `ApiRoutes` wiring shares a single service instance across requests).
    sharedRunService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), null, new LocalFileSystem(newTempDir("output-routes-shared")),
      outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo
    )(routeEc)
    pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    outputService = new OutputService(
      outputRepo, panelRepo, accessChecker, auditService = null, pipelineRunRepo, nodeSnapshotRepo,
      pipelineRunService = sharedRunService, pipelineRootRepo = pipelineRootRepo,
      backfillObserver = (id, done) => backfillFutures.put(id, done)
    )(routeEc)
    dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)(routeEc)
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
    concat(
      new OutputRoutes(outputService, user)(routeEc).routes,
      new PipelineRunStatusRoutes(sharedRunService, user)(routeEc).routes
    )
  }

  /** Real source -> pipeline chain, owned by `owner`, with an editor grant
   *  on the pipeline for `grantee` (mirrors V39's `helio_can_access_pipeline`
   *  sharing rule this whole test class exercises). */
  private def newSharedPipeline(): PipelineId = {
    val now    = Instant.now()
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now)
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", Vector(createdSource.id), owner)).getOrElse(
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

    // HEL-1002: AccessChecker.requireAccess answers an AUTHENTICATED caller with no grant on a real
    // resource exactly like an absent one (404, existence not leaked); only a viewer grantee is 403.
    "404 an unrelated authenticated caller with no pipeline grant" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Other Output", None)) ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
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

    // HEL-1139: a slotless kind's rejection must say so, not "Valid slots: " followed by nothing.
    "400 a markdown create carrying fieldMapping.content, saying markdown has no fieldMapping slots (HEL-1139)" in {
      val pipelineId = newSharedPipeline()
      val config = JsObject("content" -> JsString(""), "fieldMapping" -> JsObject("content" -> JsString("notes")))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "markdown", "Bad Markdown", Some(config))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        val message = responseAs[ErrorResponse].message
        message should include("'markdown' has no fieldMapping slots")
        message should include("config.content")
        message should not include "Valid slots:"
      }
    }

    "400 a table create carrying a fieldMapping key gets the same kind-parametrised slotless message (HEL-1139)" in {
      val pipelineId = newSharedPipeline()
      val config = JsObject("fieldMapping" -> JsObject("anything" -> JsString("notes")))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Bad Table", Some(config))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("'table' has no fieldMapping slots")
      }
    }

    "400 a markdown PATCH carrying fieldMapping.content, saying markdown has no fieldMapping slots, and writes nothing (HEL-1139)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "md-out", OutputKind.Markdown, explicitRootId = None))
      val patch = JsObject("fieldMapping" -> JsObject("content" -> JsString("notes")))
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, Some(patch))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("'markdown' has no fieldMapping slots")
      }
      await(outputRepo.findConfigById(output.id, owner)).map(_.fields.keySet) shouldBe Some(Set.empty)
    }

    "200/201 a create whose fieldMapping uses only valid slots for the kind (HEL-892)" in {
      val pipelineId = newSharedPipeline()
      val config = JsObject("fieldMapping" -> JsObject("value" -> JsString("amount"), "label" -> JsString("category")))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "metric", "Good Metric", Some(config))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    // HEL-946 Bug B: the create response used to hardcode `config: {}` via
    // `outputResponseFrom`'s defaulting single-arg overload, even though the
    // request body carried a real config and the DB write itself was
    // correct — a save "vanished" on the very response that confirmed it.
    "returns the config the request body carried, not an empty object (HEL-946)" in {
      val pipelineId = newSharedPipeline()
      // HEL-1313: was a `legend` key (a dead key, now 400); contract change, same echo assertion.
      val config = JsObject("chartType" -> JsString("bar"))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "chart", "Chart Output", Some(config))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[OutputResponse].config shouldBe config
      }
    }

    // HEL-913 task 5.8a: an Output can be bound to a NON-FIRST root, naming it explicitly.
    "creates a root-bound Output on a caller-named SECOND root, not silently on the first (task 5.8a)" in {
      val pipelineId = newSharedPipeline()
      val secondSrc = await(dataSourceRepo.insert(
        DatasetSource(DataSourceId(UUID.randomUUID().toString), "src2", owner.id, Instant.now(), Instant.now()), owner
      ))
      val secondRoot = await(pipelineRootRepo.add(pipelineId, secondSrc.id, owner))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Second Root Output", None, rootId = Some(secondRoot.id.value))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[OutputResponse].rootId shouldBe Some(secondRoot.id.value)
      }
    }

    "400s a rootId that belongs to a DIFFERENT pipeline, naming it (task 5.8a)" in {
      val pipelineId = newSharedPipeline()
      val otherPipelineId = newSharedPipeline()
      val foreignRoots = await(pipelineRootRepo.list(otherPipelineId, owner))
      val foreignRootId = foreignRoots.head.id.value
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Cross-Pipeline Root Output", None, rootId = Some(foreignRootId))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include(foreignRootId)
      }
    }

    "400s a create naming BOTH nodeStepId and rootId (mutually exclusive, task 5.8a)" in {
      val pipelineId = newSharedPipeline()
      val step = await(pipelineStepRepo.insertRootStep(pipelineId, "rename", RenameConfig(Map("a" -> "b")), owner))
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(Some(step.id.value), "table", "Both Output", None, rootId = Some("some-root"))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "GET /pipelines/:id/outputs" should {
    "list for the owner and the editor grantee, but 404 for an unrelated authenticated caller" in {
      val pipelineId = newSharedPipeline()
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "out-1", OutputKind.Table, explicitRootId = None))

      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputsResponse].items should have size 1
      }
      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputsResponse].items should have size 1
      }
      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-946 Bug B: this is the route the Pipeline page hits on EVERY mount
    // -- it used to hardcode `config: {}` for every Output regardless of what
    // was actually persisted, via `outputResponseFrom`'s defaulting
    // single-arg overload, so a saved edit appeared to "vanish" on refresh.
    // Batched (`OutputService.configsFor`), not fetched per-row.
    "returns each Output's real persisted config, batched (HEL-946)" in {
      val pipelineId = newSharedPipeline()
      val config1 = JsObject("legend" -> JsObject("show" -> JsBoolean(true)))
      val config2 = JsObject("format" -> JsString("percent"))
      val out1 = await(outputRepo.insertInternal(pipelineId, None, owner.id, "out-1", OutputKind.Chart, config1, explicitRootId = None))
      val out2 = await(outputRepo.insertInternal(pipelineId, None, owner.id, "out-2", OutputKind.Metric, config2, explicitRootId = None))

      Get(s"/pipelines/${pipelineId.value}/outputs") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val byId = responseAs[OutputsResponse].items.map(o => o.id -> o.config).toMap
        byId(out1.id.value) shouldBe config1
        byId(out2.id.value) shouldBe config2
      }
    }
  }

  "GET /outputs/:id" should {
    "200 for the owner and the editor grantee (sharing-aware RLS select), 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "shared-out", OutputKind.Metric, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "old-name", OutputKind.Table, explicitRootId = None))

      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(Some("new-name"), None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputResponse].name shouldBe "new-name"
      }
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(Some("hijacked"), None)) ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(outputRepo.findByIdInternal(output.id)).map(_.name) shouldBe Some("new-name")
    }

    // HEL-1313 supersedes HEL-877's one-level deep merge of legend/tooltip/seriesColors/axisLabels:
    // no renderer reads them, so they are unknown config keys (contract change, not a fixture edit).
    "shallow-merge a config patch: named keys replace, absent keys are kept (HEL-877/HEL-1313)" in {
      val pipelineId = newSharedPipeline()
      val initialConfig = JsObject("chartType" -> JsString("bar"), "chartOptions" -> JsObject("a" -> JsString("1")))
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "chart-out", OutputKind.Chart, config = initialConfig, explicitRootId = None))

      val patch = JsObject("chartOptions" -> JsObject("b" -> JsString("2")))
      Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, Some(patch))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val config = responseAs[OutputResponse].config.asJsObject
        config.fields("chartType") shouldBe JsString("bar")
        config.fields("chartOptions") shouldBe JsObject("b" -> JsString("2"))
      }
    }

    "400 a PATCH introducing legend/tooltip/seriesColors/axisLabels naming the key, persisting nothing (HEL-1313)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "chart-out", OutputKind.Chart, config = JsObject("chartType" -> JsString("bar")), explicitRootId = None))
      Seq("legend", "tooltip", "seriesColors", "axisLabels").foreach { key =>
        val patch = JsObject(key -> JsObject("x" -> JsString("y")))
        Patch(s"/outputs/${output.id.value}", UpdateOutputRequest(None, Some(patch))) ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(s"`$key`")
        }
      }
      Get(s"/outputs/${output.id.value}") ~> routesFor(owner) ~> check {
        responseAs[OutputResponse].config shouldBe JsObject("chartType" -> JsString("bar"))
      }
    }

    "400 a PATCH whose merged fieldMapping has an unknown slot name (HEL-892)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "metric-out", OutputKind.Metric, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "untouched-name", OutputKind.Table, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "placements-out", OutputKind.Table, explicitRootId = None))
      val (dashboard, _) = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("placements-dash")), owner))
      val config = JsObject("outputId" -> JsString(output.id.value))
      val panel = await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), None, Some("output"), Some(config)), owner))
        .getOrElse(throw new IllegalStateException("panel create fixture failed"))
        ._1

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "no-placements-out", OutputKind.Table, explicitRootId = None))

      Get(s"/outputs/${output.id.value}/panels") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[OutputPanelPlacementResponse]] shouldBe empty
      }
    }
  }

  "DELETE /outputs/:id" should {
    "cascade-delete every panel placement and report the removed ids" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "del-out", OutputKind.Table, explicitRootId = None))
      val (dashboard, _) = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("dash")), owner))
      def newOutputPanel(): PanelId = {
        val config = JsObject("outputId" -> JsString(output.id.value))
        await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), None, Some("output"), Some(config)), owner))
          .getOrElse(throw new IllegalStateException("panel create fixture failed"))._1.id
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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "guarded-out", OutputKind.Table, explicitRootId = None))

      Delete(s"/outputs/${output.id.value}") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(outputRepo.findByIdInternal(output.id)) should not be None
    }
  }

  "GET /outputs/:id/assertion-status" should {
    "invalid = false, failedRuleCount = 0 for an Output on the pipeline's raw source (no step to assert against)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "source-out", OutputKind.Table, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, Some(step), owner.id, "clean-out", OutputKind.Table, explicitRootId = None))
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
      val output = await(outputRepo.insertInternal(pipelineId, Some(step), owner.id, "failing-out", OutputKind.Table, explicitRootId = None))
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
      val output = await(outputRepo.insertInternal(pipelineId, Some(step1), owner.id, "unaffected-out", OutputKind.Table, explicitRootId = None))
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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "acl-out", OutputKind.Table, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, Some(step), owner.id, "dry-run-guard-out", OutputKind.Table, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out", OutputKind.Table, explicitRootId = None))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(1)),
        JsObject("amount" -> JsNumber(2)),
        JsObject("amount" -> JsNumber(3))
      ), explicitRootId = None))

      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(3)
        paged.fields("items").convertTo[Vector[JsValue]] should have size 3
        // HEL-946 Bug C(2): non-empty rows are unambiguously materialized.
        paged.fields("materialized") shouldBe JsBoolean(true)
      }
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-913 task 5.8b-iv-a: a root-bound Output's rows read must scope to ITS OWN root, never
    // every root's `node_step_id IS NULL` rows mixed together (design.md R12's named bug --
    // "whichever root writes second wipes/mixes with the other"). Before this fix,
    // `OutputRoutesSpec`'s route -> `OutputService.rows` -> `nodeSnapshotRepo.listRowsPaged`
    // chain never threaded `output.node.rootId` through, silently defaulting to
    // `explicitRootId = None` and returning EVERY root's root-bound rows unioned.
    "returns ONLY the Output's own root's rows, not another root's mixed in (task 5.8b-iv-a)" in {
      val pipelineId = newSharedPipeline()
      val secondSrc = await(dataSourceRepo.insert(
        DatasetSource(DataSourceId(UUID.randomUUID().toString), "src2", owner.id, Instant.now(), Instant.now()), owner
      ))
      val secondRoot = await(pipelineRootRepo.add(pipelineId, secondSrc.id, owner))
      val firstRoot  = await(pipelineRootRepo.list(pipelineId, owner)).minBy(_.position)

      // Root-bound snapshot rows for EACH root, written independently.
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("root" -> JsString("first"))), explicitRootId = Some(firstRoot.id.value)))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("root" -> JsString("second")), JsObject("root" -> JsString("second-2"))), explicitRootId = Some(secondRoot.id.value)))

      // The Output under test is bound to the SECOND root specifically.
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "second-root-out", OutputKind.Table, explicitRootId = Some(secondRoot.id)))

      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(2)
        val rows = paged.fields("items").convertTo[Vector[JsObject]]
        rows.map(_.fields("root")) shouldEqual Vector(JsString("second"), JsString("second-2"))
      }
    }

    "respects offset/limit" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-2", OutputKind.Table, explicitRootId = None))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, (1 to 5).map(i => JsObject("i" -> JsNumber(i))), explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-3", OutputKind.Table, explicitRootId = None))
      Get(s"/outputs/${output.id.value}/rows?offset=-1") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    // HEL-946 Bug C(2): a node with NO successful run at all since the
    // Output was added has never been materialized -- this is the
    // "no data available, but the panel is actionable" case, distinct from
    // a node that ran and legitimately returned zero rows (next test).
    "200 with an empty page and materialized=false for an Output that has never had a successful run" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-4", OutputKind.Table, explicitRootId = None))
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(0)
        paged.fields("items").convertTo[Vector[JsValue]] shouldBe empty
        paged.fields("materialized") shouldBe JsBoolean(false)
      }
    }

    // HEL-946 Bug C(2): a successful run AFTER the Output was created means
    // `onUnblockedRunSuccess` DID process this node (writing an empty
    // snapshot is still a write) -- an empty result here is genuine, not a
    // "never run" state, so `materialized` must be `true` and no misleading
    // "run the pipeline" prompt should render.
    "200 with an empty page and materialized=true when a successful run completed after the Output was created" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "rows-out-5", OutputKind.Table, explicitRootId = None))
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRunInternal(runId, pipelineId, Instant.now()))
      await(pipelineRunRepo.updateRunTerminalInternal(runId, "succeeded", Instant.now().plusSeconds(1), Some(0), errorLog = None, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson)))

      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(0)
        paged.fields("materialized") shouldBe JsBoolean(true)
      }
    }

    // HEL-947 (backfill for an Output added to an already-run node): the pipeline's only node
    // (its raw source) runs successfully with NO Output attached yet, then an Output is created
    // against it afterwards through the real HTTP create route -- with no second run in between.
    // Regression guard for the ticket; observed RED before `OutputService.create` was wired to
    // fire `PipelineRunService.backfillOutputNode`. The create response itself does not carry
    // the backfilled rows (`backfillOutputNode` runs off the request path, per the write-
    // amplification measurement in PipelineRunService's own doc -- see PR #525), so this polls
    // `GET .../rows` with `eventually` rather than asserting on the create response.
    "200 with real rows and materialized=true for an Output created AFTER its node already ran successfully, with no re-run" in {
      import PostgresProfile.api._
      val dsId = UUID.randomUUID().toString
      val dsConfig = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"],["bob"]]}"""
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources
          (id, name, source_type, config, owner_id, created_at, updated_at)
          VALUES ($dsId, 'ds-backfill', 'dataset', '{}', $ownerId::uuid, now(), now())""",
        DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
      )))
      val pipeline = await(pipelineRepo.create("backfill-pipe", Vector(DataSourceId(dsId)), owner)).getOrElse(
        throw new IllegalStateException("backfill fixture: pipeline create failed")
      )
      val pipelineId = PipelineId(pipeline.id)

      // Run the pipeline BEFORE any Output exists on its (only) node.
      val runResult = await(sharedRunService.submit(pipelineId, isDry = false, owner))
      runResult shouldBe a[Right[_, _]]

      // Only now attach an Output to the trunk root (the pipeline has a source but no steps, so
      // the trunk root is the source node itself -- `nodeStepId = None`) via the REAL create
      // route, so `OutputService.create`'s `triggerBackfill` actually fires.
      var outputId = ""
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "backfilled-output", None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        outputId = responseAs[JsObject].fields("id").convertTo[String]
      }

      // No second run. The backfill fires off the request path -- poll until it lands. HEL-1341 D9:
      // an explicit state wait with a NAMED give-up deadline (the bare `eventually` used
      // ScalaTest's 150 ms default patience, which a slow backfill + HTTP/DB round trip overran).
      eventually(timeout(BackfillMaterializedStateWaitDeadline), interval(50.millis)) {
        Get(s"/outputs/$outputId/rows") ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.OK
          val paged = responseAs[JsObject]
          paged.fields("materialized") shouldBe JsBoolean(true)
          paged.fields("items").convertTo[Vector[JsValue]] should not be empty
        }
      }
    }

    // HEL-947: an Output created on a node that has NEVER had a successful run must NOT be
    // backfilled -- `backfillOutputNode` must see no `latestSuccessfulCompletedAtInternal` and
    // no-op, leaving the HEL-946 "not run yet" (`materialized: false`) state exactly as it was
    // pre-HEL-947. Guards against a regression where the fire-and-forget trigger fires
    // unconditionally regardless of run history.
    "does not backfill and stays materialized=false for an Output created on a node that has never run" in {
      import PostgresProfile.api._
      // Real dataset rows are seeded (as in the positive test above) so that a forbidden
      // backfill WOULD write snapshot rows and flip materialized -- on an empty source it
      // writes nothing and the negative check could never fail. The pipeline is never run.
      val dsId = UUID.randomUUID().toString
      val dsConfig = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"],["bob"]]}"""
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources
          (id, name, source_type, config, owner_id, created_at, updated_at)
          VALUES ($dsId, 'ds-never-run', 'dataset', '{}', $ownerId::uuid, now(), now())""",
        DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
      )))
      val pipeline = await(pipelineRepo.create("never-run-pipe", Vector(DataSourceId(dsId)), owner)).getOrElse(
        throw new IllegalStateException("never-run fixture: pipeline create failed")
      )
      val pipelineId = PipelineId(pipeline.id)
      var outputId = ""
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "never-run-output", None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        outputId = responseAs[JsObject].fields("id").convertTo[String]
      }

      // HEL-1356: wait on the production completion hook, not a sleep. Fail loudly if the hook
      // never recorded a Future, so a broken hook cannot make this negative check vacuous.
      val backfillDone = backfillFutures.getOrElse(
        OutputId(outputId),
        fail("no backfill Future recorded for the created Output: completion hook not invoked")
      )
      Await.result(backfillDone, BackfillCompletionDeadline)

      Get(s"/outputs/$outputId/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("materialized") shouldBe JsBoolean(false)
        paged.fields("items").convertTo[Vector[JsValue]] shouldBe empty
      }
    }
  }

  // HEL-1027 task 1.1 -- V111's two cast functions, re-verified against THIS environment's own
  // Postgres version (embedded-postgres 14.10.1, NOT design-time's live Postgres 18 probe --
  // design.md D2's citation-correction round explicitly calls out this gap).
  "safe_numeric / safe_timestamptz (V111, HEL-1027 task 1.1)" should {
    "safe_numeric parses every well-formed numeric shape and returns NULL for a malformed one" in {
      import PostgresProfile.api._
      def numeric(v: String): Option[String] = await(db.run(sql"SELECT safe_numeric($v)::text".as[Option[String]].head))
      BigDecimal(numeric("42").get) shouldBe BigDecimal(42)
      BigDecimal(numeric("-3.14").get) shouldBe BigDecimal("-3.14")
      BigDecimal(numeric("1e10").get) shouldBe BigDecimal("1e10")
      numeric("not-a-number") shouldBe None
      numeric("") shouldBe None
    }

    "safe_timestamptz parses every recognized format and returns NULL (never throws) for a malformed OR calendar-invalid shape" in {
      import PostgresProfile.api._
      def ts(v: String): Option[String] = await(db.run(sql"SELECT safe_timestamptz($v)::text".as[Option[String]].head))
      // The six original round-1/round-2 cases -- all parse successfully.
      ts("2024-01-01T10:15") shouldBe defined
      ts("2024-01-01T10:15+01:00") shouldBe defined
      ts("2024-01-01T10:15:30+01:00[Europe/Paris]") shouldBe defined
      ts("01/31/2026").get should startWith("2026-01-31")
      ts("2024-01-01") shouldBe defined
      ts("garbage") shouldBe None
      // The four round-3 calendar-invalid cases -- digit-shaped like a recognized format, but
      // semantically invalid; the regex alone would let these through to the cast, which is
      // exactly why `safe_timestamptz` reverted to `plpgsql`/`EXCEPTION` (D2 round 3).
      ts("2024-02-30") shouldBe None
      ts("2024-13-45") shouldBe None
      ts("9999-99-99") shouldBe None
      ts("13/45/2024") shouldBe None
    }
  }

  "NodeSnapshotRepository.sortCastFor (HEL-1027 task 1.2)" should {
    "maps every DataFieldType to its D2 cast category" in {
      import NodeSnapshotRepository.SortCast._
      NodeSnapshotRepository.sortCastFor(DataFieldType.IntegerType) shouldBe Some(AsNumeric)
      NodeSnapshotRepository.sortCastFor(DataFieldType.FloatType) shouldBe Some(AsNumeric)
      NodeSnapshotRepository.sortCastFor(DataFieldType.TimestampType) shouldBe Some(AsTimestamp)
      NodeSnapshotRepository.sortCastFor(DataFieldType.StringType) shouldBe Some(AsText)
      NodeSnapshotRepository.sortCastFor(DataFieldType.BooleanType) shouldBe Some(AsText)
      NodeSnapshotRepository.sortCastFor(DataFieldType.StringBodyType) shouldBe None
      NodeSnapshotRepository.sortCastFor(DataFieldType.BinaryRefType) shouldBe None
    }
  }

  "NodeSnapshotRepository.listRowsPaged sort/filter (HEL-1027 tasks 2.1/2.2)" should {
    "sorts the WHOLE node's rows (not just one page) and is stable across two offset calls (task 2.1)" in {
      val pipelineId = newSharedPipeline()
      val rows = (1 to 25).map(i => JsObject("amount" -> JsNumber(i)))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, rows, explicitRootId = None))
      val sortSpec = NodeSnapshotRepository.SortSpec("amount", NodeSnapshotRepository.SortDirection.Desc, NodeSnapshotRepository.SortCast.AsNumeric)

      val page0 = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 10), explicitRootId = None, sort = Some(sortSpec)))
      val page1 = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(10, 10), explicitRootId = None, sort = Some(sortSpec)))

      page0.total shouldBe 25
      page0.items.map(_.fields("amount").convertTo[Int]) shouldBe (25 to 16 by -1).toVector
      page1.items.map(_.fields("amount").convertTo[Int]) shouldBe (15 to 6 by -1).toVector
      // Stable pagination -- no row duplicated or dropped across the two offset calls.
      (page0.items ++ page1.items).map(_.fields("amount").convertTo[Int]).toSet shouldBe (6 to 25).toSet
    }

    "a malformed numeric value sorts last rather than 500ing the request (D2)" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(5)),
        JsObject("amount" -> JsString("not-a-number")),
        JsObject("amount" -> JsNumber(1))
      ), explicitRootId = None))
      val sortSpec = NodeSnapshotRepository.SortSpec("amount", NodeSnapshotRepository.SortDirection.Asc, NodeSnapshotRepository.SortCast.AsNumeric)

      val result = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 10), explicitRootId = None, sort = Some(sortSpec)))
      result.items.map(_.fields("amount")) shouldBe Vector(JsNumber(1), JsNumber(5), JsString("not-a-number"))
    }

    "total reflects the FILTERED row count, not the raw count, when a filter narrows the set (D5, task 2.2)" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("name" -> JsString("alice")),
        JsObject("name" -> JsString("bob")),
        JsObject("name" -> JsString("alicia"))
      ), explicitRootId = None))
      val filterSpec = NodeSnapshotRepository.FilterSpec(quickTerm = Some("ali"), quickColumns = Vector("name"), columnTerms = Map.empty)

      val result = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 10), explicitRootId = None, filter = Some(filterSpec)))
      result.total shouldBe 2
      result.items.map(_.fields("name")) should contain theSameElementsAs Vector(JsString("alice"), JsString("alicia"))
    }

    "a filter term containing LIKE metacharacters (%, _) matches only the literal characters (D6 escaping)" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("label" -> JsString("50% off")),
        JsObject("label" -> JsString("full price"))
      ), explicitRootId = None))
      val filterSpec = NodeSnapshotRepository.FilterSpec(quickTerm = Some("50%"), quickColumns = Vector("label"), columnTerms = Map.empty)

      val result = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 10), explicitRootId = None, filter = Some(filterSpec)))
      result.total shouldBe 1
      result.items.map(_.fields("label")) shouldBe Vector(JsString("50% off"))
    }
  }

  // HEL-1027 task 2.3 -- the required RED-FIRST security probe (Iron Law: systematic-debugging.md).
  "Hostile column name handling (HEL-1027 D6/task 2.3)" should {
    // Independent of every production code path in this ticket -- exists ONLY to prove the
    // vulnerability CLASS this ticket's design (D6: bound parameters, never string-interpolated
    // SQL) defends against is real on THIS environment's live embedded Postgres, not
    // hypothetical. A naive first draft might build its ORDER BY/WHERE text via raw string
    // concatenation instead of a bind parameter -- this probe reproduces exactly that shape
    // (a `java.sql.Statement.execute` call, the same "simple query protocol" mode the pgjdbc
    // driver uses, which -- unlike a `PreparedStatement` -- executes multiple semicolon-separated
    // statements from one string) and confirms it actually executes an injected `DROP TABLE`.
    "RED: a naive string-interpolated SQL statement executes an injected DROP TABLE (probe, not the shipped code path)" in {
      val probeTable = s"hel1027_probe_${UUID.randomUUID().toString.replace("-", "")}"
      val conn = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        val setup = conn.createStatement()
        setup.execute(s"CREATE TABLE $probeTable (id int)")
        setup.execute(s"INSERT INTO $probeTable VALUES (1)")

        // Mirrors the shape of a naive `s"...'$hostileValue'..."` query builder -- the hostile
        // value closes the string literal early, then appends a second statement.
        val hostileValue = s"x'; DROP TABLE $probeTable; --"
        val naiveSql = s"SELECT '$hostileValue'"
        val naiveStmt = conn.createStatement()
        try naiveStmt.execute(naiveSql) catch { case _: SQLException => () }

        val checkStmt = conn.createStatement()
        val rs = checkStmt.executeQuery(
          s"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$probeTable')"
        )
        rs.next()
        // RED: the naive statement executed the injected DROP -- the probe table is gone.
        rs.getBoolean(1) shouldBe false
      } finally conn.close()
    }

    "GREEN: NodeSnapshotRepository binds a hostile column name as a harmless literal, never executes it" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1))), explicitRootId = None))
      val hostileColumn = "'; DROP TABLE node_snapshots; --"
      val sortSpec = NodeSnapshotRepository.SortSpec(hostileColumn, NodeSnapshotRepository.SortDirection.Asc, NodeSnapshotRepository.SortCast.AsText)

      // No exception -- the hostile string is just a JSON key that doesn't exist on any row, so
      // every row's sort key is NULL and the rows come back in their tiebreaker (row_index) order.
      val result = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 10), explicitRootId = None, sort = Some(sortSpec)))
      result.total shouldBe 1

      // `node_snapshots` itself -- the real table a naive implementation could have dropped --
      // is untouched: a later, unrelated read against it still works.
      val stillThere = await(nodeSnapshotRepo.listRows(pipelineId.value, None, explicitRootId = None))
      stillThere should have size 1
    }

    "GREEN: a hostile sort column name is rejected as 400 at the route, before it ever reaches SQL (D3)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "hostile-sort-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1))), explicitRootId = None))
      val hostile = java.net.URLEncoder.encode("'; DROP TABLE node_snapshots; --", "UTF-8")

      Get(s"/outputs/${output.id.value}/rows?sort=$hostile:asc") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      val stillThere = await(nodeSnapshotRepo.listRows(pipelineId.value, None, explicitRootId = None))
      stillThere should have size 1
    }
  }

  "GET /outputs/:id/rows sort/filter query params (HEL-1027 tasks 3.1/3.2/3.3)" should {
    val amountSchema = Vector(SchemaField("amount", "integer"), SchemaField("notes", "string-body"))

    def seededOutput(): (PipelineId, OutputId) = {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "sort-filter-out", OutputKind.Table, schema = amountSchema, explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(3), "notes" -> JsString("c")),
        JsObject("amount" -> JsNumber(1), "notes" -> JsString("a")),
        JsObject("amount" -> JsNumber(2), "notes" -> JsString("b"))
      ), explicitRootId = None))
      (pipelineId, output.id)
    }

    "sorts by a declared Structured column, ranking the whole node (task 3.1/3.2)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?sort=amount:desc") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items.map(_.fields("amount")) shouldBe Vector(JsNumber(3), JsNumber(2), JsNumber(1))
      }
    }

    "400s sort on a column absent from schema, naming it (task 3.1, D3)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?sort=bogus:asc") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("bogus")
      }
    }

    "400s sort on a Content-category column, naming it (task 3.1, D3)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?sort=notes:asc") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("notes")
      }
    }

    "400s a malformed sort shape (no direction) before ever resolving the Output (task 3.2)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?sort=amount") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "400s an unrecognized sort direction (task 3.2)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?sort=amount:sideways") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "400s malformed filter JSON (task 3.2)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?filter=not-json") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "filters by a declared Structured column via quick term, narrowing the whole node (task 3.1)" in {
      val (_, outputId) = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"quick":"2"}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(1)
        paged.fields("items").convertTo[Vector[JsObject]].map(_.fields("amount")) shouldBe Vector(JsNumber(2))
      }
    }

    "400s a filter.columns entry naming a Content-category column (task 3.1, D3)" in {
      val (_, outputId) = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"columns":{"notes":"x"}}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("notes")
      }
    }

    "404s (not 400) for a caller with no ACL relationship, even with sort/filter present (task 3.3)" in {
      val (_, outputId) = seededOutput()
      Get(s"/outputs/${outputId.value}/rows?sort=amount:asc&filter=%7B%22quick%22%3A%221%22%7D") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "OutputService.rows materialized derivation under a filter (HEL-1027 D5 amendment, task 3.4)" should {
    "RED-FIRST: reports materialized=true for a zero-match filter on an Output with real data" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "zero-match-out", OutputKind.Table,
        schema = Vector(SchemaField("name", "string")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("name" -> JsString("alice")),
        JsObject("name" -> JsString("bob"))
      ), explicitRootId = None))

      // Sanity: the naive `paged.total > 0` proxy this fix replaces WOULD have reported
      // `materialized: false` here, since a zero-match filtered `total` is legitimately 0 --
      // confirmed directly against the now-decoupled existence check below.
      val naiveWouldReportFalse = await(nodeSnapshotRepo.listRowsPaged(
        pipelineId.value, None, Page(0, 10), explicitRootId = None,
        filter = Some(NodeSnapshotRepository.FilterSpec(Some("nonexistent-term"), Vector("name"), Map.empty))
      )).total == 0
      naiveWouldReportFalse shouldBe true

      val filter = java.net.URLEncoder.encode("""{"quick":"nonexistent-term"}""", "UTF-8")
      Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(0)
        paged.fields("items").convertTo[Vector[JsValue]] shouldBe empty
        // GREEN (post-fix): distinguishable from a genuinely never-materialized Output.
        paged.fields("materialized") shouldBe JsBoolean(true)
      }
    }

    "the genuinely-never-materialized case is unaffected (no rows, no filter)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "never-materialized-out", OutputKind.Table, explicitRootId = None))
      Get(s"/outputs/${output.id.value}/rows") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("materialized") shouldBe JsBoolean(false)
      }
    }
  }

  "GET /outputs/:id/rows sort/filter end-to-end (HEL-1027 tasks 7.1/7.2)" should {
    "task 7.1: sort ranks the WHOLE Output across pages, not the fetched window -- RED-FIRST against current main's client-side-only sort" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "e2e-sort-out", OutputKind.Table,
        schema = Vector(SchemaField("revenue", "integer")), explicitRootId = None
      ))
      // 60 rows, revenue ASCENDING by row_index (row_index 0 has revenue 0, ..., row_index 59
      // has revenue 59) -- and one malformed value planted mid-set. Under current main (no
      // `sort` param support at all -- an unrecognized query param is silently ignored by
      // Pekko's `parameters` directive), the FIRST page (limit=20) is simply the first 20 rows
      // BY row_index (revenue 0..19), which is NOT the 20 highest-revenue rows across the whole
      // Output (40..59) -- exactly HEL-448's own "ranks only the fetched window" defect this
      // ticket fixes. This same request, run against this worktree's OWN (fixed) code below,
      // must return the TRUE top 20 by revenue.
      val rows = (0 until 60).map { i =>
        if (i == 30) JsObject("revenue" -> JsString("not-a-number")) else JsObject("revenue" -> JsNumber(i))
      }
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, rows, explicitRootId = None))

      Get(s"/outputs/${output.id.value}/rows?sort=revenue:desc&limit=20") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items should have size 20
        // The true top 20 by revenue across the WHOLE 60-row Output (40..59), not the top 20
        // among the first-fetched window -- this is the assertion that would have FAILED against
        // current main's row_index-only ordering (which would have returned 0..19, i.e. the
        // LOWEST revenue values, since no `sort` param existed to rank by revenue at all).
        items.map(_.fields("revenue").convertTo[Int]) shouldBe (59 to 40 by -1).toVector
      }

      // Pagination is stable across two page fetches at the same sort.
      val page0 = await(nodeSnapshotRepo.listRowsPaged(
        pipelineId.value, None, Page(0, 20), explicitRootId = None,
        sort = Some(NodeSnapshotRepository.SortSpec("revenue", NodeSnapshotRepository.SortDirection.Desc, NodeSnapshotRepository.SortCast.AsNumeric))
      ))
      val page1 = await(nodeSnapshotRepo.listRowsPaged(
        pipelineId.value, None, Page(20, 20), explicitRootId = None,
        sort = Some(NodeSnapshotRepository.SortSpec("revenue", NodeSnapshotRepository.SortDirection.Desc, NodeSnapshotRepository.SortCast.AsNumeric))
      ))
      val seen = (page0.items ++ page1.items).flatMap(_.fields.get("revenue")).collect { case JsNumber(n) => n.toInt }
      seen.distinct should have size seen.size // no duplicates across pages
    }

    "task 7.2: a filter matching fewer than one page's worth across the WHOLE Output drives total/hasMore -- RED-FIRST against current main's raw total" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "e2e-filter-out", OutputKind.Table,
        schema = Vector(SchemaField("label", "string")), explicitRootId = None
      ))
      // 60 rows; only 3 (spread beyond the first page) match "target". Current main's
      // `total` is always the RAW row count (60) regardless of any filter (no `filter` param
      // support exists at all) -- so `hasMore` (`offset + limit < total`) would incorrectly stay
      // `true` after the client received all 3 real matches, implying more matches remain when
      // none do. This is the assertion that fails against current main's raw-total behavior.
      val rows = (0 until 60).map { i =>
        val label = if (i % 20 == 5) "target" else s"row-$i"
        JsObject("label" -> JsString(label))
      }
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, rows, explicitRootId = None))

      val filter = java.net.URLEncoder.encode("""{"quick":"target"}""", "UTF-8")
      Get(s"/outputs/${output.id.value}/rows?filter=$filter&limit=50") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(3)
        val hasMore = paged.fields("offset").convertTo[Int] + paged.fields("limit").convertTo[Int] < paged.fields("total").convertTo[Int]
        hasMore shouldBe false
        paged.fields("items").convertTo[Vector[JsObject]].map(_.fields("label")) shouldBe Vector.fill(3)(JsString("target"))
      }
    }
  }

  // HEL-1188 task 7.1 -- the required RED-FIRST test (Iron Law: systematic-debugging.md). Run
  // against the pre-implementation codebase (no `ops` support at all), this fails: `parseFilterParam`
  // silently ignores the unrecognized `ops` key (spray-json tolerates unknown object fields), so
  // `filter` resolves as if only `quick`/`columns` were given (both empty here) -- i.e. NO filter at
  // all. The route then returns the RAW, unfiltered Output (`total` = 60, `items` = the first `limit`
  // rows by `row_index`, most of which violate the requested range/in-list predicate). Captured RED
  // output (this exact test, run via `sbt "testOnly *OutputRoutesSpec -- -z \"task 7.1\""` on the
  // pre-fix tree): `total` was `60` (expected the filtered count) and `items` included out-of-range
  // dates/regions -- both assertions failed. GREEN after implementing `ops` end-to-end below.
  "GET /outputs/:id/rows ops[] range + in-list filter (HEL-1188 task 7.1)" should {
    "narrows the WHOLE Output on a date-range AND an in-list column together, not just the fetched page" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "ops-filter-out", OutputKind.Table,
        schema = Vector(SchemaField("signup_date", "timestamp"), SchemaField("region", "string")),
        explicitRootId = None
      ))
      val fixtureRows = (0 until 60).map { i =>
        val date   = LocalDate.of(2026, 1, 1).plusDays(i.toLong).toString
        val region = i % 3 match { case 0 => "US"; case 1 => "EU"; case _ => "APAC" }
        (date, region)
      }
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, fixtureRows.map { case (date, region) =>
        JsObject("signup_date" -> JsString(date), "region" -> JsString(region))
      }, explicitRootId = None))

      val rangeStart = "2026-01-11"
      val rangeEnd   = "2026-02-19"
      val expectedMatches = fixtureRows.filter { case (date, region) =>
        date >= rangeStart && date <= rangeEnd && Set("US", "EU").contains(region)
      }
      expectedMatches should not be empty
      expectedMatches.size should be > 10 // enough to span beyond a small page

      val filterJson =
        s"""{"ops":[{"column":"signup_date","op":"gte","value":"$rangeStart"},
           |{"column":"signup_date","op":"lte","value":"$rangeEnd"},
           |{"column":"region","op":"in","values":["US","EU"]}]}""".stripMargin
      val filter = java.net.URLEncoder.encode(filterJson, "UTF-8")

      // Large enough limit to fetch every match in one page -- proves the WHOLE Output was
      // filtered, not merely the first page by row_index (most matches sit beyond row_index 20).
      Get(s"/outputs/${output.id.value}/rows?filter=$filter&limit=100") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(expectedMatches.size)
        val items = paged.fields("items").convertTo[Vector[JsObject]]
        items.map(i => (i.fields("signup_date").convertTo[String], i.fields("region").convertTo[String])) should contain theSameElementsAs expectedMatches
      }

      // A small page proves the SAME filtered total holds regardless of page size (pagination is
      // over the filtered set, not applied after truncating to one page).
      Get(s"/outputs/${output.id.value}/rows?filter=$filter&limit=5") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(expectedMatches.size)
        val items = paged.fields("items").convertTo[Vector[JsObject]]
        items should have size 5
        items.foreach { item =>
          val date   = item.fields("signup_date").convertTo[String]
          val region = item.fields("region").convertTo[String]
          (date >= rangeStart && date <= rangeEnd && Set("US", "EU").contains(region)) shouldBe true
        }
      }
    }
  }

  "OutputFilterCapability.distinctValueCountCapped / topDistinctValues (HEL-1188 task 1.2)" should {
    "distinctValueCountCapped counts distinct non-null values, and topDistinctValues orders by frequency" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("region" -> JsString("US")),
        JsObject("region" -> JsString("US")),
        JsObject("region" -> JsString("US")),
        JsObject("region" -> JsString("EU")),
        JsObject("region" -> JsString("EU")),
        JsObject("region" -> JsString("APAC")),
        JsObject("region" -> JsNull) // NULLs are excluded from both the count and the values read
      ), explicitRootId = None))

      val count = await(nodeSnapshotRepo.distinctValueCountCapped(pipelineId.value, None, None, "region", capPlusOne = 51))
      count shouldBe 3

      val top = await(nodeSnapshotRepo.topDistinctValues(pipelineId.value, None, None, "region", cap = 50))
      top shouldBe Vector(("US", 3), ("EU", 2), ("APAC", 1))
    }

    "distinctValueCountCapped is capped at capPlusOne even when more distinct values exist (D2's own corrected cost model: the CAP is on the count returned, not the scan)" in {
      val pipelineId = newSharedPipeline()
      val rows = (0 until 10).map(i => JsObject("v" -> JsString(s"val-$i")))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, rows, explicitRootId = None))
      val count = await(nodeSnapshotRepo.distinctValueCountCapped(pipelineId.value, None, None, "v", capPlusOne = 5))
      count shouldBe 5
    }
  }

  "NodeSnapshotRepository ops[] filter fragments (HEL-1188 task 2.3)" should {
    "a gte+lte pair on the same column expresses a range" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, (1 to 10).map(i => JsObject("amount" -> JsNumber(i))), explicitRootId = None))
      val filterSpec = NodeSnapshotRepository.FilterSpec(None, Vector.empty, Map.empty, ops = Vector(
        NodeSnapshotRepository.OpSpec.Gte("amount", NodeSnapshotRepository.SortCast.AsNumeric, "3"),
        NodeSnapshotRepository.OpSpec.Lte("amount", NodeSnapshotRepository.SortCast.AsNumeric, "7")
      ))
      val result = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 20), explicitRootId = None, filter = Some(filterSpec)))
      result.total shouldBe 5
      result.items.map(_.fields("amount").convertTo[Int]) shouldBe Vector(3, 4, 5, 6, 7)
    }

    "in matches a numeric column via the cast form, not text comparison (\"1000\" matches a stored 1000.0-equivalent value)" in {
      val pipelineId = newSharedPipeline()
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(BigDecimal("1000.0"))),
        JsObject("amount" -> JsNumber(2000))
      ), explicitRootId = None))
      val filterSpec = NodeSnapshotRepository.FilterSpec(None, Vector.empty, Map.empty, ops = Vector(
        NodeSnapshotRepository.OpSpec.In("amount", NodeSnapshotRepository.SortCast.AsNumeric, Vector("1000"))
      ))
      val result = await(nodeSnapshotRepo.listRowsPaged(pipelineId.value, None, Page(0, 20), explicitRootId = None, filter = Some(filterSpec)))
      result.total shouldBe 1
    }
  }

  "OutputFilterCapability.buildContract / eqInEligibleColumn (HEL-1188 task 1.3)" should {
    def capabilityFixture(): Output = {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "capability-out", OutputKind.Table,
        schema = Vector(
          SchemaField("region", "string"),
          SchemaField("notes", "string"),
          SchemaField("body", "string-body")
        ),
        explicitRootId = None
      ))
      val rows = (0 until 60).map { i =>
        JsObject(
          "region" -> JsString(if (i % 3 == 0) "US" else if (i % 3 == 1) "EU" else "APAC"),
          "notes"  -> JsString(s"note-$i"), // 60 distinct values -- over the 50 cardinality cap
          "body"   -> JsString("ignored")
        )
      }
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, rows, explicitRootId = None))
      output
    }

    "grants eq/in for a low-cardinality column, withholds it for a high-cardinality column of the SAME declared type, and omits Content-category columns entirely" in {
      val output = capabilityFixture()
      val contract = await(OutputFilterCapability.buildContract(output, nodeSnapshotRepo))
      val byColumn = contract.columns.map(c => c.column -> c.operators).toMap

      byColumn("region") shouldBe Set(OutputFilterCapability.Operator.Contains, OutputFilterCapability.Operator.Eq, OutputFilterCapability.Operator.In)
      byColumn("notes") shouldBe Set(OutputFilterCapability.Operator.Contains)
      byColumn.keySet should not contain "body"
    }

    "eqInEligibleColumn: Right for the low-cardinality column, Left for high-cardinality/Content/absent columns" in {
      val output = capabilityFixture()
      await(OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, "region")) shouldBe Right(())
      await(OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, "notes")) shouldBe a[Left[_, _]]
      await(OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, "body")) shouldBe a[Left[_, _]]
      await(OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, "nonexistent")) shouldBe a[Left[_, _]]
    }
  }

  "GET /outputs/:id/filter-capabilities (HEL-1188 task 3.1)" should {
    "reports operators derived from the Output's own schema+data, 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "fc-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer"), SchemaField("region", "string"), SchemaField("notes", "string-body")),
        explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(1), "region" -> JsString("US"), "notes" -> JsString("x")),
        JsObject("amount" -> JsNumber(2), "region" -> JsString("EU"), "notes" -> JsString("y"))
      ), explicitRootId = None))

      Get(s"/outputs/${output.id.value}/filter-capabilities") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val columns = responseAs[JsObject].fields("columns").convertTo[Vector[JsObject]]
        val byName = columns.map(c => c.fields("column").convertTo[String] -> c.fields("operators").convertTo[Vector[String]]).toMap
        byName("amount") shouldBe Vector("contains", "gte", "lte", "eq", "in")
        byName("region") shouldBe Vector("contains", "eq", "in")
        byName.keySet should not contain "notes"
      }
      Get(s"/outputs/${output.id.value}/filter-capabilities") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "lists each column's controlKinds from OutputControlEligibility.kindsFor (date-range only on a timestamp column)" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "fc-kinds-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer"), SchemaField("created_at", "timestamp"), SchemaField("region", "string")),
        explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(1), "created_at" -> JsString("2026-01-01T00:00:00Z"), "region" -> JsString("US")),
        JsObject("amount" -> JsNumber(2), "created_at" -> JsString("2026-01-02T00:00:00Z"), "region" -> JsString("EU"))
      ), explicitRootId = None))

      Get(s"/outputs/${output.id.value}/filter-capabilities") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val columns = responseAs[JsObject].fields("columns").convertTo[Vector[JsObject]]
        val kinds = columns.map(c => c.fields("column").convertTo[String] -> c.fields("controlKinds").convertTo[Vector[String]]).toMap
        kinds("created_at") should contain("date-range")
        kinds("amount") should contain("numeric-range")
        kinds("amount") should not contain "date-range"
        kinds("region") shouldBe Vector("dropdown", "text")
      }
    }
  }

  "GET /outputs/:id/distinct-values (HEL-1188 tasks 3.2/7.3)" should {
    "returns capped frequency-ordered values for an eligible column, 400 for an ineligible one, 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "dv-out", OutputKind.Table,
        schema = Vector(SchemaField("region", "string"), SchemaField("notes", "string")),
        explicitRootId = None
      ))
      val regionRows = Seq("US", "US", "US", "EU", "APAC").map(r => JsObject("region" -> JsString(r), "notes" -> JsString(UUID.randomUUID().toString)))
      // Pad with enough distinct `notes` values to push it over the eq/in cardinality cap, while
      // keeping every one of these rows' `region` at "US" (so `region`'s own cardinality stays low).
      val extraNotes = (0 until 55).map(i => JsObject("region" -> JsString("US"), "notes" -> JsString(s"note-$i")))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, regionRows ++ extraNotes, explicitRootId = None))

      Get(s"/outputs/${output.id.value}/distinct-values?column=region") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("column") shouldBe JsString("region")
        val values = paged.fields("values").convertTo[Vector[JsObject]]
        values should have size 3
        // Frequency-descending: US (3 + 55 = 58) strictly outranks EU/APAC (1 each) -- their
        // relative order between themselves is not asserted (a legitimate tie, not part of the AC).
        values.head.fields("value") shouldBe JsString("US")
        values.head.fields("count") shouldBe JsNumber(58)
        values.map(_.fields("value").convertTo[String]).toSet shouldBe Set("US", "EU", "APAC")
      }
      Get(s"/outputs/${output.id.value}/distinct-values?column=notes") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("notes")
      }
      Get(s"/outputs/${output.id.value}/distinct-values?column=region") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // HEL-1188 task 7.2 -- both directions, per column x per op, against a real seeded Output. The
  // required MUTATION PROOF (verify step): temporarily changed `OutputFilterCapability.buildContract`'s
  // `cardinalityEligible(distinctCount)` call to `cardinalityEligible(distinctCount, cap = 10)` --
  // a divergent bound applied ONLY at the contract-build call site, leaving `eqInEligibleColumn`
  // (the rows endpoint's own shared call) at the real `MaxDropdownCardinality = 50`. Re-ran this
  // exact test: it went RED -- `column=region op=eq listed=false` (region's 20 distinct values
  // exceed the mutated cap of 10) while the (unmutated) rows endpoint still returned `200 OK` for
  // that same request (20 <= the real 50), so the `listed=false => expect BadRequest` branch failed
  // against the actual `200`. Reverted immediately after -- re-ran and confirmed GREEN again. See
  // the executor's handoff for the exact `sbt testOnly` transcript of both runs.
  "Capability contract <-> rows-endpoint parity, both directions (HEL-1188 task 7.2)" should {
    "every operator the contract lists for a column is accepted by /rows; every operator not listed is rejected" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "drift-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer"), SchemaField("region", "string"), SchemaField("notes", "string")),
        explicitRootId = None
      ))
      // amount: 3 distinct values -> eq/in eligible, plus gte/lte/contains (numeric).
      // region: 20 distinct values -> eq/in eligible (under the 50 cap); contains only otherwise (string, no gte/lte).
      // notes: 60 distinct values -> NOT eq/in eligible; contains only.
      val rows = (0 until 60).map { i =>
        JsObject(
          "amount" -> JsNumber(i % 3),
          "region" -> JsString(s"r${i % 20}"),
          "notes"  -> JsString(s"n-$i")
        )
      }
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, rows, explicitRootId = None))

      val contract = await(outputService.filterCapabilities(output.id, owner)).getOrElse(fail("expected Right"))
      val byColumn = contract.columns.map(c => c.column -> c.operators).toMap

      def opsFilterFor(column: String, op: String): String =
        if (op == "in") s"""{"ops":[{"column":"$column","op":"in","values":["placeholder"]}]}"""
        else s"""{"ops":[{"column":"$column","op":"$op","value":"placeholder"}]}"""

      // `contains` uses the pre-existing `columns` shape, not `ops` -- out of scope for this matrix.
      val allOps = Vector("gte", "lte", "eq", "in")
      for {
        column <- Vector("amount", "region", "notes")
        opName <- allOps
      } {
        val op     = OutputFilterCapability.Operator.fromString(opName).get
        val listed = byColumn.getOrElse(column, Set.empty).contains(op)
        val filter = java.net.URLEncoder.encode(opsFilterFor(column, opName), "UTF-8")
        Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
          withClue(s"column=$column op=$opName listed=$listed status=$status ") {
            if (listed) status shouldBe StatusCodes.OK
            else status shouldBe StatusCodes.BadRequest
          }
        }
      }
    }
  }

  "GET /outputs/:id/rows ops[] hostile input (HEL-1188 task 7.4)" should {
    "a hostile column name in ops[].column is rejected as 400 before ever reaching SQL" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "hostile-ops-col-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1))), explicitRootId = None))
      val hostileColumn = "'; DROP TABLE node_snapshots; --"
      val filterJson    = s"""{"ops":[{"column":${JsString(hostileColumn).compactPrint},"op":"gte","value":"1"}]}"""
      val filter        = java.net.URLEncoder.encode(filterJson, "UTF-8")

      Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      val stillThere = await(nodeSnapshotRepo.listRows(pipelineId.value, None, explicitRootId = None))
      stillThere should have size 1
    }

    "a hostile column name in distinct-values' column param is rejected as 400, no SQL error, no data leakage" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "hostile-dv-col-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1))), explicitRootId = None))
      val hostile = java.net.URLEncoder.encode("'; DROP TABLE node_snapshots; --", "UTF-8")

      Get(s"/outputs/${output.id.value}/distinct-values?column=$hostile") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      val stillThere = await(nodeSnapshotRepo.listRows(pipelineId.value, None, explicitRootId = None))
      stillThere should have size 1
    }

    // MUTATION PROOF (verify step): temporarily changed `opValueCastExpr`'s `AsNumeric` case from
    // the bound `sql"safe_numeric($value)"` to the raw-spliced `sql"safe_numeric(#$value)"` (Slick's
    // `#$x` -- literal, unescaped SQL text, vs. `$x`'s bind parameter) -- exactly the "reintroduces a
    // one-bad-row-500 / injection surface" shape design.md D3 warns against. Re-ran the two tests
    // below: both went RED -- the hostile value's embedded `'` unbalanced the raw SQL text, and the
    // request failed with a 500 (`PSQLException: syntax error`) instead of the expected `200 OK`
    // zero/partial-match response. Reverted immediately after -- re-ran and confirmed GREEN again.
    // See the executor's handoff for the exact `sbt testOnly` transcript of both runs.
    "a hostile value in ops[].value never alters SQL -- degrades to a no-match 200, table intact" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "hostile-ops-val-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1)), JsObject("amount" -> JsNumber(2))), explicitRootId = None))
      val hostileValue = "'; DROP TABLE node_snapshots; --"
      val filterJson    = s"""{"ops":[{"column":"amount","op":"eq","value":${JsString(hostileValue).compactPrint}}]}"""
      val filter        = java.net.URLEncoder.encode(filterJson, "UTF-8")

      Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("total") shouldBe JsNumber(0)
      }
      val stillThere = await(nodeSnapshotRepo.listRows(pipelineId.value, None, explicitRootId = None))
      stillThere should have size 2
    }

    "a hostile element inside ops[].values never alters SQL -- the hostile element matches nothing, valid elements are unaffected" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "hostile-ops-values-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1)), JsObject("amount" -> JsNumber(2))), explicitRootId = None))
      val hostileValue = "'; DROP TABLE node_snapshots; --"
      val filterJson    = s"""{"ops":[{"column":"amount","op":"in","values":[${JsString(hostileValue).compactPrint},"1"]}]}"""
      val filter        = java.net.URLEncoder.encode(filterJson, "UTF-8")

      Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(1)
        paged.fields("items").convertTo[Vector[JsObject]].map(_.fields("amount")) shouldBe Vector(JsNumber(1))
      }
      val stillThere = await(nodeSnapshotRepo.listRows(pipelineId.value, None, explicitRootId = None))
      stillThere should have size 2
    }
  }

  "GET /outputs/:id/rows ops[] malformed-value handling (HEL-1188 task 7.5)" should {
    "a malformed eq value returns 200 with zero matches for that clause, never 500" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "malformed-val-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1)), JsObject("amount" -> JsNumber(2))), explicitRootId = None))
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"amount","op":"eq","value":"not-a-number"}]}""", "UTF-8")

      Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("total") shouldBe JsNumber(0)
      }
    }

    "a malformed element inside an in-list matches no row, while the other valid elements are unaffected" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "malformed-in-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(
        JsObject("amount" -> JsNumber(1)),
        JsObject("amount" -> JsNumber(2)),
        JsObject("amount" -> JsNumber(3))
      ), explicitRootId = None))
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"amount","op":"in","values":["1","not-a-number","3"]}]}""", "UTF-8")

      Get(s"/outputs/${output.id.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        paged.fields("total") shouldBe JsNumber(2)
        paged.fields("items").convertTo[Vector[JsObject]].map(_.fields("amount").convertTo[Int]) should contain theSameElementsAs Vector(1, 3)
      }
    }
  }

  "GET /outputs/:id/rows ops[] shape + type validation (HEL-1188 tasks 2.1/2.2)" should {
    def seededOutput(): OutputId = {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "ops-shape-out", OutputKind.Table,
        schema = Vector(SchemaField("amount", "integer"), SchemaField("label", "string")), explicitRootId = None
      ))
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("amount" -> JsNumber(1), "label" -> JsString("a"))), explicitRootId = None))
      output.id
    }

    "400s an unrecognized op" in {
      val outputId = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"amount","op":"bogus","value":"1"}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "400s eq missing a value" in {
      val outputId = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"amount","op":"eq"}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "400s in with an empty values array" in {
      val outputId = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"amount","op":"in","values":[]}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "400s in with more than 100 values, naming the column" in {
      val outputId = seededOutput()
      val values = (1 to 101).map(i => s""""$i"""").mkString(",")
      val filter = java.net.URLEncoder.encode(s"""{"ops":[{"column":"amount","op":"in","values":[$values]}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("amount")
      }
    }

    "400s a duplicate column+op pair, naming it as ambiguous" in {
      val outputId = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"amount","op":"gte","value":"1"},{"column":"amount","op":"gte","value":"2"}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "400s gte on a string column, naming column+op" in {
      val outputId = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"label","op":"gte","value":"a"}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("label")
      }
    }

    "400s eq/in on a column absent from schema, naming it" in {
      val outputId = seededOutput()
      val filter = java.net.URLEncoder.encode("""{"ops":[{"column":"bogus","op":"eq","value":"1"}]}""", "UTF-8")
      Get(s"/outputs/${outputId.value}/rows?filter=$filter") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("bogus")
      }
    }
  }

  "GET /outputs (lean paginated list, HEL-906 cycle 7 task 2.6)" should {
    "return only the caller's OWN outputs, paginated, in an OutputsResponse-shaped page" in {
      val pipelineId = newSharedPipeline()
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "list-out-1", OutputKind.Table, explicitRootId = None))
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "list-out-2", OutputKind.Table, explicitRootId = None))
      // Owned by grantee, NOT owner -- must not appear in owner's own list (owner-scoped, not
      // sharing-aware, unlike GET /pipelines/:id/outputs).
      await(outputRepo.insertInternal(pipelineId, None, grantee.id, "grantee-owned-out", OutputKind.Table, explicitRootId = None))

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
      (1 to 3).foreach(i => await(outputRepo.insertInternal(pipelineId, None, owner.id, s"page-out-$i", OutputKind.Table, explicitRootId = None)))

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

    // HEL-946 Bug B: this list feeds the Output picker -- it used to
    // hardcode `config: {}` for every item via `outputResponseFrom`'s
    // defaulting single-arg overload. Batched alongside panelCount, not an
    // additional N+1.
    "returns each Output's real persisted config, batched (HEL-946)" in {
      val pipelineId = newSharedPipeline()
      val config = JsObject("legend" -> JsObject("show" -> JsBoolean(true)))
      val out = await(outputRepo.insertInternal(pipelineId, None, owner.id, "configured-out", OutputKind.Chart, config, explicitRootId = None))

      Get("/outputs") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[OutputResponse]]
        items.find(_.id == out.id.value).map(_.config) shouldBe Some(config)
      }
    }

    // HEL-909 CR2 (evaluation-2.md finding 2): the list response carries each
    // Output's panel-placement count directly, so the Output picker doesn't
    // have to fetch `GET /api/outputs/:id/panels` per card (an N+1 that
    // self-rate-limited on a realistic Output count).
    "carries each Output's panelCount, batched, without an N+1 per-Output fetch" in {
      val pipelineId = newSharedPipeline()
      val boundOutput   = await(outputRepo.insertInternal(pipelineId, None, owner.id, "bound-out", OutputKind.Table, explicitRootId = None))
      val unboundOutput = await(outputRepo.insertInternal(pipelineId, None, owner.id, "unbound-out", OutputKind.Table, explicitRootId = None))
      val (dashboard, _) = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("count-dash")), owner))
      val config = JsObject("outputId" -> JsString(boundOutput.id.value))
      await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), None, Some("output"), Some(config)), owner))
      await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), None, Some("output"), Some(config)), owner))

      Get("/outputs") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val paged = responseAs[JsObject]
        val items = paged.fields("items").convertTo[Vector[OutputResponse]]
        items.find(_.name == "bound-out").flatMap(_.panelCount) shouldBe Some(2)
        items.find(_.name == "unbound-out").flatMap(_.panelCount) shouldBe Some(0)
      }
    }
  }

  "POST /pipelines/:id/preview?outputId= (single-Output arm)" should {
    "200 for the owner and the editor grantee (per-Output dry run), 404 for an unrelated caller" in {
      val pipelineId = newSharedPipeline()
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "preview-out", OutputKind.Table, explicitRootId = None))

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
      val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "preview-unchanged-out", OutputKind.Table, explicitRootId = None))

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
      val outputA = await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-out-a", OutputKind.Table, explicitRootId = None))
      val outputB = await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-out-b", OutputKind.Table, explicitRootId = None))

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
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-unchanged-out-1", OutputKind.Table, explicitRootId = None))
      await(outputRepo.insertInternal(pipelineId, None, owner.id, "all-unchanged-out-2", OutputKind.Table, explicitRootId = None))

      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }

      val pipelineAfter = await(pipelineRepo.findByIdInternal(pipelineId)).get
      pipelineAfter.lastRunStatus shouldBe None
      pipelineAfter.lastRunAt shouldBe None
    }
  }

  /** Raw INSERT into `data_sources` with an actual queryable `static` config -- mirrors
   *  `PipelineRunServiceSpec.seedDsWithData`'s pattern. Needed because `newSharedPipeline`'s
   *  fixture `DatasetSource`s carry no rows at all (fine for the status-code/shape-only preview
   *  tests above, useless for asserting WHICH root's rows a preview actually returns). */
  private def seedStaticSourceWithRows(name: String, value: String): DataSourceId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val config = s"""{"columns":[{"name":"v","type":"string"}],"rows":[["$value"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
        VALUES ($dsId, $name, 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, config)
    )))
    DataSourceId(dsId)
  }

  /** A two-root pipeline, both roots bound to a REAL, content-distinguishable `static`
   *  DataSource (`seedStaticSourceWithRows`) -- root 0's rows are `"root0-row"`, root 1's are
   *  `"root1-row"`. Returns `(pipelineId, root0Id, root1Id)`. */
  private def newTwoRootPipelineWithDistinctContent(): (PipelineId, PipelineRootId, PipelineRootId) = {
    val src0 = seedStaticSourceWithRows("src0", "root0-row")
    val pipeline = await(pipelineRepo.create("multi-root-preview", Vector(src0), owner)).getOrElse(
      throw new IllegalStateException("newTwoRootPipelineWithDistinctContent fixture: pipeline create failed")
    )
    val pipelineId = PipelineId(pipeline.id)
    val root0Id = await(pipelineRootRepo.list(pipelineId, owner)).head.id
    val src1 = seedStaticSourceWithRows("src1", "root1-row")
    val root1 = await(pipelineRootRepo.add(pipelineId, src1, owner))
    (pipelineId, root0Id, root1.id)
  }

  "POST /pipelines/:id/outputs (multi-root ambiguity, evaluation-1.md cycle 2, Priority 2 Site A)" should {
    "400, naming the root count, when a create names NEITHER nodeStepId NOR rootId on a two-root pipeline" in {
      val (pipelineId, _, _) = newTwoRootPipelineWithDistinctContent()
      Post(s"/pipelines/${pipelineId.value}/outputs", CreateOutputRequest(None, "table", "Ambiguous Output", None)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("2 roots")
      }
    }

    "lands on the NAMED root (not root 0) when rootId is given explicitly on a two-root pipeline" in {
      val (pipelineId, root0Id, root1Id) = newTwoRootPipelineWithDistinctContent()
      Post(
        s"/pipelines/${pipelineId.value}/outputs",
        CreateOutputRequest(None, "table", "Root1 Output", None, rootId = Some(root1Id.value))
      ) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
      val persisted = await(outputRepo.listByPipelineInternal(pipelineId)).find(_.name == "Root1 Output").get
      persisted.node.rootId shouldBe Some(root1Id)
      persisted.node.rootId should not be Some(root0Id)
    }

    // MUTATION PROOF: reverting `OutputService.requireUnambiguousRootWhenNeither` (restoring the
    // fall-through to `resolveExplicitRootId`'s `None` branch unconditionally) must turn the
    // first test above red -- a 201 with the Output silently bound to root 0, not a 400.
  }

  "POST /pipelines/:id/preview (multi-root, evaluation-1.md cycle 2, Priority 2 Site B)" should {
    "returns the SECOND root's rows for an Output bound to root 1, not root 0's (single-Output arm)" in {
      val (pipelineId, _, root1Id) = newTwoRootPipelineWithDistinctContent()
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "root1-output", OutputKind.Table, explicitRootId = Some(root1Id)
      ))

      Post(s"/pipelines/${pipelineId.value}/preview?outputId=${output.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val entry = responseAs[PipelinePreviewResponse].outputs.head
        entry.preview.rows.map(_.fields("v")) shouldBe Vector(JsString("root1-row"))
      }
      // MUTATION PROOF: reverting `PipelineRunService.previewAtNode`'s `selectedRoot` resolution
      // (restoring the unconditional `roots.head`) must turn THIS test red -- it would then
      // assert `"root0-row"` and fail against the real `"root1-row"` response, exactly the
      // preview/persisted-snapshot disagreement this fix closes (the persisted-rows path was
      // already fixed by 5.8a's `OutputService.scala` `explicitRootId` threading, prior to this
      // cycle; not re-asserted here since `triggerBackfill`'s materialization is fire-and-forget
      // and asserting its completion timing would be a flaky, unrelated test).
    }

    "returns the SECOND root's rows for an Output bound to root 1, not root 0's (all-Outputs arm)" in {
      val (pipelineId, _, root1Id) = newTwoRootPipelineWithDistinctContent()
      val outputRoot0 = await(outputRepo.insertInternal(pipelineId, None, owner.id, "root0-output", OutputKind.Table, explicitRootId = None))
      val outputRoot1 = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "root1-output-2", OutputKind.Table, explicitRootId = Some(root1Id)
      ))

      Post(s"/pipelines/${pipelineId.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val byId = responseAs[PipelinePreviewResponse].outputs.map(e => e.outputId -> e).toMap
        byId(outputRoot0.id.value).preview.rows.map(_.fields("v")) shouldBe Vector(JsString("root0-row"))
        byId(outputRoot1.id.value).preview.rows.map(_.fields("v")) shouldBe Vector(JsString("root1-row"))
      }
    }
  }

  /** A bare `assert` step on `pipelineId`, no parent (trunk root) -- returns its `PipelineStepId`. */
  private def pipelineStepRepoFor(pipelineId: PipelineId): Future[PipelineStepId] = {
    import com.helio.domain.AssertConfig
    pipelineStepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty), explicitRootId = None).map(_.id)
  }

  /** Seeds one persisted (non-dry) run with a single error-severity assertion on `stepId`,
   *  `passing` controlling whether it's a real regression guard (both branches exercised). */
  private def seedRunWithAssertions(pipelineId: PipelineId, stepId: PipelineStepId, passing: Boolean): Unit = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    await(pipelineRunRepo.insertRunInternal(runId, pipelineId, Instant.now()))
    await(pipelineRunRepo.updateRunTerminalInternal(runId, "succeeded", Instant.now(), Some(1), errorLog = None, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson)))
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
    await(pipelineRunRepo.insertDryRunInternal(runId, pipelineId, Instant.now(), rowCount = 1, truncatedReadsJson = PipelineRunService.EmptyTruncationJson))
    await(pipelineRunRepo.insertAssertions(runId, Seq(
      AssertionResult(stepId.value, "notNull", Some("amount"), "error", passed = passing, observed = None, message = None)
    )))
  }
}
