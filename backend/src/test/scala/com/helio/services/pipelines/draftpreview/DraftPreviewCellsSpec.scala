package com.helio.services.pipelines.draftpreview

import com.helio.domain.engine.PipelineRowJson.Row
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1630 task 1.2: the cell codec is lossless in both directions and refuses what it cannot carry. */
class DraftPreviewCellsSpec extends AnyWordSpec with Matchers {

  private val row: Row = Map(
    "i" -> 7, "big" -> 9007199254740993L, "d" -> 1.5, "nan" -> Double.NaN, "pinf" -> Double.PositiveInfinity,
    "ninf" -> Double.NegativeInfinity, "nz" -> -0.0, "s" -> "text", "b" -> true, "z" -> null, "intMax" -> Int.MaxValue, "longMin" -> Long.MinValue
  )

  "encode then decode" should {
    "round-trip every value class with its exact type, not just its value" in {
      val back = DraftPreviewCells.decodeRow(DraftPreviewCells.encode(row)).get
      back.keySet shouldBe row.keySet
      back("i") shouldBe a[java.lang.Integer]
      back("big") shouldBe a[java.lang.Long]
      back("big") shouldBe 9007199254740993L
      back("d") shouldBe a[java.lang.Double]
      back("nan").asInstanceOf[Double].isNaN shouldBe true
      back("pinf") shouldBe Double.PositiveInfinity
      back("ninf") shouldBe Double.NegativeInfinity
      java.lang.Double.doubleToRawLongBits(back("nz").asInstanceOf[Double]) shouldBe java.lang.Double.doubleToRawLongBits(-0.0)
      back("z") shouldBe (null: Any)
      back("intMax") shouldBe Int.MaxValue
      back("longMin") shouldBe Long.MinValue
    }

    "decode a plain JSON number to a Double, an integral one included" in {
      DraftPreviewCells.decodeValue(JsNumber(5)) shouldBe Some(5.0)
      DraftPreviewCells.decodeValue(JsNumber(5)).get shouldBe a[java.lang.Double]
    }
  }

  "decoding" should {
    "refuse a nested object or array, an out-of-range $int, a malformed $long or $double, and an object with extra keys" in {
      val bad: Seq[JsValue] = Seq(
        JsObject("a" -> JsNumber(1)), JsArray(JsNumber(1)), JsObject("$int" -> JsNumber(Long.MaxValue)), JsObject("$int" -> JsNumber(1.5)),
        JsObject("$long" -> JsString("12x")), JsObject("$long" -> JsNumber(5)), JsObject("$double" -> JsString("bogus")),
        JsObject("$int" -> JsNumber(1), "x" -> JsNumber(2))
      )
      bad.foreach(v => withClue(v.compactPrint)(DraftPreviewCells.decodeValue(v) shouldBe None))
    }
  }

  "unencodable" should {
    "accept the classes the wire carries and name any other as not previewable" in {
      DraftPreviewCells.unencodable(Seq(row)) shouldBe None
      DraftPreviewCells.unencodable(Seq(Map("a" -> BigDecimal(1)))) shouldBe Some("value type not previewable")
      DraftPreviewCells.unencodable(Seq(Map("a" -> 1.5f))) shouldBe Some("value type not previewable")
      DraftPreviewCells.unencodable(Seq(Map("a" -> Map("nested" -> 1)))) shouldBe Some("value type not previewable")
      DraftPreviewCells.unencodable(Seq(Map("a" -> Seq(1)))) shouldBe Some("value type not previewable")
    }
  }
}
