package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1424: the persisted `SchemaField` JSON carries `nullable` only when recorded, and reads tolerate its absence. */
class SchemaFieldNullableFormatSpec extends AnyWordSpec with Matchers {

  "schemaFieldJsonFormat" should {

    "omit nullable when it is not recorded (unchanged persisted shape)" in {
      SchemaField("a", "string").toJson shouldBe JsObject("name" -> JsString("a"), "type" -> JsString("string"))
    }

    "write nullable when recorded and round-trip it" in {
      val f = SchemaField("a", "string", Some(true))
      f.toJson.asJsObject.fields("nullable") shouldBe JsBoolean(true)
      f.toJson.convertTo[SchemaField] shouldBe f
      SchemaField("a", "string", Some(false)).toJson.convertTo[SchemaField].nullable shouldBe Some(false)
    }

    "read a legacy {name,type} object as nullable absent" in {
      """{"name":"a","type":"string"}""".parseJson.convertTo[SchemaField] shouldBe SchemaField("a", "string")
    }

    "read a non-boolean nullable value as absent" in {
      """{"name":"a","type":"string","nullable":"yes"}""".parseJson.convertTo[SchemaField].nullable shouldBe None
    }
  }
}
