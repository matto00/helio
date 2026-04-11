package com.helio.api

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.adapter._
import akka.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import akka.http.scaladsl.server.Route
import akka.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{RestApiConfig, RestApiConnector}
import com.helio.infrastructure.{Database, DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository}
import spray.json.JsValue
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

class ApiRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dashboardRepo: DashboardRepository   = _
  private var panelRepo: PanelRepository           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var dataTypeRepo: DataTypeRepository     = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(
      embeddedPostgres.getPostgresDatabase,
      Some(10)
    )

    dashboardRepo  = new DashboardRepository(db)(typedSystem.executionContext)
    panelRepo      = new PanelRepository(db)(typedSystem.executionContext)
    dataSourceRepo = new DataSourceRepository(db)(typedSystem.executionContext)
    dataTypeRepo   = new DataTypeRepository(db)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE panels, dashboards, data_types, data_sources RESTART IDENTITY CASCADE"))
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    import scala.concurrent.Future
    def write(path: String, bytes: Array[Byte]): Future[Unit]  = Future.successful(())
    def read(path: String): Future[Array[Byte]]                = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                     = Future.successful(())
    def exists(path: String): Future[Boolean]                  = Future.successful(false)
    def list(prefix: String): Future[Seq[String]]              = Future.successful(Seq.empty)
  }

  private def stubConnector(response: Either[String, JsValue]): RestApiConnector =
    new RestApiConnector(Some(_ => scala.concurrent.Future.successful(response)))

  private def routes(connector: RestApiConnector = stubConnector(Left("no real HTTP in tests"))): Route =
    new ApiRoutes(dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, stubFileSystem, connector).routes

  private def assertResourceMeta(meta: ResourceMetaResponse): Unit = {
    meta.createdBy should not be empty
    meta.createdAt should not be empty
    meta.lastUpdated should not be empty
  }

  private def assertDashboardAppearance(appearance: DashboardAppearanceResponse): Unit = {
    appearance.background should not be empty
    appearance.gridBackground should not be empty
  }

  private def assertDashboardLayout(layout: DashboardLayoutResponse): Unit = {
    layout.lg should not be null
    layout.md should not be null
    layout.sm should not be null
    layout.xs should not be null
  }

  private def assertPanelAppearance(appearance: PanelAppearanceResponse): Unit = {
    appearance.background should not be empty
    appearance.color should not be empty
    appearance.transparency should be >= 0.0
    appearance.transparency should be <= 1.0
  }

  "ApiRoutes" should {

    "return health status" in {
      Get("/health") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[HealthResponse] shouldBe HealthResponse("ok")
      }
    }

    "return an empty dashboard collection by default" in {
      cleanDb()
      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DashboardsResponse] shouldBe DashboardsResponse(Vector.empty)
      }
    }

    "create a dashboard and return 201" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[DashboardResponse]
        response.name shouldBe "Operations"
        response.id should not be empty
        assertResourceMeta(response.meta)
        assertDashboardAppearance(response.appearance)
        response.layout shouldBe DashboardLayoutResponse(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
      }
    }

    "default a missing dashboard name" in {
      cleanDb()
      Post("/api/dashboards", CreateDashboardRequest(None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DashboardResponse].name shouldBe RequestValidation.DefaultDashboardName
      }
    }

    "return dashboard and panel data after seeding" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardsResponse]
        response.items should have size 1
        response.items.head.name shouldBe "Operations"
        assertResourceMeta(response.items.head.meta)
        assertDashboardAppearance(response.items.head.appearance)
        assertDashboardLayout(response.items.head.layout)
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelsResponse]
        response.items should have size 1
        response.items.head.dashboardId shouldBe dashboardId
        response.items.head.title shouldBe "CPU Usage"
        assertResourceMeta(response.items.head.meta)
        assertPanelAppearance(response.items.head.appearance)
      }
    }

    "persist dashboard data across repository reloads" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Persistent"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      // Re-query via repository directly to confirm DB persistence
      val found = await(dashboardRepo.findById(com.helio.domain.DashboardId(dashboardId)))
      found.isDefined shouldBe true
      found.get.name shouldBe "Persistent"
    }

    "create a panel and return 201" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Latency"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[PanelResponse]
        response.dashboardId shouldBe dashboardId
        response.title shouldBe "Latency"
        response.id should not be empty
        assertResourceMeta(response.meta)
        assertPanelAppearance(response.appearance)
      }
    }

    "return dashboards sorted by lastUpdated descending" in {
      cleanDb()

      Post("/api/dashboards", CreateDashboardRequest(Some("Alpha"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/dashboards", CreateDashboardRequest(Some("Beta"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get("/api/dashboards") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items      = responseAs[DashboardsResponse].items
        items should have size 2
        val timestamps = items.map(d => java.time.Instant.parse(d.meta.lastUpdated))
        timestamps shouldEqual timestamps.sortWith(_.isAfter(_))
      }
    }

    "return panels sorted by lastUpdated descending" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel A"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel B"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items      = responseAs[PanelsResponse].items
        items should have size 2
        val timestamps = items.map(p => java.time.Instant.parse(p.meta.lastUpdated))
        timestamps shouldEqual timestamps.sortWith(_.isAfter(_))
      }
    }

    "update dashboard appearance and refresh lastUpdated" in {
      cleanDb()
      var dashboardId  = ""
      var originalMeta = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        val r = responseAs[DashboardResponse]
        dashboardId  = r.id
        originalMeta = r.meta.lastUpdated
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = Some(DashboardAppearancePayload(Some("#1e293b"), Some("#0f172a"))),
          layout     = None
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.appearance.background shouldBe "#1e293b"
        response.appearance.gridBackground shouldBe "#0f172a"
        response.meta.lastUpdated should not be originalMeta
      }

      Get("/api/dashboards") ~> routes() ~> check {
        val items = responseAs[DashboardsResponse].items
        items.head.appearance.background shouldBe "#1e293b"
      }
    }

    "update dashboard layout and refresh lastUpdated" in {
      cleanDb()
      var dashboardId  = ""
      var originalMeta = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        val r = responseAs[DashboardResponse]
        dashboardId  = r.id
        originalMeta = r.meta.lastUpdated
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload("panel-a", x = 1, y = 2, w = 5, h = 6)),
            md = Vector(DashboardLayoutItemPayload("panel-a", x = 0, y = 1, w = 4, h = 5)),
            sm = Vector(DashboardLayoutItemPayload("panel-a", x = 0, y = 0, w = 3, h = 5)),
            xs = Vector(DashboardLayoutItemPayload("panel-a", x = 0, y = 0, w = 2, h = 5))
          ))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.layout.lg should contain only DashboardLayoutItemResponse("panel-a", 1, 2, 5, 6)
        response.meta.lastUpdated should not be originalMeta
      }

      Get("/api/dashboards") ~> routes() ~> check {
        val items = responseAs[DashboardsResponse].items
        items.head.layout.md should contain only DashboardLayoutItemResponse("panel-a", 0, 1, 4, 5)
      }
    }

    "update panel appearance and clamp transparency" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(4.0))), None, None, None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.appearance.background shouldBe "#0f172a"
        response.appearance.color shouldBe "#f8fafc"
        response.appearance.transparency shouldBe 1.0
      }
    }

    "reject appearance updates without appearance or layout payload" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(s"/api/dashboards/$dashboardId", UpdateDashboardRequest(None, None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("name, appearance, or layout is required")
      }
    }

    "default a missing panel title" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), None, None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe RequestValidation.DefaultPanelTitle
      }
    }

    "reject panel creation without dashboardId" in {
      Post("/api/panels", CreatePanelRequest(None, Some("Latency"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("dashboardId is required")
      }
    }

    "reject panel creation for a missing dashboard" in {
      Post("/api/panels", CreatePanelRequest(Some("missing-dashboard"), Some("Latency"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "reject malformed panel requests" in {
      Post(
        "/api/panels",
        HttpEntity(ContentTypes.`application/json`, """{"title":17}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject malformed dashboard create request with type mismatch" in {
      Post(
        "/api/dashboards",
        HttpEntity(ContentTypes.`application/json`, """{"name":42}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject malformed dashboard create request with invalid JSON" in {
      Post(
        "/api/dashboards",
        HttpEntity(ContentTypes.`application/json`, """{invalid}""")
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "delete a dashboard and return 204" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("ToDelete"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Delete(s"/api/dashboards/$dashboardId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get("/api/dashboards") ~> routes() ~> check {
        responseAs[DashboardsResponse].items shouldBe empty
      }
    }

    "cascade delete panels when dashboard is deleted" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("WithPanels"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Delete(s"/api/dashboards/$dashboardId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      val found = await(panelRepo.findById(com.helio.domain.PanelId(panelId)))
      found shouldBe None
    }

    "return 404 when deleting a non-existent dashboard" in {
      Delete("/api/dashboards/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "delete a panel and return 204" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Latency"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Delete(s"/api/panels/$panelId") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        responseAs[PanelsResponse].items shouldBe empty
      }
    }

    "return 404 when deleting a non-existent panel" in {
      Delete("/api/panels/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    "duplicate a panel and return 201 with copied title and appearance" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(0.5))), None, None, None)
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val dup = responseAs[PanelResponse]
        dup.id should not be panelId
        dup.dashboardId shouldBe dashboardId
        dup.title shouldBe "CPU Usage (copy)"
        dup.appearance.background shouldBe "#0f172a"
        dup.appearance.color shouldBe "#f8fafc"
        dup.appearance.transparency shouldBe 0.5
      }
    }

    "increment copy counter on subsequent duplications" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy)"
      }
      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy 2)"
      }
      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy 3)"
      }
    }

    "strip existing copy suffix before computing new copy title" in {
      cleanDb()
      var dashboardId = ""
      var copyId      = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      var sourceId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        sourceId = responseAs[PanelResponse].id
      }
      Post(s"/api/panels/$sourceId/duplicate") ~> routes() ~> check {
        copyId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$copyId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe "CPU Usage (copy 2)"
      }
    }

    "return 404 when duplicating a non-existent panel" in {
      Post("/api/panels/no-such-panel/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    "leave the source panel unchanged after duplication" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$panelId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        val panels = responseAs[PanelsResponse].items
        panels should have size 2
        val source = panels.find(_.id == panelId).get
        source.title shouldBe "CPU Usage"
      }
    }

    "rename a dashboard and return 200 with updated name" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Old Name"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(name = Some("New Name"), appearance = None, layout = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DashboardResponse].name shouldBe "New Name"
      }
    }

    "reject rename with blank name" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("My Dashboard"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(name = Some("   "), appearance = None, layout = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("name must not be blank")
      }
    }

    "return 404 when renaming a non-existent dashboard" in {
      Patch(
        "/api/dashboards/does-not-exist",
        UpdateDashboardRequest(name = Some("New Name"), appearance = None, layout = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "update panel title and return 200 with updated title" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Old Title"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(title = Some("New Title"), appearance = None, `type` = None, typeId = None, fieldMapping = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PanelResponse].title shouldBe "New Title"
      }
    }

    "reject panel title update with blank title" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(title = Some(""), appearance = None, `type` = None, typeId = None, fieldMapping = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("title must not be blank")
      }
    }

    "return 404 when updating title of a non-existent panel" in {
      Patch(
        "/api/panels/does-not-exist",
        UpdatePanelRequest(title = Some("New Title"), appearance = None, `type` = None, typeId = None, fieldMapping = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    // ── DataType CRUD ──────────────────────────────────────────────────────────

    "return an empty data type collection by default" in {
      cleanDb()
      Get("/api/types") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DataTypesResponse] shouldBe DataTypesResponse(Vector.empty)
      }
    }

    "return 404 for a non-existent data type" in {
      Get("/api/types/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }

    "update a data type name and fields and increment version" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "Original",
        fields    = Vector(DataField("col1", "Column 1", "string", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      await(dataTypeRepo.insert(dt))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name   = Some("Renamed"),
          fields = Some(Vector(DataFieldPayload("col1", "Column 1", "string", nullable = false), DataFieldPayload("col2", "Column 2", "integer", nullable = true)))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.name shouldBe "Renamed"
        response.fields should have size 2
        response.version shouldBe 2
      }
    }

    "return 404 when patching a non-existent data type" in {
      Patch(
        "/api/types/does-not-exist",
        UpdateDataTypeRequest(name = Some("X"), fields = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }

    "delete a data type and return 204" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "ToDelete",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      await(dataTypeRepo.insert(dt))

      Delete(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 when deleting a non-existent data type" in {
      Delete("/api/types/does-not-exist") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }

    "return 409 when deleting a data type bound to a panel" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Bound Panel"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "BoundType",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      await(dataTypeRepo.insert(dt))

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, typeId = Some(Some(dt.id.value)), fieldMapping = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Delete(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.Conflict
        responseAs[ErrorResponse] shouldBe ErrorResponse("Cannot delete DataType: one or more panels are bound to it")
      }
    }

    // ── DataSources ────────────────────────────────────────────────────────────

    "return an empty data sources collection by default" in {
      cleanDb()
      Get("/api/data-sources") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DataSourcesResponse] shouldBe DataSourcesResponse(Vector.empty)
      }
    }

    // ── Panel type binding ─────────────────────────────────────────────────────

    "bind a data type to a panel and return it in the response" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID
      import spray.json._

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Metric"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "MyType",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      await(dataTypeRepo.insert(dt))

      val mapping = """{"value":"col1"}""".parseJson
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, typeId = Some(Some(dt.id.value)), fieldMapping = Some(Some(mapping)))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.typeId shouldBe Some(dt.id.value)
        response.fieldMapping shouldBe Some(mapping)
      }
    }

    "unbind a data type from a panel by setting typeId to null" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Metric"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "MyType",
        fields    = Vector.empty,
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      await(dataTypeRepo.insert(dt))

      // bind
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, typeId = Some(Some(dt.id.value)), fieldMapping = None)
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      // unbind via explicit null
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, None, None, typeId = Some(None), fieldMapping = Some(None))
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.typeId shouldBe None
        response.fieldMapping shouldBe None
      }
    }

    // ── REST connector routes ──────────────────────────────────────────────────

    "POST /api/sources creates DataSource and registers DataType on successful fetch" in {
      cleanDb()
      import spray.json._

      val responseJson = """[{"col1":"a","col2":1},{"col1":"b","col2":2}]""".parseJson
      Post(
        "/api/sources",
        CreateSourceRequest(
          name           = "My API",
          sourceType     = "rest_api",
          config         = RestApiConfigPayload(url = "http://example.com", method = None, auth = None, headers = None),
          fieldOverrides = None
        )
      ) ~> routes(stubConnector(Right(responseJson))) ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[CreateSourceResponse]
        response.source.name shouldBe "My API"
        response.dataType shouldBe defined
        response.dataType.get.fields should have size 2
        response.fetchError shouldBe None
      }
    }

    "POST /api/sources creates DataSource with fetchError when fetch fails" in {
      cleanDb()
      Post(
        "/api/sources",
        CreateSourceRequest(
          name           = "Bad API",
          sourceType     = "rest_api",
          config         = RestApiConfigPayload(url = "http://example.com", method = None, auth = None, headers = None),
          fieldOverrides = None
        )
      ) ~> routes(stubConnector(Left("HTTP 500: Internal Server Error"))) ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[CreateSourceResponse]
        response.dataType shouldBe None
        response.fetchError shouldBe Some("HTTP 500: Internal Server Error")
      }
    }

    "POST /api/sources/:id/refresh updates DataType and increments version" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID
      import spray.json._

      val now = Instant.now()
      val source = DataSource(
        id         = DataSourceId(UUID.randomUUID().toString),
        name       = "Refresh Source",
        sourceType = SourceType.RestApi,
        config     = RestApiConfigPayload(url = "http://example.com", method = None, auth = None, headers = None).toJson,
        createdAt  = now,
        updatedAt  = now
      )
      await(dataSourceRepo.insert(source))

      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = Some(source.id),
        name      = "Refresh Source",
        fields    = Vector(DataField("old", "Old", "string", nullable = false)),
        version   = 1,
        createdAt = now,
        updatedAt = now
      )
      await(dataTypeRepo.insert(dt))

      val newJson = """[{"new_col":"x"}]""".parseJson
      Post(s"/api/sources/${source.id.value}/refresh") ~> routes(stubConnector(Right(newJson))) ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.fields.map(_.name) shouldBe Vector("new_col")
        response.version shouldBe 2
      }
    }

    "POST /api/sources/:id/refresh returns 404 for unknown source" in {
      Post("/api/sources/does-not-exist/refresh") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataSource not found")
      }
    }

    "GET /api/sources/:id/preview returns up to 10 rows" in {
      cleanDb()
      import com.helio.domain._
      import java.time.Instant
      import java.util.UUID
      import spray.json._

      val now = Instant.now()
      val source = DataSource(
        id         = DataSourceId(UUID.randomUUID().toString),
        name       = "Preview Source",
        sourceType = SourceType.RestApi,
        config     = RestApiConfigPayload(url = "http://example.com", method = None, auth = None, headers = None).toJson,
        createdAt  = now,
        updatedAt  = now
      )
      await(dataSourceRepo.insert(source))

      val bigArray = JsArray((1 to 15).map(i => JsObject("n" -> JsNumber(i))).toVector)
      Get(s"/api/sources/${source.id.value}/preview") ~> routes(stubConnector(Right(bigArray))) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PreviewSourceResponse].rows should have size 10
      }
    }

    "GET /api/sources/:id/preview returns 404 for unknown source" in {
      Get("/api/sources/does-not-exist/preview") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataSource not found")
      }
    }

    "duplicate a dashboard and return 201 with copied name, appearance, and panels" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU Usage"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(None, Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(0.5))), None, None, None)
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.id should not be dashboardId
        result.dashboard.name shouldBe "Operations (copy)"
        result.panels should have size 1
        val copiedPanel = result.panels.head
        copiedPanel.id should not be panelId
        copiedPanel.dashboardId shouldBe result.dashboard.id
        copiedPanel.title shouldBe "CPU Usage"
        copiedPanel.appearance.background shouldBe "#0f172a"
        copiedPanel.appearance.color shouldBe "#f8fafc"
        copiedPanel.appearance.transparency shouldBe 0.5
      }
    }

    "remap layout panel IDs when duplicating a dashboard" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Layout Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Panel A"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout     = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result    = responseAs[DuplicateDashboardResponse]
        val newPanelId = result.panels.head.id
        result.dashboard.layout.lg should have size 1
        result.dashboard.layout.lg.head.panelId shouldBe newPanelId
        result.dashboard.layout.lg.head.panelId should not be panelId
      }
    }

    "duplicate a dashboard with no panels" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Empty"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.name shouldBe "Empty (copy)"
        result.panels shouldBe empty
      }
    }

    "return 404 when duplicating a non-existent dashboard" in {
      Post("/api/dashboards/no-such-dashboard/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "leave the source dashboard unchanged after duplication" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Source"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), None)) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/dashboards/$dashboardId/duplicate") ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }

      Get(s"/api/dashboards/$dashboardId/panels") ~> routes() ~> check {
        val panels = responseAs[PanelsResponse].items
        panels should have size 1
        panels.head.id shouldBe panelId
        panels.head.title shouldBe "My Panel"
      }

      Get("/api/dashboards") ~> routes() ~> check {
        val dashboards = responseAs[DashboardsResponse].items
        val source     = dashboards.find(_.id == dashboardId).get
        source.name shouldBe "Source"
      }
    }

    // ── Export endpoint ────────────────────────────────────────────────────────

    "export a dashboard and return snapshot shape without IDs or meta" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Export Test"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("My Panel"), Some("metric"))) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val snapshot = responseAs[DashboardSnapshotPayload]
        snapshot.version shouldBe 1
        snapshot.dashboard.name shouldBe "Export Test"
        snapshot.panels should have size 1
        val snapshotPanel = snapshot.panels.head
        snapshotPanel.snapshotId shouldBe panelId
        snapshotPanel.title shouldBe "My Panel"
        snapshotPanel.`type` shouldBe "metric"
        // layout panelId references match the snapshotId
        snapshot.dashboard.layout.lg.head.panelId shouldBe snapshotPanel.snapshotId
      }
    }

    "export a dashboard with no panels returns empty panels array and empty layout" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Empty Export"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val snapshot = responseAs[DashboardSnapshotPayload]
        snapshot.panels shouldBe empty
        snapshot.dashboard.layout.lg shouldBe empty
        snapshot.dashboard.layout.md shouldBe empty
        snapshot.dashboard.layout.sm shouldBe empty
        snapshot.dashboard.layout.xs shouldBe empty
      }
    }

    "return 404 when exporting a non-existent dashboard" in {
      Get("/api/dashboards/no-such-id/export") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    // ── Import endpoint ────────────────────────────────────────────────────────

    "import a snapshot and return 201 with new IDs, remapped layout, and DuplicateDashboardResponse" in {
      cleanDb()
      var dashboardId = ""
      var panelId     = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Original"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("CPU"), Some("metric"))) ~> routes() ~> check {
        panelId = responseAs[PanelResponse].id
      }
      Patch(
        s"/api/dashboards/$dashboardId",
        UpdateDashboardRequest(
          name       = None,
          appearance = None,
          layout = Some(DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload(panelId, 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          ))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      var snapshot: DashboardSnapshotPayload = null
      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        snapshot = responseAs[DashboardSnapshotPayload]
      }

      Post("/api/dashboards/import", snapshot) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val result = responseAs[DuplicateDashboardResponse]
        result.dashboard.id should not be dashboardId
        result.dashboard.name shouldBe "Original"
        result.panels should have size 1
        val importedPanel = result.panels.head
        importedPanel.id should not be panelId
        importedPanel.dashboardId shouldBe result.dashboard.id
        importedPanel.title shouldBe "CPU"
        // layout should use the new panel ID (remapped from snapshotId)
        result.dashboard.layout.lg should have size 1
        result.dashboard.layout.lg.head.panelId shouldBe importedPanel.id
      }
    }

    "import assigns new IDs on each import" in {
      cleanDb()
      var dashboardId = ""

      Post("/api/dashboards", CreateDashboardRequest(Some("Repeated Import"))) ~> routes() ~> check {
        dashboardId = responseAs[DashboardResponse].id
      }

      var snapshot: DashboardSnapshotPayload = null
      Get(s"/api/dashboards/$dashboardId/export") ~> routes() ~> check {
        snapshot = responseAs[DashboardSnapshotPayload]
      }

      var firstImportId  = ""
      var secondImportId = ""
      Post("/api/dashboards/import", snapshot) ~> routes() ~> check {
        firstImportId = responseAs[DuplicateDashboardResponse].dashboard.id
      }
      Post("/api/dashboards/import", snapshot) ~> routes() ~> check {
        secondImportId = responseAs[DuplicateDashboardResponse].dashboard.id
      }

      firstImportId should not be dashboardId
      secondImportId should not be dashboardId
      firstImportId should not be secondImportId
    }

    "reject import with missing version field" in {
      Post(
        "/api/dashboards/import",
        HttpEntity(
          ContentTypes.`application/json`,
          """{"dashboard":{"name":"X","appearance":{"background":"transparent","gridBackground":"transparent"},"layout":{"lg":[],"md":[],"sm":[],"xs":[]}},"panels":[]}"""
        )
      ) ~> Route.seal(routes()) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("version")
      }
    }

    "reject import with empty dashboard name" in {
      val payload = DashboardSnapshotPayload(
        version = 1,
        dashboard = DashboardSnapshotDashboardEntry(
          name = "",
          appearance = DashboardAppearancePayload(Some("transparent"), Some("transparent")),
          layout = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
        ),
        panels = Vector.empty
      )
      Post("/api/dashboards/import", payload) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("name")
      }
    }

    "reject import with invalid panel type" in {
      val payload = DashboardSnapshotPayload(
        version = 1,
        dashboard = DashboardSnapshotDashboardEntry(
          name = "Test",
          appearance = DashboardAppearancePayload(Some("transparent"), Some("transparent")),
          layout = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
        ),
        panels = Vector(
          DashboardSnapshotPanelEntry(
            snapshotId   = "snap-1",
            title        = "Panel",
            `type`       = "unknown_type",
            appearance   = PanelAppearancePayload(None, None, None),
            typeId       = None,
            fieldMapping = None
          )
        )
      )
      Post("/api/dashboards/import", payload) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("unknown_type")
      }
    }

    "reject import when layout references unknown snapshotId" in {
      val payload = DashboardSnapshotPayload(
        version = 1,
        dashboard = DashboardSnapshotDashboardEntry(
          name = "Test",
          appearance = DashboardAppearancePayload(Some("transparent"), Some("transparent")),
          layout = DashboardLayoutPayload(
            lg = Vector(DashboardLayoutItemPayload("nonexistent-id", 0, 0, 4, 4)),
            md = Vector.empty,
            sm = Vector.empty,
            xs = Vector.empty
          )
        ),
        panels = Vector.empty
      )
      Post("/api/dashboards/import", payload) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("nonexistent-id")
      }
    }
  }
}
