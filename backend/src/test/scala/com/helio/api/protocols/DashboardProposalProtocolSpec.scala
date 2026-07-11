package com.helio.api.protocols

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Unit tests for [[ProposalPanel]]'s custom reader/writer — in particular
 *  the HEL-292 `aggregation: Option[JsObject]` field, which follows the same
 *  absent-field-tolerant pattern as `dataTypeId`/`fieldMapping`/`layout`. */
class DashboardProposalProtocolSpec extends AnyWordSpec with Matchers with DashboardProposalProtocol {

  private def panel(
      aggregation: Option[JsObject] = None
  ): ProposalPanel = ProposalPanel(
    title        = "Avg rating",
    `type`       = "metric",
    dataTypeId   = Some("dt-1"),
    fieldMapping = Some(JsObject("label" -> JsString("title"))),
    aggregation  = aggregation,
    layout       = None
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
}
