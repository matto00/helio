package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-906 cycle 6 (evaluation-5.md CR1's residual-hole callout): proves the deliberate
 *  decision made in `schemaFieldJsonFormat.read` -- a persisted `type` that is NEITHER already
 *  canonical NOR one of `canonicalizeLegacy`'s four known synonyms no longer throws (and 500s)
 *  on read; it falls back to `"string"` instead. Companion coverage to
 *  `SchemaFieldStructuralGuardSpec` (which proves the constructor still rejects a bad value
 *  built directly) and `SchemaFieldRealDumpInvariantSpec` (which proves real persisted data
 *  from the scrubbed dump is all canonical today). */
class SchemaFieldJsonFormatTolerantReadSpec extends AnyWordSpec with Matchers {

  private def readField(name: String, rawType: String) =
    JsObject("name" -> JsString(name), "type" -> JsString(rawType)).convertTo[SchemaField]

  "schemaFieldJsonFormat.read" should {
    "pass through an already-canonical type unchanged" in {
      readField("f", "float").`type` shouldBe "float"
    }

    "canonicalize a known legacy synonym" in {
      readField("amount", "number").`type` shouldBe "float"
      readField("id", "long").`type` shouldBe "integer"
      readField("ts", "date").`type` shouldBe "timestamp"
    }

    "fall back to 'string' rather than throw for a genuinely unrecognized persisted type" in {
      noException should be thrownBy readField("mystery", "banana")
      readField("mystery", "banana").`type` shouldBe "string"
    }

    "fall back to 'string' rather than throw for an empty persisted type" in {
      noException should be thrownBy readField("empty", "")
      readField("empty", "").`type` shouldBe "string"
    }
  }
}
