package com.helio.api

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.ContentTypes
import akka.http.scaladsl.model.HttpEntity
import akka.http.scaladsl.server.Route
import akka.http.scaladsl.testkit.ScalatestRouteTest
import akka.util.Timeout
import com.helio.app.DashboardRegistryActor
import com.helio.app.PanelRegistryActor
import com.helio.domain.Dashboard
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

class ApiRoutesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {
  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val timeout: Timeout = 3.seconds

  private def buildRoutes(): ApiRoutes = {
    val suffix = UUID.randomUUID().toString
    val dashboardRegistry =
      typedSystem.systemActorOf(DashboardRegistryActor(), s"dashboard-registry-$suffix")
    val panelRegistry = typedSystem.systemActorOf(PanelRegistryActor(), s"panel-registry-$suffix")

    new ApiRoutes(dashboardRegistry, panelRegistry)(typedSystem)
  }

  private def buildSeededRoutes(): (ApiRoutes, Dashboard) = {
    val suffix = UUID.randomUUID().toString
    val dashboardRegistry =
      typedSystem.systemActorOf(DashboardRegistryActor(), s"dashboard-registry-$suffix")
    val panelRegistry = typedSystem.systemActorOf(PanelRegistryActor(), s"panel-registry-$suffix")

    val dashboard = await(dashboardRegistry.ask(DashboardRegistryActor.RegisterDashboard("Operations", _)))
    await(
      panelRegistry.ask(
        PanelRegistryActor.RegisterPanel(dashboard.id, "CPU Usage", _)
      )
    )

    (new ApiRoutes(dashboardRegistry, panelRegistry)(typedSystem), dashboard)
  }

  private def await[T](future: scala.concurrent.Future[T]): T =
    Await.result(future, 3.seconds)

