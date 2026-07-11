package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Regression coverage for `PipelineRowJson.anyToJsValue`'s nested-`Map`
 *  case (HEL-216, skeptic design-gate round 1, blocking — see design.md).
 *
 *  Before this fix, a nested `Map[String, Any]` value (the image connector's
 *  `content` field: a `binary-ref` map) fell through to the catch-all
 *  `case _ => JsString(v.toString)`, stringifying it into an unusable Scala
 *  `Map#toString` rendering instead of a genuine JSON object. This spec
 *  proves the fix produces a real `JsObject` and that every pre-existing
 *  scalar case is unchanged. */
class PipelineRowJsonSpec extends AnyWordSpec with Matchers {

  "PipelineRowJson.anyToJsValue" should {

    "convert a nested Map[String, Any] into a genuine JsObject (not a stringified map)" in {
      val binaryRef: Map[String, Any] = Map(
        "storageKey" -> "image/ds-1.png",
        "mimeType"   -> "image/png",
        "filename"   -> "ds-1.png",
        "sizeBytes"  -> 1234L
      )
      val result = PipelineRowJson.anyToJsValue(binaryRef)

      result shouldBe a[JsObject]
      val obj = result.asInstanceOf[JsObject]
      obj.fields("storageKey") shouldBe JsString("image/ds-1.png")
      obj.fields("mimeType")   shouldBe JsString("image/png")
      obj.fields("filename")   shouldBe JsString("ds-1.png")
      obj.fields("sizeBytes")  shouldBe JsNumber(1234L)

      // Explicitly rule out the pre-fix stringified-map regression.
      result should not be a[JsString]
    }

    "recursively convert nested values inside a Map" in {
      val nested: Map[String, Any] = Map("outer" -> Map("inner" -> 42))
      val result = PipelineRowJson.anyToJsValue(nested).asInstanceOf[JsObject]
      result.fields("outer") shouldBe a[JsObject]
      result.fields("outer").asJsObject.fields("inner") shouldBe JsNumber(42)
    }

    "leave existing scalar serialization unchanged" in {
      PipelineRowJson.anyToJsValue(null)          shouldBe JsNull
      PipelineRowJson.anyToJsValue(true)          shouldBe JsBoolean(true)
      PipelineRowJson.anyToJsValue(42)             shouldBe JsNumber(42)
      PipelineRowJson.anyToJsValue(42L)            shouldBe JsNumber(42L)
      PipelineRowJson.anyToJsValue(3.14)           shouldBe JsNumber(3.14)
      PipelineRowJson.anyToJsValue(2.5f)           shouldBe JsNumber(BigDecimal(2.5f.toDouble))
      PipelineRowJson.anyToJsValue(BigDecimal(7))  shouldBe JsNumber(BigDecimal(7))
      PipelineRowJson.anyToJsValue("hello")        shouldBe JsString("hello")
    }
  }
}
