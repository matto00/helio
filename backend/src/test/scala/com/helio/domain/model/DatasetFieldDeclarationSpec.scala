package com.helio.domain.model

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1076 tasks.md 1.2/1.4: the JSON codec's absent-vs-null normalization and legacy-shape
 *  backward compatibility. */
class DatasetFieldDeclarationSpec extends AnyWordSpec with Matchers {

  "DatasetFieldDeclaration's json format" should {

    "deserialize a pre-existing legacy {name,type} row (no required/default keys) unchanged" in {
      val raw = """{"name":"age","type":"integer"}""".parseJson
      val decoded = raw.convertTo[DatasetFieldDeclaration]
      decoded shouldBe DatasetFieldDeclaration("age", DataFieldType.IntegerType, required = false, default = None)
    }

    "normalize an explicit null default to None" in {
      val raw = """{"name":"age","type":"integer","required":true,"default":null}""".parseJson
      val decoded = raw.convertTo[DatasetFieldDeclaration]
      decoded shouldBe DatasetFieldDeclaration("age", DataFieldType.IntegerType, required = true, default = None)
    }

    // skeptic-final-1.md CR5: renamed -- this only verifies the codec's `write` always emits
    // `FloatType`'s own canonical string ("float"), never the wire synonym "double" (which
    // `DatasetFieldDeclaration` never carries in the first place -- `fieldType` is already a
    // `DataFieldType`, not a raw string; the actual "double" -> "float" wire canonicalization
    // happens upstream in `DataSourceService`, before a `DatasetFieldDeclaration` is even
    // constructed). See `DataSourceServiceSpec`'s "persists a caller-declared 'double' field's
    // declaration as canonical 'float'" for the real end-to-end exercise of that scenario.
    "the codec's write path always emits FloatType's canonical wire string" in {
      val field = DatasetFieldDeclaration("price", DataFieldType.FloatType)
      field.toJson.asJsObject.fields("type") shouldBe JsString("float")
    }

    "fall back to StringType with no crash when a stored type string is unrecognized" in {
      val raw = """{"name":"weird","type":"not-a-real-type"}""".parseJson
      val decoded = raw.convertTo[DatasetFieldDeclaration]
      decoded.fieldType shouldBe DataFieldType.StringType
    }

    "round-trip required/default through write then read" in {
      val field = DatasetFieldDeclaration("age", DataFieldType.IntegerType, required = true, default = Some(JsNumber(5)))
      field.toJson.convertTo[DatasetFieldDeclaration] shouldBe field
    }
  }
}
