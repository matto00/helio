package com.helio.api.protocols.proposals

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// A proposal carries NO ids: applying it (POST /api/dashboards/apply-proposal)
// mints the dashboard + panels via the existing services. Data panels reference
// an existing Output by id. The wire shape matches
// schemas/dashboards/dashboard-proposal.schema.json.

final case class ProposalPanelLayout(x: Int, y: Int, w: Int, h: Int)

/** HEL-1193: an output panel's control as a proposal declares it. Same fields as
 *  `OutputControlSpec` except `id` is optional (a proposal carries no ids; `ProposalPanelSupport`
 *  mints one when the panel is built) and `label` defaults to the column name. Eligibility is NOT
 *  decided here — `ProposalPanelSupport` hands the built specs to `OutputControlsValidator`. */
final case class ProposalControl(
    id: Option[String],
    kind: String,
    column: String,
    label: Option[String],
    defaultValue: Option[JsValue]
)

final case class ProposalPanel(
    title: String,
    `type`: String,
    outputId: Option[String],
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
    // HEL-321: flat timeline `sort` (`asc`/`desc`) derived into the created
    // panel's `config.timelineOptions.sort` by `DashboardProposalService`, at
    // flat-binding parity with metric's `label`/`unit`.
    sort: Option[String],
    layout: Option[ProposalPanelLayout],
    // HEL-316: generic passthrough merged (over the flat-field-derived config)
    // by `DashboardProposalService.buildCreateRequest`, mirroring the MCP
    // `create_panel` `config` passthrough. Makes every v1.5 panel-config
    // surface (collection baseType/layout, chart chartOptions, table
    // density/columnOrder) expressible via a proposal without a new flat
    // field per surface. See openspec/changes/mcp-proposal-panel-parity.
    config: Option[JsObject],
    // HEL-1193: first-class output-panel controls; merged into the built panel's
    // `config.controls` by `ProposalPanelSupport.buildCreateRequest`.
    controls: Option[Vector[ProposalControl]] = None,
    // HEL-1148: a source-bound panel kind's (today: `form`) dataset-source binding, the source twin
    // of `outputId`. Authoritative over `config.dataSourceId` (re-applied after the config merge by
    // `ProposalPanelSupport.buildCreateRequest`); required on a `form`, rejected on any other kind.
    dataSourceId: Option[String] = None
)

final case class DashboardProposal(dashboardName: String, panels: Vector[ProposalPanel])

// HEL-363: body of `PUT /api/dashboards/:id/contents`. Reuses `ProposalPanel`
// verbatim (design.md D2) — the target dashboard's id comes from the URL
// path, not the body, so there is no `dashboardName` field here.
final case class ReplaceDashboardContentsRequest(panels: Vector[ProposalPanel])

trait DashboardProposalProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val proposalPanelLayoutFormat: RootJsonFormat[ProposalPanelLayout] = jsonFormat4(
    ProposalPanelLayout.apply
  )

  private val ProposalControlKeys = Set("id", "kind", "column", "label", "defaultValue")

  // Strict like OutputControlSpec's own reader: an unknown key is a decode failure, never a silent drop.
  implicit val proposalControlFormat: RootJsonFormat[ProposalControl] = new RootJsonFormat[ProposalControl] {
    def write(c: ProposalControl): JsValue = {
      val fields = scala.collection.mutable.Map[String, JsValue]("kind" -> JsString(c.kind), "column" -> JsString(c.column))
      c.id.foreach(v => fields("id") = JsString(v))
      c.label.foreach(v => fields("label") = JsString(v))
      c.defaultValue.foreach(v => fields("defaultValue") = v)
      JsObject(fields.toMap)
    }

    def read(json: JsValue): ProposalControl = json match {
      case JsObject(fields) =>
        val unknown = fields.keySet -- ProposalControlKeys
        if (unknown.nonEmpty)
          deserializationError(s"Unrecognized control attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")
        def str(key: String): Option[String] = fields.get(key).map {
          case JsString(s) => s
          case other       => deserializationError(s"control '$key' must be a string, got $other")
        }
        ProposalControl(
          id           = str("id"),
          kind         = str("kind").getOrElse(deserializationError("control 'kind' is required")),
          column       = str("column").getOrElse(deserializationError("control 'column' is required")),
          label        = str("label"),
          defaultValue = fields.get("defaultValue")
        )
      case other => deserializationError(s"control must be an object, got $other")
    }
  }

  // Custom reader tolerates absent optional fields (spray-json omits `None` on
  // the wire, and a proposal from an agent frequently omits outputId /
  // fieldMapping / layout for non-data panels).
  implicit val proposalPanelFormat: RootJsonFormat[ProposalPanel] = new RootJsonFormat[ProposalPanel] {
    def write(p: ProposalPanel): JsValue = {
      val fields = scala.collection.mutable.Map[String, JsValue](
        "title" -> JsString(p.title),
        "type"  -> JsString(p.`type`)
      )
      p.outputId.foreach(v => fields("outputId") = JsString(v))
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
      p.sort.foreach(v => fields("sort") = JsString(v))
      p.layout.foreach(v => fields("layout") = v.toJson)
      p.config.foreach(v => fields("config") = v)
      p.controls.foreach(v => fields("controls") = JsArray(v.map(_.toJson)))
      p.dataSourceId.foreach(v => fields("dataSourceId") = JsString(v))
      JsObject(fields.toMap)
    }

    def read(json: JsValue): ProposalPanel = {
      val obj = json.asJsObject
      ProposalPanel(
        title        = obj.fields.get("title").map(_.convertTo[String]).getOrElse(deserializationError("proposal panel 'title' is required")),
        `type`       = obj.fields.get("type").map(_.convertTo[String]).getOrElse(deserializationError("proposal panel 'type' is required")),
        outputId   = obj.fields.get("outputId").map(_.convertTo[String]),
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
        sort         = obj.fields.get("sort").map(_.convertTo[String]),
        layout       = obj.fields.get("layout").map(_.convertTo[ProposalPanelLayout]),
        config       = obj.fields.get("config").map(_.asJsObject),
        controls     = obj.fields.get("controls").map(_.convertTo[Vector[ProposalControl]]),
        dataSourceId = obj.fields.get("dataSourceId").map(_.convertTo[String])
      )
    }
  }

  implicit val dashboardProposalFormat: RootJsonFormat[DashboardProposal] = jsonFormat2(
    DashboardProposal.apply
  )

  implicit val replaceDashboardContentsRequestFormat: RootJsonFormat[ReplaceDashboardContentsRequest] =
    jsonFormat1(ReplaceDashboardContentsRequest.apply)
}
