package com.helio.api.protocols

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Unit tests for [[ProposalPanel]]'s custom reader/writer — in particular
 *  the HEL-292 `aggregation: Option[JsObject]` field and the HEL-293
 *  content/url/orientation/chart-appearance/metric-literal fields, all of
 *  which follow the same absent-field-tolerant pattern as
 *  `dataTypeId`/`fieldMapping`/`layout`. */
class DashboardProposalProtocolSpec extends AnyWordSpec with Matchers with DashboardProposalProtocol {

  private def panel(
      aggregation: Option[JsObject] = None,
      content: Option[String] = None,
      url: Option[String] = None,
      orientation: Option[String] = None,
      chartType: Option[String] = None,
      xAxisLabel: Option[String] = None,
      yAxisLabel: Option[String] = None,
      seriesColors: Option[Vector[String]] = None,
      label: Option[String] = None,
      unit: Option[String] = None,
      config: Option[JsObject] = None
  ): ProposalPanel = ProposalPanel(
    title        = "Avg rating",
    `type`       = "metric",
    dataTypeId   = Some("dt-1"),
    fieldMapping = Some(JsObject("label" -> JsString("title"))),
    aggregation  = aggregation,
    content      = content,
    url          = url,
    orientation  = orientation,
    chartType    = chartType,
    xAxisLabel   = xAxisLabel,
    yAxisLabel   = yAxisLabel,
    seriesColors = seriesColors,
    label        = label,
    unit         = unit,
    layout       = None,
    config       = config
  )

  "ProposalPanel.write" should {
    "omit the aggregation key when absent" in {
      val json = panel(None).toJson.asJsObject
      json.fields.keySet should not contain "aggregation"
    }

    "emit the aggregation object when present" in {
      val agg  = JsObject("value" -> JsString("rating"), "agg" -> JsString("avg"))
      val json = panel(Some(agg)).toJson.asJsObject
      json.fields("aggregation") shouldBe agg
    }
  }

  "ProposalPanel.read" should {
    "tolerate an absent aggregation field" in {
      val json = JsObject(
        "title" -> JsString("X"),
        "type"  -> JsString("metric")
      )
      json.convertTo[ProposalPanel].aggregation shouldBe None
    }

    "read a present aggregation object" in {
      val agg  = JsObject("groupBy" -> JsString("year"), "agg" -> JsString("avg"), "yField" -> JsString("rating"))
      val json = JsObject(
        "title"       -> JsString("X"),
        "type"        -> JsString("chart"),
        "aggregation" -> agg
      )
      json.convertTo[ProposalPanel].aggregation shouldBe Some(agg)
    }

    "round-trip a metric aggregation spec" in {
      val agg = JsObject("value" -> JsString("rating"), "agg" -> JsString("avg"))
      val p   = panel(Some(agg))
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }
  }

  // ── HEL-293: content/url/orientation/chart-appearance/metric-literal ──────

  "ProposalPanel.write/read" should {
    "omit the new HEL-293 keys when absent" in {
      val json = panel().toJson.asJsObject
      val newKeys = Set(
        "content", "url", "orientation", "chartType", "xAxisLabel", "yAxisLabel", "seriesColors",
        "label", "unit"
      )
      json.fields.keySet.intersect(newKeys) shouldBe empty
    }

    "round-trip content (text/markdown initial body)" in {
      val p = panel(content = Some("# Roadmap\n\nQ3 goals"))
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }

    "round-trip url (image initial URL)" in {
      val p = panel(url = Some("https://example.com/chart.png"))
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }

    "round-trip orientation (divider initial orientation)" in {
      val p = panel(orientation = Some("vertical"))
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }

    "round-trip chart appearance fields" in {
      val p = panel(
        chartType    = Some("bar"),
        xAxisLabel   = Some("Year"),
        yAxisLabel   = Some("Revenue"),
        seriesColors = Some(Vector("#111111", "#222222"))
      )
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }

    "round-trip metric literal label/unit" in {
      val p = panel(label = Some("Total Revenue"), unit = Some("USD"))
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }

    "tolerate an absent seriesColors field" in {
      val json = JsObject("title" -> JsString("X"), "type" -> JsString("chart"))
      json.convertTo[ProposalPanel].seriesColors shouldBe None
    }

    "read a present seriesColors array" in {
      val json = JsObject(
        "title"        -> JsString("X"),
        "type"         -> JsString("chart"),
        "seriesColors" -> JsArray(JsString("#abc123"), JsString("#def456"))
      )
      json.convertTo[ProposalPanel].seriesColors shouldBe Some(Vector("#abc123", "#def456"))
    }
  }

  // ── HEL-316: generic `config` passthrough ─────────────────────────────────

  "ProposalPanel.write/read — config" should {
    "omit the config key when absent" in {
      val json = panel().toJson.asJsObject
      json.fields.keySet should not contain "config"
    }

    "emit the config object when present" in {
      val config = JsObject("chartOptions" -> JsObject("line" -> JsObject("smooth" -> JsBoolean(true))))
      val json   = panel(config = Some(config)).toJson.asJsObject
      json.fields("config") shouldBe config
    }

    "tolerate an absent config field" in {
      val json = JsObject("title" -> JsString("X"), "type" -> JsString("metric"))
      json.convertTo[ProposalPanel].config shouldBe None
    }

    "round-trip a config object" in {
      val config = JsObject("baseType" -> JsString("metric"), "layout" -> JsString("list"))
      val p      = panel(config = Some(config))
      p.toJson.convertTo[ProposalPanel] shouldBe p
    }
  }
}
