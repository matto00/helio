package com.helio.domain.panels

import com.helio.domain.model.{DashboardId, DataTypeId, OutputId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for an [[OutputPanel]] — a placement of one [[com.helio.
 *  domain.model.Output]] (HEL-904 task 3.6). Replaces the five "bound"
 *  configs ([[MetricPanelConfig]] / [[ChartPanelConfig]] / [[TablePanelConfig]] /
 *  [[CollectionPanelConfig]] / [[TimelinePanelConfig]]) — everything those
 *  configs used to carry (`fieldMapping`, `aggregation`, `chartOptions`,
 *  `columnWidths`/`density`/`columnOrder`, `timelineOptions`, `metricId`,
 *  `label`/`unit`) now lives on the Output itself (`outputs.config`,
 *  `OutputRepository`), not on the placement. A Panel placement owns only
 *  `outputId` plus the common identity/appearance fields every [[Panel]]
 *  subtype already carries (design.md "Panel remains the name for a
 *  placement").
 *
 *  Added additively in this task, alongside [[OutputBindingSpec]]: not yet
 *  registered in [[Panel.Registry]], and the five bound subtypes it replaces
 *  are not yet deleted. The full cutover (Registry swap, deleting
 *  `MetricPanel`/`ChartPanel`/`TablePanel`/`CollectionPanel`/`TimelinePanel`,
 *  rewriting `PanelRepository`/`PanelRowMapper`/`PanelProtocol`/
 *  `PanelService` onto `output_id` instead of the 20 typed-config columns)
 *  is the remainder of task 3.6, left for the next increment of this same
 *  task so the tree keeps compiling at every step. */
final case class OutputPanelConfig(outputId: OutputId)

object OutputPanelConfig {
  val Empty: OutputPanelConfig = OutputPanelConfig(OutputId(""))

  implicit val format: RootJsonFormat[OutputPanelConfig] = jsonFormat1(OutputPanelConfig.apply)

  def decode(json: JsValue): OutputPanelConfig = json match {
    case JsObject(fields) =>
      val outputId = fields.get("outputId") match {
        case Some(JsString(s)) => OutputId(s)
        case _                 => OutputId("")
      }
      OutputPanelConfig(outputId)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): OutputPanelConfig = decode(json)

  final case class Patch(outputId: Option[OutputId]) {
    def isEmpty: Boolean = outputId.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val outputId = fields.get("outputId") match {
          case None              => None
          case Some(JsString(s)) => Some(OutputId(s))
          case Some(x)           => deserializationError(s"outputId must be a string, got $x")
        }
        Patch(outputId)
      case _ => Empty
    }
  }
}

final case class OutputPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: OutputPanelConfig
) extends Panel {
  val kind: String = OutputPanel.Kind

  // The `Panel` trait's `dataTypeId: Option[DataTypeId]` accessor predates
  // the Output model and has no OutputPanel-side meaning — always `None`
  // here. The trait method itself is retargeted to `outputId` in the
  // remainder of this task, once every other subtype (the content kinds)
  // and every consumer of this accessor is rewired in the same pass; kept
  // as a real, if vestigial, override for now so this file alone compiles
  // against the trait unchanged.
  def dataTypeId: Option[DataTypeId] = None

  def outputId: Option[OutputId] =
    if (config.outputId.value.isEmpty) None else Some(config.outputId)

  def fieldMapping: Option[JsValue] = None

  def validateConfig: Either[String, Unit] =
    if (config.outputId.value.isEmpty) Left("outputId is required") else Right(())

  // No query-building path: an OutputPanel's data comes from
  // `NodeSnapshotRepository`/`OutputRepository` keyed by `outputId`, not
  // the old `DataTypeId`-keyed `PanelQuery`/`GET /api/panels/:id/query`
  // path (removed outright per design.md — HEL-292 panel-level aggregation
  // and the `/query` endpoint are retired, not carried over to Outputs).
  def buildQuery: Option[PanelQuery] = None

  def withBindingCleared: Panel = copy(config = OutputPanelConfig.Empty)

  def applyPatch(patch: OutputPanelConfig.Patch): OutputPanel =
    copy(config = OutputPanelConfig(outputId = patch.outputId.getOrElse(config.outputId)))
}

object OutputPanel {
  val Kind: String = "output"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = OutputPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[OutputPanelConfig].toJson
  }
}
