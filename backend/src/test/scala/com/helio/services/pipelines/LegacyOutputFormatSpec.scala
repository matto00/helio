package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1441: unit coverage of the V118 mirror. Drift against V118's real SQL is pinned separately by
 *  `LegacyOutputFormatParitySpec`. */
class LegacyOutputFormatSpec extends AnyWordSpec with Matchers {

  private def j(s: String): JsObject = s.parseJson.asJsObject
  private def n(kind: OutputKind, cfg: String): JsObject = LegacyOutputFormat.normalise(kind, j(cfg))
  private def metric(cfg: String): JsObject = n(OutputKind.Metric, cfg)

  "LegacyOutputFormat.normalise" should {
    "map decimals 0 to integer, whether written 0 or 0.0" in {
      metric("""{"format":{"decimals":0}}""") shouldBe j("""{"format":"integer"}""")
      metric("""{"format":{"decimals":0.0}}""") shouldBe j("""{"format":"integer"}""")
    }
    "map a $ prefix with absent or 2 decimals to currency and consume the prefix" in {
      metric("""{"format":{"prefix":"$"}}""") shouldBe j("""{"format":"currency"}""")
      metric("""{"format":{"prefix":" $\t","decimals":2.0}}""") shouldBe j("""{"format":"currency"}""")
    }
    "map a $ prefix with other decimals to number and keep the prefix as unit text" in {
      metric("""{"format":{"prefix":"$","decimals":1}}""") shouldBe j("""{"format":"number","unit":"$"}""")
    }
    "map everything else, including {}, to number" in {
      metric("""{"format":{}}""") shouldBe j("""{"format":"number"}""")
      metric("""{"format":{"decimals":-1,"prefix":"USD"}}""") shouldBe j("""{"format":"number","unit":"USD"}""")
    }
    "join prefix, unit and suffix with single spaces into the metric unit" in {
      metric("""{"format":{"prefix":"USD","unit":"kg","suffix":"/mo"}}""") shouldBe j("""{"format":"number","unit":"USD kg /mo"}""")
    }
    "trim only space, tab, CR and LF" in {
      metric("""{"format":{"unit":" \r\nkg\t "}}""") shouldBe j("""{"format":"number","unit":"kg"}""")
      metric("{\"format\":{\"prefix\":\"\\u000b$\"}}") shouldBe j("{\"format\":\"number\",\"unit\":\"\\u000b$\"}")
    }
    "write unit over a JSON-null live unit but never over a non-null one of any type" in {
      metric("""{"unit":null,"format":{"unit":"kg"}}""") shouldBe j("""{"unit":"kg","format":"number"}""")
      for (live <- Seq("\"live\"", "5", "true", "{}"))
        metric(s"""{"unit":$live,"format":{"unit":"kg"}}""") shouldBe j(s"""{"unit":$live,"format":"number"}""")
    }
    "write no unit when there is no text or the text is not a string" in {
      metric("""{"format":{"prefix":"","unit":3}}""") shouldBe j("""{"format":"number"}""")
    }
    "never give a collection a unit" in {
      n(OutputKind.Collection, """{"format":{"unit":"kg","decimals":0}}""") shouldBe j("""{"format":"integer"}""")
    }
    "leave string formats, absent formats and other kinds unchanged" in {
      metric("""{"format":"percent"}""") shouldBe j("""{"format":"percent"}""")
      metric("""{"label":"x"}""") shouldBe j("""{"label":"x"}""")
      n(OutputKind.Chart, """{"format":{"unit":"kg"}}""") shouldBe j("""{"format":{"unit":"kg"}}""")
    }
  }

  "LegacyOutputFormat.normaliseRestored" should {
    "apply V117 first, so a renamed metricUnit shadows the format's unit text" in {
      LegacyOutputFormat.normaliseRestored(OutputKind.Metric, j("""{"metricUnit":"USD","format":{"unit":"kg"}}""")) shouldBe
        j("""{"unit":"USD","format":"number"}""")
    }
  }
}
