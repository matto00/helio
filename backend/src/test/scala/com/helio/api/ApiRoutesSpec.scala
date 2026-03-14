package com.helio.api

import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.actor.typed.scaladsl.adapter._
import akka.http.scaladsl.model.StatusCodes
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
  }
}
