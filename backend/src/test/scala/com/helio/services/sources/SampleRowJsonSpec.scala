package com.helio.services.sources

import com.helio.domain.engine.{OJ, ParityCorpus}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1628 tasks 1.1 / 3.4a: the sample row encoding, and its agreement with the parity corpus encoding. */
class SampleRowJsonSpec extends AnyWordSpec with Matchers {

  private val valueSet: Seq[Any] = Seq(
    null, true, false, 0, 7, -3, Int.MaxValue, 0L, 9007199254740993L, Long.MinValue, "", "text", "ünï\"code",
    1.5, -2.25, 0.0, 1e300, Double.NaN, Double.PositiveInfinity, Double.NegativeInfinity, -0.0
  )

  "SampleRowJson.encodeValue" should {
    "encode Int as $int and Long as a $long string" in {
      SampleRowJson.encodeValue(7) shouldBe JsObject("$int" -> JsNumber(7))
      SampleRowJson.encodeValue(9007199254740993L) shouldBe JsObject("$long" -> JsString("9007199254740993"))
    }

    "encode NaN, the infinities and negative zero as $double strings" in {
      SampleRowJson.encodeValue(Double.NaN) shouldBe JsObject("$double" -> JsString("NaN"))
      SampleRowJson.encodeValue(Double.PositiveInfinity) shouldBe JsObject("$double" -> JsString("Infinity"))
      SampleRowJson.encodeValue(Double.NegativeInfinity) shouldBe JsObject("$double" -> JsString("-Infinity"))
      SampleRowJson.encodeValue(-0.0) shouldBe JsObject("$double" -> JsString("-0.0"))
    }

    "encode other doubles, strings, booleans and null as plain JSON" in {
      SampleRowJson.encodeValue(1.5) shouldBe JsNumber(1.5)
      SampleRowJson.encodeValue(0.0) shouldBe JsNumber(0.0)
      SampleRowJson.encodeValue("x") shouldBe JsString("x")
      SampleRowJson.encodeValue(true) shouldBe JsBoolean(true)
      SampleRowJson.encodeValue(null) shouldBe JsNull
    }

    "fail on a nested map without echoing its contents" in {
      val e = intercept[SampleRowJson.UnsupportedValue](SampleRowJson.encode(Map("c" -> Map("secret" -> "cell-value"))))
      e.getMessage should not include "cell-value"
      e.getMessage should not include "secret"
    }

    "fail on an unrecognised value class rather than falling back to toString" in {
      intercept[SampleRowJson.UnsupportedValue](SampleRowJson.encodeValue(BigDecimal(1))) // not a value the engine emits
      intercept[SampleRowJson.UnsupportedValue](SampleRowJson.encodeValue(1.5f))
    }
  }

  "SampleRowJson vs the parity corpus encoding (task 3.4a)" should {
    "produce equal parsed JSON values for the same value set" in {
      valueSet.foreach { v =>
        val corpus = ParityCorpus.encodeValue(v)
        val parsed = OJ.render(corpus).parseJson
        withClue(s"value $v: ") { SampleRowJson.encodeValue(v) shouldBe parsed }
      }
    }
  }
}
