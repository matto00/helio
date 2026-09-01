package com.helio.api.routes.pipelines

import com.helio.api.routes.pipelines.PipelineShapeRoutes
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, ExpandPipelineShapeRequest, ExpandPipelineShapeResponse, JsonProtocols, PipelineShapeCatalogEntryResponse}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.services.pipelines.PipelineShapeService
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

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

    // HEL-906 cycle 7 (task 3.8, BREAKING): the response envelope changed from a bare
    // `Vector[ShapeStepExpansionResponse]` array to `{steps, outputs?}`. This test was updated
    // to the new shape, not left asserting the old bare-array response.
    "return 200 with {steps, outputs} for a registered shape and valid params (HEL-402, HEL-906 task 3.8)" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      Post("/pipeline-shapes/single-row/expand", ExpandPipelineShapeRequest(params)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        // Raw-JSON assertion FIRST, on the raw parsed JsObject -- not just the unmarshalled case
        // class. `resp.outputs shouldBe None`/`resp.steps.head.parentStepId shouldBe None` alone
        // cannot distinguish "key omitted" from "key present as null" (spray-json's default
        // OptionFormat, with no NullOptions mixed in anywhere in this backend, DROPS a None
        // field entirely rather than writing `null` -- that ambiguity is exactly how a wrong
        // "outputs: null"/"parentStepId: null" spec claim slipped through review THREE separate
        // times). Assert both keys are genuinely ABSENT from the raw object.
        val rawJson = responseAs[JsObject]
        rawJson.fields.keySet should contain("steps")
        rawJson.fields.keySet should not contain "outputs"
        val rawFirstStep = rawJson.fields("steps").asInstanceOf[JsArray].elements.head.asJsObject
        rawFirstStep.fields.keySet should not contain "parentStepId"

        val resp = rawJson.convertTo[ExpandPipelineShapeResponse]
        resp.steps should have size 1
        resp.steps.head.kind shouldBe "aggregate"
        // Chaining convention: clientId/parentStepId, mirroring
        // CreatePipelineTransactionalStepRequest -- the sole step is the chain root.
        resp.steps.head.clientId shouldBe "step-0"
        resp.steps.head.parentStepId shouldBe None
        resp.outputs shouldBe None
      }
    }

    "chains multiple expanded steps' clientId/parentStepId in expansion order (HEL-906 task 3.8)" in {
      // top-n expands to [sort, limit] -- two steps, a real chain to assert against.
      val params = JsObject(
        "measure"   -> JsString("amount"),
        "n"         -> JsNumber(5),
        "direction" -> JsString("desc")
      )
      Post("/pipeline-shapes/top-n/expand", ExpandPipelineShapeRequest(params)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        // Raw-JSON assertion: the FIRST entry's raw object must OMIT `parentStepId` entirely
        // (not carry it as `null`); the SECOND entry must carry it as a real string.
        val rawJson = responseAs[JsObject]
        val rawSteps = rawJson.fields("steps").asInstanceOf[JsArray].elements.map(_.asJsObject)
        rawSteps.head.fields.keySet should not contain "parentStepId"
        rawSteps(1).fields("parentStepId") shouldBe JsString("step-0")

        val resp = rawJson.convertTo[ExpandPipelineShapeResponse]
        resp.steps should have size 2
        resp.steps(0).clientId shouldBe "step-0"
        resp.steps(0).parentStepId shouldBe None
        resp.steps(1).clientId shouldBe "step-1"
        resp.steps(1).parentStepId shouldBe Some("step-0")
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
