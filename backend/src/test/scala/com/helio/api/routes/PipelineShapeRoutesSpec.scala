package com.helio.api.routes

import com.helio.api.routes.pipelines.PipelineShapeRoutes
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, ExpandPipelineShapeRequest, JsonProtocols, PipelineShapeCatalogEntryResponse, ShapeStepExpansionResponse}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.services.pipelines.PipelineShapeService
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsArray, JsObject, JsString}

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
      }
    }

    "include named entries for single-row, top-n, time-series, and pivot-matrix, each with a non-empty paramsSchema" in {
      Get("/pipeline-shapes") ~> routes ~> check {
        val entries = responseAs[Vector[PipelineShapeCatalogEntryResponse]]

        val singleRow = entries.find(_.id == "single-row").getOrElse(fail("single-row entry missing"))
        singleRow.paramsSchema shouldNot be(empty)

        val topN = entries.find(_.id == "top-n").getOrElse(fail("top-n entry missing"))
        topN.paramsSchema shouldNot be(empty)

        val timeSeries = entries.find(_.id == "time-series").getOrElse(fail("time-series entry missing"))
        timeSeries.paramsSchema shouldNot be(empty)

        val pivotMatrix = entries.find(_.id == "pivot-matrix").getOrElse(fail("pivot-matrix entry missing"))
        pivotMatrix.paramsSchema shouldNot be(empty)
      }
    }
  }

  "POST /pipeline-shapes/:id/expand" should {

    "return 200 with the expanded steps for a registered shape and valid params (HEL-402)" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      Post("/pipeline-shapes/single-row/expand", ExpandPipelineShapeRequest(params)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val expansions = responseAs[Vector[ShapeStepExpansionResponse]]
        expansions should have size 1
        expansions.head.kind shouldBe "aggregate"
      }
    }

    "return 404 for an unknown shape id (HEL-402)" in {
      Post("/pipeline-shapes/does-not-exist/expand", ExpandPipelineShapeRequest(JsObject.empty)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse].message should include("does-not-exist")
      }
    }

    "return 422 with the shape's own message for invalid params (HEL-402)" in {
      val params = JsObject("mode" -> JsString("aggregate"))
      Post("/pipeline-shapes/single-row/expand", ExpandPipelineShapeRequest(params)) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[ErrorResponse].message shouldBe
          "single-row shape: missing required field 'measures' (expected a non-empty array of " +
            "{ fn, field, alias } objects) when mode is \"aggregate\""
      }
    }
  }
}
