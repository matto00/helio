package com.helio.domain.history

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

class OutputSummaryReducerSpec extends AnyWordSpec with Matchers {

  private def summarize(rows: Vector[JsObject], kind: OutputKind, config: String = "{}"): JsObject =
    OutputSummaryReducer.summarize(rows, kind, config.parseJson.asJsObject)

  private def row(fields: (String, JsValue)*): JsObject = JsObject(fields: _*)

  "columns" should {

    "detect a numeric column that is absent from row 0, and count only coercible cells" in {
      val rows = Vector(row("a" -> JsString("x")), row("b" -> JsString("3")), row("b" -> JsNumber(4)), row("b" -> JsNull), row("b" -> JsString("  ")))
      val cols = summarize(rows, OutputKind.Table).fields("columns").asJsObject
      cols.fields.keySet shouldBe Set("b")
      cols.fields("b").asJsObject.fields("count") shouldBe JsNumber(2)
      cols.fields("b").asJsObject.fields("sum") shouldBe JsNumber(7)
      cols.fields("b").asJsObject.fields("min") shouldBe JsNumber(3)
      cols.fields("b").asJsObject.fields("max") shouldBe JsNumber(4)
    }

    "exclude a mixed text/number column" in {
      val rows = Vector(row("m" -> JsString("12")), row("m" -> JsString("abc")))
      summarize(rows, OutputKind.Table).fields("columns").asJsObject.fields shouldBe empty
    }

    "cap at 20 columns in name order and flag truncation" in {
      val rows  = Vector(JsObject((1 to 25).map(i => f"c$i%02d" -> JsNumber(i)).toMap))
      val s     = summarize(rows, OutputKind.Table)
      val names = s.fields("columns").asJsObject.fields.keys.toVector.sorted
      names shouldBe (1 to 20).map(i => f"c$i%02d").toVector
      s.fields("columnsTruncated") shouldBe JsTrue
    }

    "record rowCount and no metric/series for a table Output" in {
      val s = summarize(Vector(row("a" -> JsNumber(1))), OutputKind.Table)
      s.fields("rowCount") shouldBe JsNumber(1)
      s.fields("metric") shouldBe JsNull
      s.fields("series") shouldBe JsNull
      s.fields("v") shouldBe JsNumber(1)
    }
  }

  "metric" should {
    val rows = (1 to 300).map(i => row("amount" -> JsString(i.toString))).toVector

    "aggregate over ALL rows, not a first page" in {
      val m = summarize(rows, OutputKind.Metric, """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"}}""").fields("metric").asJsObject
      m.fields("value") shouldBe JsNumber(45150)
      m.fields("agg") shouldBe JsString("sum")
      m.fields("field") shouldBe JsString("amount")
    }

    "use the first row's coerced cell when no aggregation is set" in {
      val m = summarize(rows, OutputKind.Metric, """{"fieldMapping":{"value":"amount"}}""").fields("metric").asJsObject
      m.fields("value") shouldBe JsNumber(1)
      m.fields("agg") shouldBe JsNull
    }

    "resolve the field from fieldMapping.value when the mapping has several keys" in {
      val m = summarize(rows, OutputKind.Metric, """{"fieldMapping":{"value":"amount","label":"other"},"aggregation":{"agg":"max"}}""").fields("metric").asJsObject
      m.fields("field") shouldBe JsString("amount")
      m.fields("value") shouldBe JsNumber(300)
    }

    "be null when no value column can be resolved" in {
      summarize(rows, OutputKind.Metric, "{}").fields("metric") shouldBe JsNull
    }

    "map a non-finite sum to null" in {
      val big  = Vector(row("v" -> JsNumber(BigDecimal("1e308"))), row("v" -> JsNumber(BigDecimal("1e308"))))
      val m    = summarize(big, OutputKind.Metric, """{"fieldMapping":{"value":"v"},"aggregation":{"agg":"sum"}}""").fields("metric").asJsObject
      m.fields("value") shouldBe JsNull
    }
  }

  "series" should {
    val rows = (1 to 5).map(i => row("d" -> JsString(s"day$i"), "n" -> JsString(i.toString), "g" -> JsString(if (i % 2 == 0) "even" else "odd"))).toVector

    "emit one point per row in rows mode with the y coerced" in {
      val s = summarize(rows, OutputKind.Chart, """{"chartType":"line","fieldMapping":{"xAxis":"d","yAxis":"n"}}""").fields("series").asJsObject
      s.fields("mode") shouldBe JsString("rows")
      s.fields("points").asInstanceOf[JsArray].elements.head shouldBe JsArray(JsString("day1"), JsNumber(1))
      s.fields("totalPoints") shouldBe JsNumber(5)
      s.fields("downsampled") shouldBe JsFalse
    }

    "use groupAndAggregate in grouped mode" in {
      val cfg = """{"chartType":"bar","fieldMapping":{"xAxis":"g","yAxis":"n"},"aggregation":{"groupBy":"g","agg":"sum","yField":"n"}}"""
      val s   = summarize(rows, OutputKind.Chart, cfg).fields("series").asJsObject
      s.fields("mode") shouldBe JsString("grouped")
      s.fields("points") shouldBe JsArray(JsArray(JsString("even"), JsNumber(6)), JsArray(JsString("odd"), JsNumber(9)))
    }

    "ignore aggregation for a scatter chart" in {
      val cfg = """{"chartType":"scatter","fieldMapping":{"xAxis":"d","yAxis":"n"},"aggregation":{"groupBy":"g","agg":"sum","yField":"n"}}"""
      summarize(rows, OutputKind.Chart, cfg).fields("series").asJsObject.fields("mode") shouldBe JsString("rows")
    }

    "be null without an x/y mapping" in {
      summarize(rows, OutputKind.Chart, "{}").fields("series") shouldBe JsNull
    }

    "downsample to 200 points keeping first and last" in {
      val many = (0 until 1000).map(i => row("x" -> JsNumber(i), "y" -> JsNumber(i * 2))).toVector
      val s    = summarize(many, OutputKind.Chart, """{"fieldMapping":{"xAxis":"x","yAxis":"y"}}""").fields("series").asJsObject
      val pts  = s.fields("points").asInstanceOf[JsArray].elements
      pts.size shouldBe 200
      pts.head shouldBe JsArray(JsNumber(0), JsNumber(0))
      pts.last shouldBe JsArray(JsNumber(999), JsNumber(1998))
      s.fields("totalPoints") shouldBe JsNumber(1000)
      s.fields("downsampled") shouldBe JsTrue
    }

    "never cut a surrogate pair when truncating: an emoji straddling the 256 boundary is dropped whole" in {
      val straddling = "a" * 255 + "\uD83D\uDE00" + "tail"
      val pts = summarize(Vector(row("x" -> JsString(straddling), "y" -> JsNumber(1))), OutputKind.Chart, """{"fieldMapping":{"xAxis":"x","yAxis":"y"}}""")
        .fields("series").asJsObject.fields("points").asInstanceOf[JsArray]
      val x = pts.elements.head.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value
      x shouldBe "a" * 255
      Character.isHighSurrogate(x.last) shouldBe false
    }

    "truncate a long string x value to 256 characters" in {
      val long = Vector(row("x" -> JsString("a" * 300), "y" -> JsNumber(1)))
      val pts  = summarize(long, OutputKind.Chart, """{"fieldMapping":{"xAxis":"x","yAxis":"y"}}""").fields("series").asJsObject.fields("points").asInstanceOf[JsArray]
      pts.elements.head.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value should have length 256
    }
  }
}
