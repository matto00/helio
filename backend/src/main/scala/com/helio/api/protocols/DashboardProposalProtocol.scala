package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Dashboard proposal types (HEL-223/225 apply-proposal contract) ───────────
//
// A proposal carries NO ids: applying it (POST /api/dashboards/apply-proposal)
// mints the dashboard + panels via the existing services. Data panels reference
// an existing pipeline-output DataType by id. The wire shape matches
// schemas/dashboard-proposal.schema.json.

final case class ProposalPanelLayout(x: Int, y: Int, w: Int, h: Int)

final case class ProposalPanel(
    title: String,
    `type`: String,
    dataTypeId: Option[String],
    fieldMapping: Option[JsObject],
    aggregation: Option[JsObject],
    content: Option[String],
    url: Option[String],
    orientation: Option[String],
    chartType: Option[String],
    xAxisLabel: Option[String],
    yAxisLabel: Option[String],
    seriesColors: Option[Vector[String]],
    label: Option[String],
    unit: Option[String],
    layout: Option[ProposalPanelLayout]
)

final case class DashboardProposal(dashboardName: String, panels: Vector[ProposalPanel])

trait DashboardProposalProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val proposalPanelLayoutFormat: RootJsonFormat[ProposalPanelLayout] = jsonFormat4(
    ProposalPanelLayout.apply
  )

  // Custom reader tolerates absent optional fields (spray-json omits `None` on
  // the wire, and a proposal from an agent frequently omits dataTypeId /
  // fieldMapping / layout for non-data panels).
  implicit val proposalPanelFormat: RootJsonFormat[ProposalPanel] = new RootJsonFormat[ProposalPanel] {
    def write(p: ProposalPanel): JsValue = {
      val fields = scala.collection.mutable.Map[String, JsValue](
        "title" -> JsString(p.title),
        "type"  -> JsString(p.`type`)
      )
      p.dataTypeId.foreach(v => fields("dataTypeId") = JsString(v))
      p.fieldMapping.foreach(v => fields("fieldMapping") = v)
      p.aggregation.foreach(v => fields("aggregation") = v)
      p.content.foreach(v => fields("content") = JsString(v))
      p.url.foreach(v => fields("url") = JsString(v))
      p.orientation.foreach(v => fields("orientation") = JsString(v))
      p.chartType.foreach(v => fields("chartType") = JsString(v))
      p.xAxisLabel.foreach(v => fields("xAxisLabel") = JsString(v))
      p.yAxisLabel.foreach(v => fields("yAxisLabel") = JsString(v))
      p.seriesColors.foreach(v => fields("seriesColors") = JsArray(v.map(JsString(_))))
      p.label.foreach(v => fields("label") = JsString(v))
      p.unit.foreach(v => fields("unit") = JsString(v))
      p.layout.foreach(v => fields("layout") = v.toJson)
      JsObject(fields.toMap)
    }

    def read(json: JsValue): ProposalPanel = {
      val obj = json.asJsObject
      ProposalPanel(
        title        = obj.fields.get("title").map(_.convertTo[String]).getOrElse(deserializationError("proposal panel 'title' is required")),
        `type`       = obj.fields.get("type").map(_.convertTo[String]).getOrElse(deserializationError("proposal panel 'type' is required")),
        dataTypeId   = obj.fields.get("dataTypeId").map(_.convertTo[String]),
        fieldMapping = obj.fields.get("fieldMapping").map(_.asJsObject),
        aggregation  = obj.fields.get("aggregation").map(_.asJsObject),
        content      = obj.fields.get("content").map(_.convertTo[String]),
        url          = obj.fields.get("url").map(_.convertTo[String]),
        orientation  = obj.fields.get("orientation").map(_.convertTo[String]),
        chartType    = obj.fields.get("chartType").map(_.convertTo[String]),
        xAxisLabel   = obj.fields.get("xAxisLabel").map(_.convertTo[String]),
        yAxisLabel   = obj.fields.get("yAxisLabel").map(_.convertTo[String]),
        seriesColors = obj.fields.get("seriesColors").map(_.convertTo[Vector[String]]),
        label        = obj.fields.get("label").map(_.convertTo[String]),
        unit         = obj.fields.get("unit").map(_.convertTo[String]),
        layout       = obj.fields.get("layout").map(_.convertTo[ProposalPanelLayout])
      )
    }
  }

  implicit val dashboardProposalFormat: RootJsonFormat[DashboardProposal] = jsonFormat2(
    DashboardProposal.apply
  )
}
