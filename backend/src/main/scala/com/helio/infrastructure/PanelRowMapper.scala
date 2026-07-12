package com.helio.infrastructure

import com.helio.api.protocols.PanelProtocol
import com.helio.domain._
import com.helio.domain.panels._
import spray.json._

import java.util.UUID

/** Row↔domain dispatch for the `panels` table. Lives outside [[PanelRepository]]
 *  so [[DashboardRepository]]'s snapshot / duplicate paths (which also touch
 *  `panels` rows) consume the same typed dispatch instead of duplicating it.
 *
 *  Cycle 1 read-path tolerance (CS2c-3a cycle-2 lesson): rows persisted with
 *  missing/null subtype columns (e.g. a `type='metric'` row with
 *  `type_id IS NULL`) decode to the subtype's `Empty` config rather than
 *  throwing — `listByDashboard` returns 200, and the UI surfaces a "no data
 *  type bound" empty state. */
object PanelRowMapper extends PanelProtocol {

  def rowToDomain(row: PanelRepository.PanelRow): Panel = {
    val id          = PanelId(row.id)
    val dashboardId = DashboardId(row.dashboardId)
    val meta        = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated)
    val appearance  = row.appearance
    val ownerId     = UserId(row.ownerId.toString)

    row.panelType match {
      case MetricPanel.Kind =>
        MetricPanel(id, dashboardId, row.title, meta, appearance, ownerId, metricConfig(row))
      case ChartPanel.Kind =>
        ChartPanel(id, dashboardId, row.title, meta, appearance, ownerId, chartConfig(row))
      case TablePanel.Kind =>
        TablePanel(id, dashboardId, row.title, meta, appearance, ownerId, tableConfig(row))
      case TextPanel.Kind =>
        TextPanel(id, dashboardId, row.title, meta, appearance, ownerId, textConfig(row))
      case MarkdownPanel.Kind =>
        MarkdownPanel(id, dashboardId, row.title, meta, appearance, ownerId, markdownConfig(row))
      case ImagePanel.Kind =>
        ImagePanel(id, dashboardId, row.title, meta, appearance, ownerId, imageConfig(row))
      case DividerPanel.Kind =>
        DividerPanel(id, dashboardId, row.title, meta, appearance, ownerId, dividerConfig(row))
      case _ =>
        // Unknown kind on disk — fall back to PanelType.Default (Metric) per the
        // pre-CS2c-3b behaviour. The wide-flat case class did this via
        // `PanelType.fromString(...).getOrElse(PanelType.Default)`.
        MetricPanel(id, dashboardId, row.title, meta, appearance, ownerId, metricConfig(row))
    }
  }

  def domainToRow(p: Panel): PanelRepository.PanelRow = {
    val base = PanelRepository.PanelRow(
      id           = p.id.value,
      dashboardId  = p.dashboardId.value,
      title        = p.title,
      createdBy    = p.meta.createdBy,
      createdAt    = p.meta.createdAt,
      lastUpdated  = p.meta.lastUpdated,
      appearance   = p.appearance,
      panelType    = p.kind,
      typeId       = None,
      fieldMapping = None,
      ownerId      = UUID.fromString(p.ownerId.value),
      content      = None,
      imageUrl     = None,
      imageFit     = None,
      dividerOrientation = None,
      dividerWeight      = None,
      dividerColor       = None,
      aggregation        = None,
      metricLabel        = None,
      metricUnit         = None,
      columnWidths       = None
    )

    p match {
      case mp: MetricPanel    => base.copy(typeId = optString(mp.config.dataTypeId.value), fieldMapping = jsObjectColumn(mp.config.fieldMapping), aggregation = mp.config.aggregation.map(_.compactPrint), metricLabel = mp.config.label, metricUnit = mp.config.unit)
      case cp: ChartPanel     => base.copy(typeId = optString(cp.config.dataTypeId.value), fieldMapping = jsObjectColumn(cp.config.fieldMapping), aggregation = cp.config.aggregation.map(_.compactPrint))
      case tp: TablePanel     => base.copy(typeId = optString(tp.config.dataTypeId.value), fieldMapping = jsObjectColumn(tp.config.fieldMapping), columnWidths = columnWidthsColumn(tp.config.columnWidths))
      case t: TextPanel       => base.copy(content = optString(t.config.content), typeId = optString(t.config.dataTypeId.value), fieldMapping = jsObjectColumn(t.config.fieldMapping))
      case m: MarkdownPanel   => base.copy(content = optString(m.config.content))
      case i: ImagePanel      => base.copy(imageUrl = optString(i.config.imageUrl), imageFit = Some(i.config.imageFit))
      case d: DividerPanel    => base.copy(dividerOrientation = Some(d.config.orientation), dividerWeight = d.config.weight, dividerColor = d.config.color)
      case _                  => base
    }
  }

  // ── Per-subtype config builders from row columns ───────────────────────────

  private def metricConfig(row: PanelRepository.PanelRow): MetricPanelConfig =
    MetricPanelConfig(
      dataTypeId   = row.typeId.fold(DataTypeId(""))(DataTypeId(_)),
      fieldMapping = row.fieldMapping.flatMap(parseJsObject).getOrElse(JsObject.empty),
      aggregation  = row.aggregation.flatMap(parseJsObject),
      label        = row.metricLabel,
      unit         = row.metricUnit
    )

  private def chartConfig(row: PanelRepository.PanelRow): ChartPanelConfig =
    ChartPanelConfig(
      dataTypeId   = row.typeId.fold(DataTypeId(""))(DataTypeId(_)),
      fieldMapping = row.fieldMapping.flatMap(parseJsObject).getOrElse(JsObject.empty),
      aggregation  = row.aggregation.flatMap(parseJsObject)
    )

  private def tableConfig(row: PanelRepository.PanelRow): TablePanelConfig =
    TablePanelConfig(
      dataTypeId   = row.typeId.fold(DataTypeId(""))(DataTypeId(_)),
      fieldMapping = row.fieldMapping.flatMap(parseJsObject).getOrElse(JsObject.empty),
      columnWidths = row.columnWidths.flatMap(parseColumnWidths).getOrElse(Map.empty)
    )

  private def textConfig(row: PanelRepository.PanelRow): TextPanelConfig =
    TextPanelConfig(
      content      = row.content.getOrElse(""),
      dataTypeId   = row.typeId.fold(DataTypeId(""))(DataTypeId(_)),
      fieldMapping = row.fieldMapping.flatMap(parseJsObject).getOrElse(JsObject.empty)
    )

  private def markdownConfig(row: PanelRepository.PanelRow): MarkdownPanelConfig =
    MarkdownPanelConfig(content = row.content.getOrElse(""))

  private def imageConfig(row: PanelRepository.PanelRow): ImagePanelConfig =
    ImagePanelConfig(
      imageUrl = row.imageUrl.getOrElse(""),
      imageFit = row.imageFit.getOrElse(ImagePanelConfig.DefaultFit)
    )

  private def dividerConfig(row: PanelRepository.PanelRow): DividerPanelConfig =
    DividerPanelConfig(
      orientation = row.dividerOrientation.getOrElse(DividerPanelConfig.DefaultOrientation),
      weight      = row.dividerWeight,
      color       = row.dividerColor
    )

  // ── Helpers ────────────────────────────────────────────────────────────────

  private def optString(s: String): Option[String] =
    if (s.isEmpty) None else Some(s)

  private def jsObjectColumn(o: JsObject): Option[String] =
    if (o.fields.isEmpty) None else Some(o.compactPrint)

  private def parseJsObject(raw: String): Option[JsObject] =
    scala.util.Try(raw.parseJson).toOption.collect { case o: JsObject => o }

  private def columnWidthsColumn(widths: Map[String, Int]): Option[String] =
    if (widths.isEmpty) None else Some(JsObject(widths.view.mapValues(JsNumber(_)).toMap).compactPrint)

  private def parseColumnWidths(raw: String): Option[Map[String, Int]] =
    scala.util.Try(raw.parseJson).toOption.collect { case o: JsObject =>
      o.fields.collect { case (key, JsNumber(n)) => key -> n.toInt }
    }
}