  private def assertResourceMeta(meta: ResourceMetaResponse): Unit = {
    meta.createdBy shouldBe "system"
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
      val routes = buildRoutes()

      Get("/health") ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[HealthResponse] shouldBe HealthResponse("ok")
      }
    }

    "return an empty dashboard collection by default" in {
      val routes = buildRoutes()

      Get("/api/dashboards") ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DashboardsResponse] shouldBe DashboardsResponse(Vector.empty)
      }
    }

    "return dashboard and panel data from the in-memory registries" in {
      val (routes, dashboard) = buildSeededRoutes()

      Get("/api/dashboards") ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardsResponse]
        response.items should have size 1
        response.items.head.id shouldBe dashboard.id.value
        response.items.head.name shouldBe "Operations"
        assertResourceMeta(response.items.head.meta)
        assertDashboardAppearance(response.items.head.appearance)
        assertDashboardLayout(response.items.head.layout)
      }

      Get(s"/api/dashboards/${dashboard.id.value}/panels") ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelsResponse]
        response.items should have size 1
        response.items.head.dashboardId shouldBe dashboard.id.value
        response.items.head.title shouldBe "CPU Usage"
        response.items.head.id should not be empty
        assertResourceMeta(response.items.head.meta)
        assertPanelAppearance(response.items.head.appearance)
      }
    }

    "create a dashboard and return 201" in {
      val routes = buildRoutes()

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes.routes ~> check {
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
      val routes = buildRoutes()

      Post("/api/dashboards", CreateDashboardRequest(None)) ~> routes.routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DashboardResponse].name shouldBe RequestValidation.DefaultDashboardName
      }
    }

    "create a panel and return 201" in {
      val (routes, dashboard) = buildSeededRoutes()

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboard.id.value), Some("Latency"))
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[PanelResponse]
        response.dashboardId shouldBe dashboard.id.value
        response.title shouldBe "Latency"
        response.id should not be empty
        assertResourceMeta(response.meta)
        assertPanelAppearance(response.appearance)
      }
    }

    "update dashboard appearance and refresh lastUpdated" in {
      val (routes, dashboard) = buildSeededRoutes()

      Patch(
        s"/api/dashboards/${dashboard.id.value}",
        UpdateDashboardRequest(
          appearance = Some(DashboardAppearancePayload(Some("#1e293b"), Some("#0f172a"))),
          layout = None
        )
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.id shouldBe dashboard.id.value
        response.appearance.background shouldBe "#1e293b"
        response.appearance.gridBackground shouldBe "#0f172a"
        response.meta.lastUpdated should not be dashboard.meta.lastUpdated.toString
      }

      Get("/api/dashboards") ~> routes.routes ~> check {
        val response = responseAs[DashboardsResponse]
        response.items.head.appearance.background shouldBe "#1e293b"
        response.items.head.appearance.gridBackground shouldBe "#0f172a"
      }
    }

    "update dashboard layout and refresh lastUpdated" in {
      val (routes, dashboard) = buildSeededRoutes()

      Patch(
        s"/api/dashboards/${dashboard.id.value}",
        UpdateDashboardRequest(
          appearance = None,
          layout = Some(
            DashboardLayoutPayload(
              lg = Vector(
                DashboardLayoutItemPayload("panel-a", x = 1, y = 2, w = 5, h = 6)
              ),
              md = Vector(
                DashboardLayoutItemPayload("panel-a", x = 0, y = 1, w = 4, h = 5)
              ),
              sm = Vector(
                DashboardLayoutItemPayload("panel-a", x = 0, y = 0, w = 3, h = 5)
              ),
              xs = Vector(
                DashboardLayoutItemPayload("panel-a", x = 0, y = 0, w = 2, h = 5)
              )
            )
          )
        )
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DashboardResponse]
        response.id shouldBe dashboard.id.value
        response.layout.lg should contain only DashboardLayoutItemResponse("panel-a", 1, 2, 5, 6)
        response.meta.lastUpdated should not be dashboard.meta.lastUpdated.toString
      }

      Get("/api/dashboards") ~> routes.routes ~> check {
        val response = responseAs[DashboardsResponse]
        response.items.head.layout.md should contain only DashboardLayoutItemResponse("panel-a", 0, 1, 4, 5)
      }
    }

    "update panel appearance and clamp transparency" in {
      val (routes, dashboard) = buildSeededRoutes()
      var panelId = ""

      Get(s"/api/dashboards/${dashboard.id.value}/panels") ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        panelId = responseAs[PanelsResponse].items.head.id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(
          Some(PanelAppearancePayload(Some("#0f172a"), Some("#f8fafc"), Some(4.0)))
        )
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelResponse]
        response.id shouldBe panelId
        response.appearance.background shouldBe "#0f172a"
        response.appearance.color shouldBe "#f8fafc"
        response.appearance.transparency shouldBe 1.0
      }

      Get(s"/api/dashboards/${dashboard.id.value}/panels") ~> routes.routes ~> check {
        val response = responseAs[PanelsResponse]
        response.items.head.appearance.background shouldBe "#0f172a"
      }
    }

    "reject appearance updates without appearance payload" in {
      val (routes, dashboard) = buildSeededRoutes()

      Patch(
        s"/api/dashboards/${dashboard.id.value}",
        UpdateDashboardRequest(None, None)
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("appearance or layout is required")
      }
    }

    "default a missing panel title" in {
      val (routes, dashboard) = buildSeededRoutes()

      Post(
        "/api/panels",
        CreatePanelRequest(Some(dashboard.id.value), None)
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PanelResponse].title shouldBe RequestValidation.DefaultPanelTitle
      }
    }

    "reject panel creation without dashboardId" in {
      val routes = buildRoutes()

      Post("/api/panels", CreatePanelRequest(None, Some("Latency"))) ~> routes.routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse] shouldBe ErrorResponse("dashboardId is required")
      }
    }

    "reject panel creation for a missing dashboard" in {
      val routes = buildRoutes()

      Post(
        "/api/panels",
        CreatePanelRequest(Some("missing-dashboard"), Some("Latency"))
      ) ~> routes.routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Dashboard not found")
      }
    }

    "reject malformed panel requests" in {
      val routes = buildRoutes()

      Post(
        "/api/panels",
        HttpEntity(ContentTypes.`application/json`, """{"title":17}""")
      ) ~> Route.seal(routes.routes) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }
}
