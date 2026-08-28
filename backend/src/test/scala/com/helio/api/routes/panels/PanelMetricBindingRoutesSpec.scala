package com.helio.api.routes.panels

import com.helio.api.http.{AccessCheckerImpl, AclDirective, ResourceTypeRegistry}
import com.helio.api.routes.dashboards.PublicDashboardRoutes
import com.helio.api.routes.metrics.MetricRoutes
import com.helio.api.routes.panels.PanelRoutes
import com.helio.services.metrics.MetricService
import com.helio.services.panels.PanelService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.http.{ResourceType => AclResourceType}
import com.helio.api._
import com.helio.domain.model._
import com.helio.domain.panels.{MetricPanel, MetricPanelConfig}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Route-level coverage for HEL-500 (panel binding to a metric) tasks.md
 *  T.3/T.4 — a `MetricPanel`'s read response materializes the effective
 *  binding from a resolved `metricId` (with raw overrides winning), and a
 *  cross-user/deleted `metricId` clears on read rather than erroring.
 *  T.7 (fold-in, post-final-gate) additionally covers the single-panel
 *  `GET /api/panels/:id/query` path (`resolveSingleBinding`), which the
 *  batch `GET /dashboards/:id/panels` tests above don't exercise.
 *
 *  Mirrors `BoundPanelRoutesSpec`'s lightweight fixture shape: a single
 *  (non-RLS-split) `DbContext`, hand-wired repos/services, and routes
 *  constructed directly with an injected `AuthenticatedUser` (no session/
 *  CSRF layer) — this is a service-composition-level integration test, not
 *  an `ApiRoutesSpec`/auth-stack test. */
class PanelMetricBindingRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var ctx: DbContext                        = _
  private var dashboardRepo: DashboardRepository    = _
  private var panelRepo: PanelRepository            = _
  private var dataTypeRepo: DataTypeRepository      = _
  private var metricRepo: MetricRepository          = _
  private var pipelineRepo: PipelineRepository      = _
  private var dataSourceRepo: DataSourceRepository  = _
  private var permissionRepo: ResourcePermissionRepository = _

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

    dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    dataTypeRepo   = new DataTypeRepository(ctx)(routeEc)
    metricRepo     = new MetricRepository(ctx)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  private def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

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
             VALUES ($id, 'Metric Binding Test Dashboard', $ownerId, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', $ownerId::uuid)"""
    ))
    DashboardId(id)
  }

  private val revenueField = """[{"name":"revenue","displayName":"revenue","dataType":"integer","nullable":true}]"""

  private def pipelineOutputDataType(ownerId: UserId): DataType = {
    val now = Instant.now()
    DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "Revenue",
      fields    = Vector(DataField("revenue", "revenue", "integer", nullable = true)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = ownerId
    )
  }

  private def newMetric(ownerId: UserId, dataTypeId: DataTypeId, name: String = "Total Revenue"): MetricDefinition = {
    val now = Instant.now()
    MetricDefinition(
      id                = MetricId(UUID.randomUUID().toString),
      ownerId           = ownerId,
      dataTypeId        = dataTypeId,
      name              = name,
      description       = None,
      measureField      = "revenue",
      aggregation       = "sum",
      allowedDimensions = Vector.empty,
      format            = MetricFormat(unit = Some("$"), decimals = None, prefix = None, suffix = None),
      createdAt         = now,
      updatedAt         = now
    )
  }


  private def registry(): ResourceTypeRegistry =
    new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )

  private def panelServiceFor(): PanelService = {
    implicit val ec: ExecutionContext = routeEc
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry())
    new PanelService(panelRepo, dataTypeRepo, accessChecker, dashboardRepo, metricRepo)
  }

  private def panelRoutesFor(user: AuthenticatedUser): Route =
    new PanelRoutes(panelServiceFor(), user).routes

  private def publicDashboardRoutesFor(userOpt: Option[AuthenticatedUser]): Route = {
    implicit val ec: ExecutionContext = routeEc
    val aclDirective = new AclDirective(permissionRepo, registry())
    new PublicDashboardRoutes(panelRepo, panelServiceFor(), pipelineRepo, aclDirective, userOpt).routes
  }

  private def metricRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    new MetricRoutes(new MetricService(metricRepo, dataTypeRepo), user).routes
  }


  "GET /api/dashboards/:id/panels" should {

    "materialize a MetricPanel's effective binding from its resolved metricId" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get

      Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        panels should have size 1
        val config = panels.head.asJsObject.fields("config").asJsObject

        config.fields("metricId") shouldBe JsString(metric.id.value)
        config.fields("dataTypeId") shouldBe JsString(dt.id.value)
        config.fields("fieldMapping") shouldBe JsObject("value" -> JsString("revenue"))
        config.fields("aggregation") shouldBe JsObject("value" -> JsString("revenue"), "agg" -> JsString("sum"))
        config.fields("unit") shouldBe JsString("$")
      }
    }

    "let an explicit raw fieldMapping override the metric-derived value" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get

      Post(
        "/panels",
        json(
          s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric",
             |"config":{"metricId":"${metric.id.value}","fieldMapping":{"value":"profit"}}}""".stripMargin
        )
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        val config = panels.head.asJsObject.fields("config").asJsObject

        // Raw override wins — NOT the metric-derived {"value":"revenue"}.
        config.fields("fieldMapping") shouldBe JsObject("value" -> JsString("profit"))
      }
    }


    "clear metricId on read when it references another user's metric (no 500)" in {
      val dashId  = seedDashboard(userAId)
      val dtOwnedByA = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val dtOwnedByB = await(dataTypeRepo.insert(pipelineOutputDataType(userB.id), userB))
      val foreignMetric = await(metricRepo.insert(newMetric(userB.id, dtOwnedByB.id), userB)).toOption.get

      // Bypass create-time validation (which would reject a foreign metricId)
      // by inserting the panel directly via the repository — simulating a
      // stored cross-user metricId from ownership drift (design.md D3's
      // defense-in-depth scenario).
      val panel = MetricPanel(
        PanelId(UUID.randomUUID().toString),
        dashId,
        "Revenue",
        ResourceMeta(userAId, Instant.now(), Instant.now()),
        PanelAppearance.Default,
        userA.id,
        MetricPanelConfig(
          dataTypeId   = dtOwnedByA.id,
          fieldMapping = JsObject.empty,
          metricId     = Some(foreignMetric.id)
        )
      )
      await(panelRepo.insert(panel))

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        panels should have size 1
        val config = panels.head.asJsObject.fields("config").asJsObject

        config.fields.get("metricId") shouldBe None
        // The raw dataTypeId (owned by A) is left intact — only metricId clears.
        config.fields("dataTypeId") shouldBe JsString(dtOwnedByA.id.value)
      }
    }


    "surface config.metricDeprecated = true for a MetricPanel bound to a deprecated metric, even with a raw override" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get
      await(metricRepo.update(metric.copy(deprecated = true), userA))

      Post(
        "/panels",
        json(
          s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric",
             |"config":{"metricId":"${metric.id.value}","fieldMapping":{"value":"profit"}}}""".stripMargin
        )
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        val config = panels.head.asJsObject.fields("config").asJsObject

        config.fields("metricDeprecated") shouldBe JsBoolean(true)
        // Raw override still wins for fieldMapping — metricDeprecated is
        // independent of the raw-vs-materialized precedence (design.md D6).
        config.fields("fieldMapping") shouldBe JsObject("value" -> JsString("profit"))
      }
    }

    "surface config.metricDeprecated = false for a MetricPanel bound to an active metric" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get

      Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        val config = panels.head.asJsObject.fields("config").asJsObject

        config.fields("metricDeprecated") shouldBe JsBoolean(false)
      }
    }

    "surface config.metricDeprecated = true for a ChartPanel/TablePanel bound to a deprecated metric" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get
      await(metricRepo.update(metric.copy(deprecated = true), userA))

      Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Chart","type":"chart","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }
      Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Table","type":"table","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        panels should have size 2
        panels.foreach { panel =>
          val config = panel.asJsObject.fields("config").asJsObject
          config.fields("metricDeprecated") shouldBe JsBoolean(true)
          // Chart/table never materialize fieldMapping from the metric — the
          // deprecated flag is set independent of that scope (design.md D6).
          config.fields("fieldMapping") shouldBe JsObject.empty
        }
      }
    }


    "reflect a metric rename on every subsequent panel read with no PATCH /api/panels/:id call" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id, name = "Old Name"), userA)).toOption.get

      Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      // Rename via PATCH /api/metrics/:id — no PATCH /api/panels/:id call anywhere in this test.
      Patch(s"/metrics/${metric.id.value}", json("""{"name":"New Name"}""")) ~> metricRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        val config = panels.head.asJsObject.fields("config").asJsObject
        // The effective binding (still resolved from the renamed metric)
        // continues to read correctly — proving the panel needed no update.
        config.fields("dataTypeId") shouldBe JsString(dt.id.value)
        config.fields("fieldMapping") shouldBe JsObject("value" -> JsString("revenue"))
      }
    }

    "clear metricId on read after the referenced metric is deleted, panel stays intact" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get

      Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      // Delete the metric via DELETE /api/metrics/:id — panels.metric_id has
      // an ON DELETE SET NULL FK (V76), so the panel row survives unbound.
      Delete(s"/metrics/${metric.id.value}") ~> metricRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get(s"/dashboards/${dashId.value}/panels") ~> publicDashboardRoutesFor(Some(userA)) ~> check {
        status shouldBe StatusCodes.OK
        val body   = responseAs[JsObject]
        val panels = body.fields("items").asInstanceOf[JsArray].elements
        panels should have size 1
        val config = panels.head.asJsObject.fields("config").asJsObject
        config.fields.get("metricId") shouldBe None
      }
    }
  }

  // ── T.7 (fold-in, post-final-gate): GET /api/panels/:id/query single-panel
  // materialization path (resolveSingleBinding), previously verified live by
  // the final-gate skeptic but with zero automated coverage — see
  // skeptic-final-1.md and ticket.md's added AC. ──────────────────────────────

  "GET /api/panels/:id/query" should {

    "return selectedFields derived from the resolved metric's measureField for a metricId-only MetricPanel" in {
      val dashId = seedDashboard(userAId)
      val dt     = await(dataTypeRepo.insert(pipelineOutputDataType(userA.id), userA))
      val metric = await(metricRepo.insert(newMetric(userA.id, dt.id), userA)).toOption.get

      val panelId = Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Revenue","type":"metric","config":{"metricId":"${metric.id.value}"}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[JsObject].fields("id").asInstanceOf[JsString].value
      }

      Get(s"/panels/$panelId/query") ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val query = responseAs[JsObject]
        query.fields("selectedFields") shouldBe JsArray(JsString("revenue"))
      }
    }

    "still return 404 'Panel is not bound to a data type' for an unbound metric panel (negative control)" in {
      val dashId = seedDashboard(userAId)

      val panelId = Post(
        "/panels",
        json(s"""{"dashboardId":"${dashId.value}","title":"Unbound","type":"metric","config":{}}""")
      ) ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[JsObject].fields("id").asInstanceOf[JsString].value
      }

      Get(s"/panels/$panelId/query") ~> panelRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[JsObject].fields("message") shouldBe JsString("Panel is not bound to a data type")
      }
    }
  }
}
