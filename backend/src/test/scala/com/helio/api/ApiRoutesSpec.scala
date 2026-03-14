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
        responseAs[DashboardsResponse] shouldBe
          DashboardsResponse(Vector(DashboardResponse(dashboard.id.value, "Operations")))
      }

      Get(s"/api/dashboards/${dashboard.id.value}/panels") ~> routes.routes ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[PanelsResponse]
        response.items should have size 1
        response.items.head.dashboardId shouldBe dashboard.id.value
        response.items.head.title shouldBe "CPU Usage"
        response.items.head.id should not be empty
      }
    }

    "create a dashboard and return 201" in {
      val routes = buildRoutes()

      Post("/api/dashboards", CreateDashboardRequest(Some("Operations"))) ~> routes.routes ~> check {
        status shouldBe StatusCodes.Created
        val response = responseAs[DashboardResponse]
        response.name shouldBe "Operations"
        response.id should not be empty
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
