package com.helio.infrastructure.persistence.panels

import com.helio.api.protocols.panels.PanelProtocol
import com.helio.domain.model._
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

    // HEL-904 task 3.6 (collapse complete): an `output`-kind row decodes on
    // `row.kind`; every pre-existing bound (metric/chart/table/collection/
    // timeline) row was backfilled to `kind = 'output'` by the V94 migration
    // (task 2.5) before this collapse landed, so `row.panelType`'s legacy
    // bound-kind values are no longer live decode targets — only
    // text/markdown/image/divider still use `row.panelType`. A row matching
    // neither falls back to `PanelType.Default` (Output) per the
    // pre-CS2c-3b unknown-kind behaviour.
    if (row.kind.contains(OutputPanel.Kind))
      OutputPanel(id, dashboardId, row.title, meta, appearance, ownerId, outputConfig(row))
    else row.panelType match {
      case TextPanel.Kind =>
        TextPanel(id, dashboardId, row.title, meta, appearance, ownerId, textConfig(row))
      case MarkdownPanel.Kind =>
        MarkdownPanel(id, dashboardId, row.title, meta, appearance, ownerId, markdownConfig(row))
      case ImagePanel.Kind =>
        ImagePanel(id, dashboardId, row.title, meta, appearance, ownerId, imageConfig(row))
      case DividerPanel.Kind =>
        DividerPanel(id, dashboardId, row.title, meta, appearance, ownerId, dividerConfig(row))
      case _ =>
        OutputPanel(id, dashboardId, row.title, meta, appearance, ownerId, outputConfig(row))
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
      columnWidths       = None,
      tableDensity       = None,
      columnOrder        = None,
      chartOptions       = None,
      collectionOptions  = None,
      timelineOptions    = None,
      imageCaption       = None,
      chartAnnotation    = None,
      metricId           = None,
      outputId           = None,
      kind               = None
    )

    p match {
      case t: TextPanel       => base.copy(content = optString(t.config.content))
      case m: MarkdownPanel   => base.copy(content = optString(m.config.content))
      case i: ImagePanel      => base.copy(imageUrl = optString(i.config.imageUrl), imageFit = Some(i.config.imageFit), imageCaption = i.config.caption)
      case d: DividerPanel    => base.copy(dividerOrientation = Some(d.config.orientation), dividerWeight = d.config.weight, dividerColor = d.config.color)
      case op: OutputPanel    => base.copy(outputId = optString(op.config.outputId.value), kind = Some(OutputPanel.Kind))
      case _                  => base
    }
  }


  // HEL-904 task 3.6: rebuild an OutputPanelConfig from `output_id` — the
  // sole field an OutputPanel placement carries. Tolerant read path
  // (matches this mapper's philosophy elsewhere): a row with `kind =
  // 'output'` but a NULL `output_id` decodes to `OutputPanelConfig.Empty`
  // rather than throwing.
  private def outputConfig(row: PanelRepository.PanelRow): OutputPanelConfig =
    OutputPanelConfig(outputId = row.outputId.fold(OutputId(""))(OutputId(_)))

  private def textConfig(row: PanelRepository.PanelRow): TextPanelConfig =
    TextPanelConfig(content = row.content.getOrElse(""))

  private def markdownConfig(row: PanelRepository.PanelRow): MarkdownPanelConfig =
    MarkdownPanelConfig(content = row.content.getOrElse(""))

  private def imageConfig(row: PanelRepository.PanelRow): ImagePanelConfig =
    ImagePanelConfig(
      imageUrl = row.imageUrl.getOrElse(""),
      imageFit = row.imageFit.getOrElse(ImagePanelConfig.DefaultFit),
      caption  = row.imageCaption.flatMap(normalizeText)
    )

  private def dividerConfig(row: PanelRepository.PanelRow): DividerPanelConfig =
    DividerPanelConfig(
      orientation = row.dividerOrientation.getOrElse(DividerPanelConfig.DefaultOrientation),
      weight      = row.dividerWeight,
      color       = row.dividerColor
    )

  private def optString(s: String): Option[String] =
    if (s.isEmpty) None else Some(s)

  /** Read-path tolerance for the caption/annotation text columns: a legacy
   *  empty/whitespace-only stored value normalizes to `None` so it is omitted
   *  from the wire config rather than surfacing as a blank strip. */
  private def normalizeText(s: String): Option[String] =
    if (s.trim.isEmpty) None else Some(s)

}
