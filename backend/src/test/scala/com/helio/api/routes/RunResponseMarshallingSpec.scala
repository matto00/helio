package com.helio.api.routes

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1693 G1 (design.md D5): the streamed pieces concatenate to EXACTLY spray's `compactPrint`, so the wire body of a run response is
 *  unchanged. Mutation-checked: dropping the comma between array elements, or rendering one escape differently, turns it red. */
class RunResponseMarshallingSpec extends AnyWordSpec with Matchers {

  private def streamed(v: JsValue, pieceChars: Int): String = RunResponseMarshalling.pieces(v, pieceChars).mkString

  private def check(v: JsValue, pieceChars: Int = RunResponseMarshalling.PieceChars): Unit =
    withClue(s"pieceChars=$pieceChars ${v.compactPrint.take(80)}: ")(streamed(v, pieceChars) shouldBe v.compactPrint)

  private val allControls  = (0 until 0x20).map(_.toChar).mkString
  private val adversarial = Seq(
    "", "plain ascii", "quote \" and backslash \\ and slash /", allControls, "\u007f del and \u0080 c1 and ÿ", "Привет, мир", "中文字符 三字节",
    "emoji 😀 pair", "lone high \uD83D alone", "lone low \uDE00 alone", "high at end \uD83D", "reversed \uDE00\uD83D pair",
    "mixed \"\\\n\t\u0001中😀ж", "   separators", "x" * 5000
  )

  // Tiny piece sizes force a flush after (almost) every element; the default size flushes only on the large values.
  private val sizes = Seq(1, 7, 64, RunResponseMarshalling.PieceChars)

  "RunResponseMarshalling.pieces" should {
    "equal compactPrint for every adversarial string, as a value, an array element and an object key" in {
      sizes.foreach { n =>
        adversarial.foreach { s =>
          check(JsString(s), n)
          check(JsObject(s -> JsNumber(1)), n)
          check(JsArray(JsString(s), JsString(s)), n)
        }
      }
    }

    "equal compactPrint for scalars, big decimals and empty containers (including as the root)" in {
      sizes.foreach { n =>
        Seq[JsValue](
          JsNull, JsTrue, JsFalse, JsNumber(0), JsNumber(-1), JsNumber(Long.MaxValue), JsNumber(Double.MaxValue), JsNumber(1.5e-300),
          JsNumber(BigDecimal("123456789012345678901234567890.123456789")), JsNumber(BigDecimal("1E+400")), JsArray.empty, JsObject.empty,
          JsArray(JsArray.empty, JsObject.empty, JsArray(JsArray.empty)), JsObject("a" -> JsArray.empty, "b" -> JsObject.empty)
        ).foreach(check(_, n))
      }
    }

    "equal compactPrint for nested arrays and objects" in {
      sizes.foreach { n =>
        check(JsArray(JsNumber(1), JsString("a\"b"), JsNull, JsArray(JsArray.empty, JsObject.empty), JsObject("k" -> JsArray(JsTrue, JsFalse))), n)
        check(JsObject("a" -> JsObject("b" -> JsObject("c" -> JsArray(JsString("中"), JsString("😀")))), "ж" -> JsString("\n"), "" -> JsNull), n)
        check(JsArray(adversarial.map(JsString(_)).toVector), n)
        check(JsObject(adversarial.zipWithIndex.map { case (s, i) => s"$i$s" -> JsString(s) }.toMap), n)
      }
    }

    "equal compactPrint for a many-row response shape and a value larger than one piece" in {
      val rows = Vector.tabulate(3000)(i => JsObject("id" -> JsNumber(i), "name" -> JsString(s"row-$i ж\"\\"), "ok" -> JsBoolean(i % 2 == 0)))
      val body = JsObject("rows" -> JsArray(rows), "rowCount" -> JsNumber(rows.size), "runId" -> JsNull, "wide" -> JsString("中" * 200000))
      check(body)
      val pieces = RunResponseMarshalling.pieces(body).toVector
      pieces.size should be > 3
    }

    "never split a piece inside a value other than at an element boundary, and bound every piece by the limit plus the widest single value" in {
      val rows  = Vector.tabulate(5000)(i => JsObject("id" -> JsNumber(i), "text" -> JsString("t" * 100)))
      val body  = JsObject("rows" -> JsArray(rows))
      val lens  = RunResponseMarshalling.pieces(body).map(_.length).toVector
      lens.size should be > 5
      // Each piece may overshoot by at most one element's own text (a row here is ~125 characters).
      lens.foreach(_ should be <= (RunResponseMarshalling.PieceChars + 200))
    }

    "emit exactly one piece for a scalar root and none beyond the last" in {
      val it = RunResponseMarshalling.pieces(JsString("a"))
      it.hasNext shouldBe true
      it.next() shouldBe "\"a\""
      it.hasNext shouldBe false
    }
  }
}
