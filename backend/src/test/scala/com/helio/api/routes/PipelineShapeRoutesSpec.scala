package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{JsonProtocols, PipelineShapeCatalogEntryResponse}
import com.helio.domain.{AuthenticatedUser, UserId}
import com.helio.services.PipelineShapeService
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.UUID

/** HEL-391 — `GET /api/pipeline-shapes` HTTP-layer coverage in isolation (mirrors
 *  `ConnectorRoutesSpec`). No DB dependency, since `PipelineShapeRoutes` wraps only the static
 *  `PipelineShape.Registry` via `PipelineShapeService`. The composed-route-tree / 401 coverage
 *  lives in `ApiRoutesSpec` (spec.md "The catalog route is reachable through the real composed
 *  route tree" / "Unauthenticated request is rejected"). */
class PipelineShapeRoutesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {

  private val user    = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val service = new PipelineShapeService()
  private val routes  = new PipelineShapeRoutes(service, user).routes

  "GET /pipeline-shapes" should {

    "return 200 with at least the passthrough entry" in {
      Get("/pipeline-shapes") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val entries = responseAs[Vector[PipelineShapeCatalogEntryResponse]]
        entries.map(_.id) should contain("passthrough")
      }
    }

    "include the passthrough entry's paramsSchema and outputContract" in {
      Get("/pipeline-shapes") ~> routes ~> check {
        val entries     = responseAs[Vector[PipelineShapeCatalogEntryResponse]]
        val passthrough = entries.find(_.id == "passthrough").getOrElse(fail("passthrough entry missing"))
        passthrough.paramsSchema.map(_.name) shouldBe Vector("fields")
        passthrough.outputContract.description shouldNot be(empty)
        passthrough.outputContract.fields shouldBe empty
      }
    }
  }
}
