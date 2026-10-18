package com.helio.api.protocols

import com.helio.api.protocols.pipelines.DraftPreviewLine.{DraftPreviewColumn, DraftPreviewErrorLine, DraftPreviewFailedLine, DraftPreviewRowsLine, DraftPreviewStepLine, DraftPreviewUnavailableLine}
import com.helio.testsupport.{DraftPreviewApiFixture, JsonSchemaValidation}
import spray.json._

import java.nio.file.{Files, Paths}

/** HEL-1630 task 5.11, the server half of the draft-preview wire seam. The response fixture is NOT hand-built: it is what the
 *  real route writes for a real draft (an AI step, a failing step and its subtree, an unaffected branch, the final rows), and the
 *  committed copy must equal it, so the client half (`draftPreview.contract.test.ts`, which reads the same files) is fed real
 *  serializer output. Regenerate with `HEL1630_WRITE_FIXTURE=1 sbt "testOnly *DraftPreviewSeamSpec"`.
 *
 *  Columns stay at two so `Map` iteration, and therefore the fixture bytes, is deterministic. */
class DraftPreviewSeamSpec extends DraftPreviewApiFixture {

  private val dir          = Paths.get("../shared-test-fixtures/draft-preview")
  private val lineSchema   = JsonSchemaValidation.compile("pipelines/draft-preview-line.schema.json")
  private val requestSchema = JsonSchemaValidation.compile("pipelines/draft-preview-request.schema.json")

  private val request: JsObject = {
    val bad = jobj("field" -> jstr("absent"), "from" -> jstr("csv"), "to" -> jstr("json"), "outputField" -> jstr("o"))
    val ai  = jobj("inputField" -> jstr("name"), "instruction" -> jstr("shout"), "outputField" -> jstr("out"))
    draftBody(
      Vector(rootOf("r", jobj("k" -> intCell(1), "name" -> jstr("a")), jobj("k" -> jobj("$long" -> jstr("9007199254740993")), "name" -> jstr("b")))),
      Vector(
        limitStep("a", 9), stepJson("b", "convertformat", bad, Some("a")), limitStep("c", 9, Some("b")),
        stepJson("d", "generatetext", ai, position = 1), limitStep("e", 9, Some("d")), limitStep("f", 9, Some("a"), position = 1)
      ),
      "rowsStepId" -> jstr("f")
    )
  }

  private def valid(schema: com.networknt.schema.JsonSchema, j: JsValue): Vector[String] = JsonSchemaValidation.validationErrors(schema, j.compactPrint)

  private def fixture(name: String, produced: String): String = {
    val path = dir.resolve(name)
    if (sys.env.contains("HEL1630_WRITE_FIXTURE")) { Files.createDirectories(dir); Files.writeString(path, produced) }
    Files.readString(path)
  }

  private def produced(): String = {
    val seed = seedPipeline()
    val res  = preview(seed, userA, request)
    res.status.intValue shouldBe 200
    res.body
  }

  "the draft-preview wire (server half)" should {
    "accept the request fixture against the committed request schema, and every line the real route emits against the line schema" in {
      assertValidRequest(request)
      val body = produced()
      val lines = body.linesIterator.filter(_.nonEmpty).map(_.parseJson.asJsObject).toVector
      lines.map(_.fields("type").convertTo[String]).toSet shouldBe Set("step", "unavailable", "error", "rows")
      lines.foreach(l => withClue(l.compactPrint)(valid(lineSchema, l) shouldBe empty))
    }

    "equal the committed shared fixtures exactly" in {
      fixture("draft-preview-request.json", request.prettyPrint + "\n").parseJson shouldBe request
      val body = produced()
      fixture("draft-preview-response.ndjson", body) shouldBe body
      val failed = DraftPreviewFailedLine.toJson
      valid(lineSchema, failed) shouldBe empty
      fixture("draft-preview-failed-line.json", failed.prettyPrint + "\n").parseJson shouldBe failed
    }

    "write every line type with exactly the contract's field names" in {
      DraftPreviewStepLine("s", 2, Vector(DraftPreviewColumn("c", "int"))).toJson.fields.keySet shouldBe Set("type", "step", "count", "schema")
      DraftPreviewUnavailableLine("s", "aiStep").toJson.fields.keySet shouldBe Set("type", "step", "reason")
      DraftPreviewErrorLine("s", "m").toJson.fields.keySet shouldBe Set("type", "step", "message")
      DraftPreviewRowsLine(Some("s"), available = true, Vector.empty, 0, truncated = false).toJson.fields.keySet shouldBe Set("type", "step", "available", "rows", "count", "truncated")
      DraftPreviewRowsLine(None, available = false, Vector.empty, 0, truncated = false).toJson.fields("step") shouldBe JsNull
      DraftPreviewFailedLine.toJson.fields.keySet shouldBe Set("type", "message")
    }

    "reject a line with a renamed, missing or extra field, an unknown reason or column type, or an unknown type" in {
      def renamed(l: JsObject, from: String, to: String) = JsObject((l.fields - from) + (to -> l.fields(from)))
      val step = DraftPreviewStepLine("s", 2, Vector(DraftPreviewColumn("c", "int"))).toJson
      valid(lineSchema, renamed(step, "count", "n")) should not be empty
      valid(lineSchema, JsObject(step.fields - "schema")) should not be empty
      valid(lineSchema, JsObject(step.fields + ("extra" -> JsTrue))) should not be empty
      valid(lineSchema, DraftPreviewStepLine("s", 2, Vector(DraftPreviewColumn("c", "decimal"))).toJson) should not be empty
      valid(lineSchema, DraftPreviewUnavailableLine("s", "because").toJson) should not be empty
      valid(lineSchema, renamed(DraftPreviewErrorLine("s", "m").toJson, "message", "error")) should not be empty
      valid(lineSchema, JsObject("type" -> jstr("progress"), "step" -> jstr("s"))) should not be empty
      valid(lineSchema, renamed(DraftPreviewRowsLine(Some("s"), available = true, Vector.empty, 0, truncated = false).toJson, "truncated", "cut")) should not be empty
    }

    "reject a request with a missing roots, a bad cell, an unknown field, a step without a config, or too many steps" in {
      valid(requestSchema, JsObject(request.fields - "roots")) should not be empty
      valid(requestSchema, JsObject(request.fields + ("extra" -> JsTrue))) should not be empty
      valid(requestSchema, draftBody(Vector(rootOf("r", jobj("c" -> jobj("nested" -> jstr("x"))))), Vector.empty)) should not be empty
      valid(requestSchema, draftBody(Vector(rootOf("r")), Vector(JsObject(limitStep("a", 1).fields - "config")))) should not be empty
      valid(requestSchema, draftBody(Vector(rootOf("r")), Vector.tabulate(51)(i => limitStep(s"s$i", 1, position = i)))) should not be empty
      valid(requestSchema, draftBody(Vector(rootOf("r", jobj("c" -> jobj("$long" -> JsNumber(5))))), Vector.empty)) should not be empty
    }
  }
}
