package com.helio.api.protocols

import com.helio.api.protocols.sources.SourceSampleResponse
import com.helio.api.JsonProtocols
import com.helio.services.sources.SampleRowJson
import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}

/** HEL-1628 tasks 3.4 / 3.4a (standing constraint C1): the server half of the sample wire seam. Every body validated
 *  here is produced by the REAL production writer from engine-typed rows; the committed shared fixtures
 *  (`shared-test-fixtures/source-sample/`, read by the frontend's seam test too) must equal that output exactly, so
 *  the client half is fed real serializer output, never hand-built JSON. Regenerate them with
 *  `HEL1628_WRITE_FIXTURE=1 sbt "testOnly *SourceSampleSeamSpec"`. */
class SourceSampleSeamSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private val schema = JsonSchemaValidation.compile("sources/source-sample-response.schema.json")
  private val dir    = Paths.get("../shared-test-fixtures/source-sample")

  private val capturedAt = "2026-10-16T12:00:00Z"

  // Engine-typed rows: Int, Long beyond 2^53, plain/NaN/-Infinity/-0.0 doubles, null, strings, booleans.
  private val engineRows: Vector[Map[String, Any]] = Vector(
    Map[String, Any]("i" -> 7, "big" -> 9007199254740993L, "d" -> 1.5, "nan" -> Double.NaN, "s" -> "alpha", "b" -> true, "z" -> null),
    Map[String, Any]("i" -> -3, "big" -> -1L, "d" -> -0.0, "nan" -> Double.NegativeInfinity, "s" -> "", "b" -> false, "z" -> null)
  )

  private def realBody(rows: Vector[Map[String, Any]], count: Option[Long], truncated: Boolean, live: Boolean): JsValue =
    SourceSampleResponse(rows.map(SampleRowJson.encode), capturedAt, count, truncated, live).toJson

  private val exact   = realBody(engineRows, Some(2L), truncated = false, live = false)
  private val unknown = realBody(engineRows, None, truncated = true, live = true)

  private def fixture(name: String, produced: JsValue): JsValue = {
    val path = dir.resolve(name)
    if (sys.env.contains("HEL1628_WRITE_FIXTURE")) {
      Files.createDirectories(dir)
      Files.writeString(path, produced.prettyPrint + "\n")
    }
    Files.readString(path).parseJson
  }

  private def errors(j: JsValue): Vector[String] = JsonSchemaValidation.validationErrors(schema, j.compactPrint)

  "the sample response seam (server half)" should {

    "emit a body the committed schema accepts, with the engine's value classes encoded losslessly" in {
      errors(exact) shouldBe empty
      val row0 = exact.asJsObject.fields("rows").convertTo[Vector[JsObject]].head.fields
      row0("i") shouldBe JsObject("$int" -> JsNumber(7)) // an Int is NOT a plain JSON number on the wire
      row0("big") shouldBe JsObject("$long" -> JsString("9007199254740993"))
      row0("d") shouldBe JsNumber(1.5)
      row0("nan") shouldBe JsObject("$double" -> JsString("NaN"))
      row0("z") shouldBe JsNull
    }

    "emit sourceRowCount as an explicit null for an unknown total, and the schema accepts it" in {
      unknown.asJsObject.fields.keySet should contain("sourceRowCount")
      unknown.asJsObject.fields("sourceRowCount") shouldBe JsNull
      errors(unknown) shouldBe empty
    }

    "equal the committed shared fixtures exactly" in {
      fixture("source-sample-response.json", exact) shouldBe exact
      fixture("source-sample-response-unknown-total.json", unknown) shouldBe unknown
    }

    "reject (negative cases) a response missing capturedAt, omitting sourceRowCount, or with a malformed cell" in {
      def without(j: JsValue, k: String) = JsObject(j.asJsObject.fields - k)
      def withRow(cell: JsValue) =
        JsObject(exact.asJsObject.fields + ("rows" -> JsArray(JsObject("c" -> cell))))
      errors(without(exact, "capturedAt")) should not be empty
      errors(without(exact, "sourceRowCount")) should not be empty
      errors(without(exact, "live")) should not be empty
      errors(JsObject(exact.asJsObject.fields + ("extra" -> JsTrue))) should not be empty
      errors(withRow(JsObject("$int" -> JsNumber(1.5)))) should not be empty
      errors(withRow(JsObject("$long" -> JsNumber(5)))) should not be empty
      errors(withRow(JsObject("$long" -> JsString("12x")))) should not be empty
      errors(withRow(JsObject("$double" -> JsString("bogus")))) should not be empty
      errors(withRow(JsObject("$int" -> JsNumber(1), "x" -> JsNumber(2)))) should not be empty
      errors(withRow(JsObject("nested" -> JsString("map")))) should not be empty
      errors(withRow(JsArray(JsNumber(1)))) should not be empty
    }
  }
}
