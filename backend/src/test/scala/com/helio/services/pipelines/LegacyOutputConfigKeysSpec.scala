package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1409: unit coverage of the V117 mirror. Drift against V117's real SQL is pinned separately by
 *  `LegacyOutputConfigKeysParitySpec`. */
class LegacyOutputConfigKeysSpec extends AnyWordSpec with Matchers {

  private def j(s: String): JsObject = s.parseJson.asJsObject
  private def n(kind: OutputKind, cfg: String): JsObject = LegacyOutputConfigKeys.normalise(kind, j(cfg))

  "LegacyOutputConfigKeys.normalise" should {
    "rename each dead key to its live key on the kind that has one" in {
      n(OutputKind.Metric, """{"metricLabel":"L","metricUnit":"U"}""") shouldBe j("""{"label":"L","unit":"U"}""")
      n(OutputKind.Chart, """{"chartAnnotation":"A"}""") shouldBe j("""{"annotation":"A"}""")
      n(OutputKind.Collection, """{"collectionOptions":{"layout":"grid","baseType":"x"}}""") shouldBe j("""{"layout":"grid"}""")
      n(OutputKind.Timeline, """{"timelineOptions":{"sort":"asc","other":1}}""") shouldBe j("""{"sort":"asc"}""")
    }
    "drop keys with no live equivalent on every kind" in {
      val dead = """{"columnWidths":{},"tableDensity":"x","legend":1,"tooltip":1,"seriesColors":[],"axisLabels":{},"keep":true}"""
      for (kind <- Seq(OutputKind.Table, OutputKind.Metric, OutputKind.Chart, OutputKind.Collection, OutputKind.Timeline, OutputKind.Markdown))
        n(kind, dead) shouldBe j("""{"keep":true}""")
    }
    "drop a rename source on the wrong kind without renaming" in {
      n(OutputKind.Chart, """{"metricLabel":"L"}""") shouldBe j("{}")
      n(OutputKind.Table, """{"timelineOptions":{"sort":"asc"}}""") shouldBe j("{}")
    }
    "drop null, wrong-typed and invalid-enum values without renaming" in {
      n(OutputKind.Metric, """{"metricLabel":null,"metricUnit":5}""") shouldBe j("{}")
      n(OutputKind.Timeline, """{"timelineOptions":{"sort":"up"}}""") shouldBe j("{}")
      n(OutputKind.Timeline, """{"timelineOptions":{}}""") shouldBe j("{}")
      n(OutputKind.Collection, """{"collectionOptions":"grid"}""") shouldBe j("{}")
    }
    "never overwrite a non-null live key, but replace a JSON-null one" in {
      n(OutputKind.Metric, """{"label":"Live","metricLabel":"Old"}""") shouldBe j("""{"label":"Live"}""")
      n(OutputKind.Metric, """{"label":null,"metricLabel":"Old"}""") shouldBe j("""{"label":"Old"}""")
    }
    "keep format on metric/collection, columnOrder on table, chartOptions on chart; drop them elsewhere" in {
      n(OutputKind.Metric, """{"format":{"a":1}}""") shouldBe j("""{"format":{"a":1}}""")
      n(OutputKind.Collection, """{"format":{"a":1}}""") shouldBe j("""{"format":{"a":1}}""")
      n(OutputKind.Chart, """{"format":{"a":1}}""") shouldBe j("{}")
      n(OutputKind.Table, """{"columnOrder":["a"]}""") shouldBe j("""{"columnOrder":["a"]}""")
      n(OutputKind.Metric, """{"columnOrder":["a"]}""") shouldBe j("{}")
      n(OutputKind.Chart, """{"chartOptions":{}}""") shouldBe j("""{"chartOptions":{}}""")
      n(OutputKind.Table, """{"chartOptions":{}}""") shouldBe j("{}")
    }
    "leave a config with no dead keys unchanged" in {
      val cfg = j("""{"label":"x","aggregation":"sum","fieldMapping":{"a":"b"}}""")
      LegacyOutputConfigKeys.normalise(OutputKind.Metric, cfg) shouldBe cfg
    }
  }
}
