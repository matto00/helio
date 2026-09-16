package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{JsonProtocols, PipelineStepCatalogResponse}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.services.pipelines.PipelineStepCatalogService
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.UUID

/** HEL-1136 task 2.3 — `GET /pipeline-step-catalog` HTTP-layer coverage in isolation (mirrors
 *  `PipelineShapeRoutesSpec`). No DB dependency, since `PipelineStepCatalogRoutes` wraps only the
 *  static `PipelineStep.Registry` via `PipelineStepCatalogService`. Composed-route-tree / 401
 *  coverage lives in `ApiRoutesSpec` (task 2.4). */
class PipelineStepCatalogRoutesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {

  private val user    = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val service = new PipelineStepCatalogService()
  private val routes  = new PipelineStepCatalogRoutes(service, user).routes

  "GET /pipeline-step-catalog" should {

    "return 200 with the full catalog" in {
      Get("/pipeline-step-catalog") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepCatalogResponse]
        resp.steps.map(_.kind).toSet should contain("select")
        resp.steps should have size 27
        resp.groups.map(_.id) should contain("filter-shape")
      }
    }
  }
}
