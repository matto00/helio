package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.math.{BigDecimal => JBigDecimal}
import java.nio.charset.StandardCharsets
import java.time.Instant

/** HEL-1679 (design.md D1): `JsonTextLength` must equal spray's `compactPrint` size exactly, character and UTF-8 byte, because the snapshot
 *  batching and the wide-row run limit trust it instead of rendering. A spray printer change (or a drift in the scan) fails here. */
class JsonTextLengthSpec extends AnyWordSpec with Matchers {

  private def check(v: JsValue): Unit = {
    val text = v.compactPrint
    withClue(s"chars of ${text.take(80)}: ")(JsonTextLength.chars(v) shouldBe text.length.toLong)
    withClue(s"bytes of ${text.take(80)}: ")(JsonTextLength.utf8Bytes(v) shouldBe text.getBytes(StandardCharsets.UTF_8).length.toLong)
  }

  private val allControls  = (0 until 0x20).map(_.toChar).mkString
  private val adversarial = Seq(
    "",
    "plain ascii",
    "quote \" and backslash \\ and slash /",
    allControls,
    "\u007f del and \u0080 c1 and ÿ",
    "Привет, мир",
    "中文字符 三字节",
    "emoji 😀 pair",
    "lone high \uD83D alone",
    "lone low \uDE00 alone",
    "high at end \uD83D",
    "reversed \uDE00\uD83D pair",
    "mixed \"\\\n\t\u0001中😀ж",
    "   separators",
    "x" * 5000
  )

  "JsonTextLength" should {
    "equal compactPrint for every adversarial string, as a value and as an object key" in {
      adversarial.foreach { s =>
        check(JsString(s))
        check(JsObject(s -> JsNumber(1)))
      }
    }

    "equal compactPrint for scalars, big decimals and empty containers" in {
      Seq[JsValue](
        JsNull, JsTrue, JsFalse, JsNumber(0), JsNumber(-1), JsNumber(Long.MaxValue), JsNumber(Double.MaxValue), JsNumber(1.5e-300),
        JsNumber(BigDecimal("123456789012345678901234567890.123456789")), JsNumber(BigDecimal("1E+400")), JsNumber(BigDecimal("0.000001")),
        JsArray.empty, JsObject.empty
      ).foreach(check)
    }

    "equal compactPrint for nested arrays and objects" in {
      check(JsArray(JsNumber(1), JsString("a\"b"), JsNull, JsArray(JsArray.empty, JsObject.empty), JsObject("k" -> JsArray(JsTrue, JsFalse))))
      check(JsObject("a" -> JsObject("b" -> JsObject("c" -> JsArray(JsString("中"), JsString("😀")))), "ж" -> JsString("\n"), "" -> JsNull))
      check(JsArray(adversarial.map(JsString(_)).toVector))
      check(JsObject(adversarial.zipWithIndex.map { case (s, i) => s"$i$s" -> JsString(s) }.toMap))
    }

    "equal compactPrint for engine rows converted through anyToJsValue (every value type the engine holds)" in {
      val row: Map[String, Any] = Map(
        "int" -> 1, "long" -> (1L << 40), "double" -> 2.5, "float" -> 1.1f, "scala" -> BigDecimal("12.50"), "java" -> new JBigDecimal("3.25"),
        "bool" -> true, "null" -> null, "str" -> "a\"b\u0001ж中😀", "nested" -> Map("storageKey" -> "k", "sizeBytes" -> 7L, "deep" -> Map("x" -> 1)),
        "catchAll" -> Seq(1, 2, 3), "date" -> Instant.parse("2026-01-01T00:00:00Z")
      )
      val json = JsObject(row.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
      check(json)
      JsonTextLength.ofRow(row) shouldBe json.compactPrint.length.toLong
    }
  }
}
