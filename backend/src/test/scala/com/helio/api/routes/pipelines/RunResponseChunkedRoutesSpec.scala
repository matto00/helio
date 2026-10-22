package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.RunResultResponse
import com.helio.domain.steps.{ComputeConfig, ComputeStep}
import com.helio.api.routes.RunResponseMarshalling
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.RunServiceHarness
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1693 G2 (design.md D5): `POST /api/pipelines/:id/run` (real and dry) answers with a CHUNKED `application/json` body whose bytes are the compact
 *  rendering of the response, which parses back to the same `RunResultResponse`, in pieces no larger than the printer's bound. Mutation-checked by wiring
 *  the route back to `StatusCodes.OK -> result` (the default marshaller): the body is then strict and this goes red. */
class RunResponseChunkedRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with RunServiceHarness with JsonProtocols {

  private val Rows = 6000

  private def routes = new PipelineRunSubmitRoutes(service, owner).routes

  private def manyRowPipeline() = {
    val pid = seedPipeline(seedCsvSource(Rows, 3, (r, c) => s"v$c-$r-ж\"x"))
    val c   = addStep(pid, ComputeStep.Kind, ComputeConfig("n", "concat($a, $b)", None))
    addOutput(pid, c, "out")
    pid
  }

  "POST /pipelines/:id/run" should {
    Seq("" -> "real run", "?dry=true" -> "dry run").foreach { case (query, label) =>
      s"stream a chunked compact-JSON body of the whole response for a $label" in {
        val pid = manyRowPipeline()
        Post(s"/pipelines/${pid.value}/run$query") ~> routes ~> check {
          status shouldBe StatusCodes.OK
          chunks should not be empty
          contentType shouldBe ContentTypes.`application/json`
          val body = responseAs[String]
          val json = body.parseJson
          // The bytes are exactly the compact rendering (no pretty printing, no reordering).
          body shouldBe json.compactPrint
          val parsed = json.convertTo[RunResultResponse]
          parsed.rowCount shouldBe Rows
          parsed.rows should have size Rows.toLong
          // Round trip: re-serialising the parsed value gives the same JSON.
          parsed.toJson shouldBe json
          // The 3x: a piece is PieceChars characters and the fixture's text includes 2-byte UTF-8 characters, plus slack for one row.
          // No piece is larger than the printer's flush size plus one row's own text.
          val sizes = chunks.collect { case c: HttpEntity.Chunk => c.data.length }
          sizes.size should be > 3
          sizes.max should be <= (RunResponseMarshalling.PieceChars * 3 + 1024)
          body.length should be > RunResponseMarshalling.PieceChars * 4
        }
      }
    }
  }
}
