package com.helio.api.routes.panels

import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.api.routes.panels.BoundPanelRoutes
import com.helio.api.routes.pipelines.PipelineRunRegistry
import com.helio.services.panels.{BoundPanelService, PanelService}
import com.helio.services.pipelines.{PipelineRunService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api._
import com.helio.domain.model._
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Route-layer coverage for `POST /api/panels/bound` (HEL-364) — the compound
 *  source -> pipeline -> run -> panel-bind op.
 *
 *  Mirrors `PipelineRunRoutesSpec`'s lightweight fixture shape: a single
 *  (non-RLS-split) `DbContext`, hand-wired repos/services, and
 *  `BoundPanelRoutes` constructed directly with an injected `AuthenticatedUser`
 *  (no session/CSRF layer) — this is a service-composition-level integration
 *  test, not an ApiRoutes/auth-stack test (that surface is already covered by
 *  `ApiRoutesSpec`'s 195 passing regression tests, which this change doesn't
 *  touch). */
class BoundPanelRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database                = _
  private var ctx: DbContext                          = _
  private var dashboardRepo: DashboardRepository      = _
  private var panelRepo: PanelRepository              = _
  private var dataSourceRepo: DataSourceRepository    = _
  private var dataTypeRepo: DataTypeRepository        = _
  private var dataTypeRowRepo: DataTypeRowRepository  = _
  private var metricRepo: MetricRepository            = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository        = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineRunRepo: PipelineRunRepository  = _

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
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(routeEc)

    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo        = new PanelRepository(ctx)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    dataTypeRepo     = new DataTypeRepository(ctx)(routeEc)
    dataTypeRowRepo  = new DataTypeRowRepository(ctx)(routeEc)
    metricRepo       = new MetricRepository(ctx)(routeEc)
    permissionRepo   = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    pipelineRunRepo  = new PipelineRunRepository(ctx)(routeEc)

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  private def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

  // ── DB seed helpers ─────────────────────────────────────────────────────────

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  private def seedDashboard(ownerId: String): DashboardId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Bound Panel Test Dashboard', $ownerId, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', $ownerId::uuid)"""
    ))
    DashboardId(id)
  }

  /** Seed a `static` DataSource + its companion DataType (source_id set — NOT
   *  panel-bindable directly, but a valid reuse target for `sourceDataSourceId`). */
  private def seedStaticSourceWithCompanion(ownerId: String, fieldsJson: String): (DataSourceId, DataTypeId) = {
    import PostgresProfile.api._
    val srcId = UUID.randomUUID().toString
    val dtId  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId, 'reused-source', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, $srcId, 'reused-source', $fieldsJson::jsonb, 1, $ownerId::uuid, now(), now())"""
    )))
    (DataSourceId(srcId), DataTypeId(dtId))
  }

  /** Seed a `rest_api` DataSource (empty config — `DataSourceConfigCodec.decodeRest`
   *  tolerates this, decoding to a placeholder `RestSource`) + its companion
   *  DataType — reused to deterministically trigger `PipelineRunService`'s
   *  "unsupported source type" 422 at the "run" stage, since REST/SQL sources
   *  are unsupported by `InProcessPipelineEngine`'s run path. */
  private def seedRestSourceWithCompanion(ownerId: String, fieldsJson: String): (DataSourceId, DataTypeId) = {
    import PostgresProfile.api._
    val srcId = UUID.randomUUID().toString
    val dtId  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId, 'rest-source', 'rest_api', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, $srcId, 'rest-source', $fieldsJson::jsonb, 1, $ownerId::uuid, now(), now())"""
    )))
    (DataSourceId(srcId), DataTypeId(dtId))
  }

  // ── Route fixture ─────────────────────────────────────────────────────────

  private val fileSystem = new LocalFileSystem(Paths.get("/"))

  private def boundPanelRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    // Only "dashboard" is exercised by BoundPanelService's own AccessChecker
    // call — the other four ApiRoutes registers (panel/data-source/data-type/
    // pipeline) aren't reached by this service.
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker      = new AccessCheckerImpl(permissionRepo, registry)
    val dataSourceService  = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
    val pipelineService    = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
    val pipelineRunService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo,
      dataTypeRowRepo, new PipelineRunCache(), new PipelineRunRegistry(), fileSystem
    )
    val panelService = new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
    val boundPanelService = new BoundPanelService(
      dataSourceService, pipelineService, pipelineRunService, panelService,
      dataSourceRepo, dataTypeRepo, dataTypeRowRepo, panelRepo, accessChecker
    )
    new BoundPanelRoutes(boundPanelService, user).routes
  }

  private val revenueField = """[{"name":"revenue","displayName":"revenue","dataType":"integer","nullable":true}]"""
  private val valueField   = """[{"name":"value","displayName":"value","dataType":"integer","nullable":true}]"""

  "POST /panels/bound" should {

    "create the source, pipeline, and panel in one call — happy path, rows present" in {
      val dashboardId = seedDashboard(userAId)
      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Quarterly Sales",
           |    "columns": [{"name":"region","type":"string"},{"name":"revenue","type":"integer"}],
           |    "rows": [["North",320],["South",210]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Sales Output", "steps": []},
           |  "panel": {"type": "metric", "title": "Total Revenue"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[BoundPanelResponse]
        resp.sourceId shouldNot be(empty)
        resp.pipelineId shouldNot be(empty)
        resp.dataTypeId shouldNot be(empty)
        resp.panel.config.asJsObject.fields("dataTypeId").convertTo[String] shouldBe resp.dataTypeId
        await(dataTypeRowRepo.listRows(resp.dataTypeId)).size shouldBe 2
      }
    }

    "reuse an existing sourceDataSourceId — no new DataSource created" in {
      val (existingSourceId, _) = seedStaticSourceWithCompanion(userAId, revenueField)
      val dashboardId            = seedDashboard(userAId)
      val countBefore            = await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "sourceDataSourceId": "${existingSourceId.value}",
           |  "pipeline": {"outputDataTypeName": "Reused Output", "steps": []},
           |  "panel": {"type": "metric", "title": "Reused Metric"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[BoundPanelResponse].sourceId shouldBe existingSourceId.value
      }
      await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total shouldBe countBefore
    }

    "reject an unsatisfiable chart binding with 400 — nothing created" in {
      val dashboardId = seedDashboard(userAId)
      val sourceCountBefore   = await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total
      val pipelineCountBefore = await(pipelineRepo.listSummaries(userA)).size

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Text Only",
           |    "columns": [{"name":"label","type":"string"}],
           |    "rows": [["a"]]
           |  },
           |  "pipeline": {"outputDataTypeName": "No Numeric", "steps": []},
           |  "panel": {"type": "chart", "title": "Bad Chart"},
           |  "fieldMapping": {"xAxis": "label", "yAxis": "label"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("chart")
      }
      await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total shouldBe sourceCountBefore
      await(pipelineRepo.listSummaries(userA)).size shouldBe pipelineCountBefore
    }

    "reject a non-data-bindable panel.type (markdown) with 400 — nothing created" in {
      val dashboardId = seedDashboard(userAId)
      val sourceCountBefore = await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Whatever",
           |    "columns": [{"name":"value","type":"integer"}],
           |    "rows": [[1]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Whatever Output", "steps": []},
           |  "panel": {"type": "markdown", "title": "Not bindable"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
        val msg = responseAs[String].toLowerCase
        msg should include("markdown")
        msg should include("/api/panels")
      }
      await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total shouldBe sourceCountBefore
    }

    "clean up the pipeline and the inline-created source on a steps-stage failure" in {
      val dashboardId         = seedDashboard(userAId)
      val sourceCountBefore   = await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total
      val pipelineCountBefore = await(pipelineRepo.listSummaries(userA)).size

      // Passes the gate (PipelineAnalyzeService.analyze's unknown-op branch is
      // a soft identity fallback, not a hard error — so the requested "value"
      // slot is still satisfied by the source's own "revenue" column), and
      // fails for real once pipelineService.addStep validates the step type
      // against PipelineStepKind.All.
      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "To Clean Up",
           |    "columns": [{"name":"revenue","type":"integer"}],
           |    "rows": [[5]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Cleanup Output", "steps": [{"type":"not-a-real-op","config":{}}]},
           |  "panel": {"type": "metric", "title": "Should Not Exist"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("[steps]")
      }
      await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total shouldBe sourceCountBefore
      await(pipelineRepo.listSummaries(userA)).size shouldBe pipelineCountBefore
    }

    "leave a reused sourceDataSourceId untouched on a steps-stage failure, but still clean up the pipeline" in {
      val (reusedSourceId, _) = seedStaticSourceWithCompanion(userAId, revenueField)
      val dashboardId          = seedDashboard(userAId)
      val pipelineCountBefore  = await(pipelineRepo.listSummaries(userA)).size

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "sourceDataSourceId": "${reusedSourceId.value}",
           |  "pipeline": {"outputDataTypeName": "Cleanup Output 2", "steps": [{"type":"not-a-real-op","config":{}}]},
           |  "panel": {"type": "metric", "title": "Should Not Exist"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("[steps]")
      }
      await(pipelineRepo.listSummaries(userA)).size shouldBe pipelineCountBefore
      await(dataSourceRepo.findByIdOwned(reusedSourceId, userA)) shouldBe defined
    }

    "clean up the pipeline on a run-stage failure (unsupported source type) — reused source untouched" in {
      val (restSourceId, _)  = seedRestSourceWithCompanion(userAId, valueField)
      val dashboardId         = seedDashboard(userAId)
      val pipelineCountBefore = await(pipelineRepo.listSummaries(userA)).size

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "sourceDataSourceId": "${restSourceId.value}",
           |  "pipeline": {"outputDataTypeName": "Rest Output", "steps": []},
           |  "panel": {"type": "metric", "title": "Rest Metric"},
           |  "fieldMapping": {"value": "value"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include("[run]")
      }
      await(pipelineRepo.listSummaries(userA)).size shouldBe pipelineCountBefore
      await(dataSourceRepo.findByIdOwned(restSourceId, userA)) shouldBe defined
    }

    "clean up the pipeline and the inline-created source on a run blocked by an error-severity assertion" in {
      val dashboardId         = seedDashboard(userAId)
      val sourceCountBefore   = await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total
      val pipelineCountBefore = await(pipelineRepo.listSummaries(userA)).size

      // HEL-570 (design.md Decision 8): the pipeline's own run succeeds (no
      // exception) but is BLOCKED by the assert step's error-severity
      // rowCountMax rule (2 rows > count: 1) — a brand-new first-run pipeline
      // has no prior-good snapshot, so BoundPanelService must treat this
      // identically to a run failure: same "run"-stage cleanup, no panel ever
      // bound to the never-populated output DataType.
      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Assert Blocked",
           |    "columns": [{"name":"revenue","type":"integer"}],
           |    "rows": [[5],[10]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Assert Blocked Output", "steps": [
           |    {"type":"assert","config":{"rules":[{"kind":"rowCountMax","params":{"count":1},"severity":"error"}]}}
           |  ]},
           |  "panel": {"type": "metric", "title": "Should Not Exist"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include("[run]")
      }
      await(dataSourceRepo.findAll(userA.id, Page(0, 200))).total shouldBe sourceCountBefore
      await(pipelineRepo.listSummaries(userA)).size shouldBe pipelineCountBefore
    }

    "reject a cross-tenant sourceDataSourceId with 404, not 403 — no resource created" in {
      val (otherSourceId, _) = seedStaticSourceWithCompanion(userBId, revenueField)
      val dashboardId          = seedDashboard(userAId)
      val pipelineCountBefore  = await(pipelineRepo.listSummaries(userA)).size

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "sourceDataSourceId": "${otherSourceId.value}",
           |  "pipeline": {"outputDataTypeName": "Hijack Output", "steps": []},
           |  "panel": {"type": "metric", "title": "Hijack"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      await(pipelineRepo.listSummaries(userA)).size shouldBe pipelineCountBefore
    }

    "return 201 with a bound, empty panel when the pipeline's steps legitimately produce zero rows" in {
      val dashboardId = seedDashboard(userAId)
      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Zero Rows",
           |    "columns": [{"name":"revenue","type":"integer"}],
           |    "rows": [[5],[10]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Zero Output", "steps": [{"type":"filter","config":
           |    {"combinator":"and","conditions":[{"field":"revenue","operator":">","value":"999999"}]}
           |  }]},
           |  "panel": {"type": "metric", "title": "Empty Metric"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[BoundPanelResponse]
        await(dataTypeRowRepo.listRows(resp.dataTypeId)) shouldBe empty
      }
    }

    "ignore a caller-supplied panel.config.dataTypeId — always binds to the freshly created pipeline output (V41 cannot be bypassed)" in {
      val (_, companionTypeId) = seedStaticSourceWithCompanion(userAId, revenueField)
      val dashboardId            = seedDashboard(userAId)

      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Legit Source",
           |    "columns": [{"name":"revenue","type":"integer"}],
           |    "rows": [[5]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Legit Output", "steps": []},
           |  "panel": {"type": "metric", "title": "Legit Metric", "config": {"dataTypeId": "${companionTypeId.value}"}},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[BoundPanelResponse]
        val boundTypeId = resp.panel.config.asJsObject.fields("dataTypeId").convertTo[String]
        boundTypeId shouldBe resp.dataTypeId
        boundTypeId should not be companionTypeId.value
      }
    }

    // HEL-412 (design.md Decision 3, boundary v): `BoundPanelService.projectSchema`
    // excludes a step definition carrying `enabled: false` from the gate's schema
    // projection — a `select` step that WOULD drop the numeric field, if it ran,
    // is treated as absent, so the metric binding still succeeds.
    "a disabled select step is excluded from the binding-gate schema projection" in {
      val dashboardId = seedDashboard(userAId)
      val body =
        s"""{
           |  "dashboardId": "${dashboardId.value}",
           |  "source": {
           |    "name": "Quarterly Sales 2",
           |    "columns": [{"name":"region","type":"string"},{"name":"revenue","type":"integer"}],
           |    "rows": [["North",320],["South",210]]
           |  },
           |  "pipeline": {"outputDataTypeName": "Disabled Select Output", "steps": [
           |    {"type":"select","config":{"fields":["region"]},"enabled":false}
           |  ]},
           |  "panel": {"type": "metric", "title": "Total Revenue"},
           |  "fieldMapping": {"value": "revenue"}
           |}""".stripMargin
      Post("/panels/bound", json(body)) ~> boundPanelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[BoundPanelResponse]
        // The disabled select step never ran during the real (non-dry) run
        // either -- revenue survives in the persisted output rows too.
        await(dataTypeRowRepo.listRows(resp.dataTypeId)).flatMap(_.fields.keys) should contain("revenue")
      }
    }
  }
}
