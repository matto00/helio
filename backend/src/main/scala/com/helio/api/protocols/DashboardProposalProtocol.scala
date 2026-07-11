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
        layout       = obj.fields.get("layout").map(_.convertTo[ProposalPanelLayout])
      )
    }
  }

  implicit val dashboardProposalFormat: RootJsonFormat[DashboardProposal] = jsonFormat2(
    DashboardProposal.apply
  )
}
