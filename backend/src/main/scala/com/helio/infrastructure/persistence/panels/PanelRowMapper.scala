package com.helio.infrastructure.persistence.panels

import com.helio.api.protocols.panels.PanelProtocol
import com.helio.domain.model._
import com.helio.domain.panels._
import org.slf4j.LoggerFactory
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

  private val log = LoggerFactory.getLogger(getClass)

  def rowToDomain(row: PanelRepository.PanelRow): Panel = {
    val id          = PanelId(row.id)
    val dashboardId = DashboardId(row.dashboardId)
    val meta        = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated)
    val appearance  = row.appearance
    val ownerId     = UserId(row.ownerId.toString)

    // HEL-904 task 2.10: full cutover onto `row.kind` as the sole
    // discriminator now that `domainToRow` sets it on every write and the
    // DB column is NOT NULL — the retired `type`/`type_id` columns (and
    // this mapper's old fallback dispatch on `row.panelType`) are gone.
    // A row whose `kind` is unrecognized falls back to `OutputPanel` per
    // the pre-CS2c-3b unknown-kind behaviour.
    row.kind match {
      case TextPanel.Kind =>
        TextPanel(id, dashboardId, row.title, meta, appearance, ownerId, textConfig(row))
      case MarkdownPanel.Kind =>
        MarkdownPanel(id, dashboardId, row.title, meta, appearance, ownerId, markdownConfig(row))
      case ImagePanel.Kind =>
        ImagePanel(id, dashboardId, row.title, meta, appearance, ownerId, imageConfig(row))
      case DividerPanel.Kind =>
        DividerPanel(id, dashboardId, row.title, meta, appearance, ownerId, dividerConfig(row))
      case FormPanel.Kind =>
        FormPanel(id, dashboardId, row.title, meta, appearance, ownerId, formConfig(row))
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
      ownerId      = UUID.fromString(p.ownerId.value),
      content      = None,
      imageUrl     = None,
      imageFit     = None,
      dividerOrientation = None,
      dividerWeight      = None,
      dividerColor       = None,
      imageCaption       = None,
      outputId           = None,
      // HEL-904 task 2.10: `kind` is now the sole discriminator (`type`/
      // `type_id` dropped) and NOT NULL — every write sets it from the
      // panel's own `kind` string, matching the DB CHECK constraint's
      // allow-list exactly.
      kind               = p.kind,
      formConfig         = None,
      outputControls     = None
    )

    p match {
      case t: TextPanel       => base.copy(content = optString(t.config.content))
      case m: MarkdownPanel   => base.copy(content = optString(m.config.content))
      case i: ImagePanel      => base.copy(imageUrl = optString(i.config.imageUrl), imageFit = Some(i.config.imageFit), imageCaption = i.config.caption)
      case d: DividerPanel    => base.copy(dividerOrientation = Some(d.config.orientation), dividerWeight = d.config.weight, dividerColor = d.config.color)
      case op: OutputPanel    =>
        base.copy(
          outputId       = optString(op.config.outputId.value),
          // HEL-1189: kept NULL for the common "no controls" case rather than persisting `"[]"` —
          // matches the migration's "NULL/absent decodes to empty list" plan and leaves every panel
          // untouched by this ticket's own column unchanged.
          outputControls = if (op.config.controls.isEmpty) None else Some(JsArray(op.config.controls.map(_.toJson)).compactPrint)
        )
      case f: FormPanel       => base.copy(formConfig = Some(f.config.toJson.compactPrint))
      case _                  => base
    }
  }


  // HEL-904 task 3.6 / HEL-1189: rebuild an OutputPanelConfig from `output_id` +
  // `output_controls`. Tolerant read path (matches this mapper's philosophy elsewhere): a row with
  // `kind = 'output'` but a NULL `output_id` decodes `outputId` to the empty-string sentinel
  // rather than throwing.
  private def outputConfig(row: PanelRepository.PanelRow): OutputPanelConfig =
    OutputPanelConfig(outputId = row.outputId.fold(OutputId(""))(OutputId(_)), controls = outputControlsOf(row))

  // D9 layer iii / C11 mirror (see `formConfig` below): the only tolerant caller of
  // `OutputControlSpec`'s otherwise-strict decode. A row written by a later (or rolled-back)
  // version that carries an attribute this build doesn't recognize must stay READABLE — every
  // dashboard read funnels through this mapper, so a 500 here would take down the whole dashboard
  // read for one malformed panel. Falls back to an empty controls list with a logged warning
  // naming the panel id, never a silent decode-as-another-kind.
  private def outputControlsOf(row: PanelRepository.PanelRow): Vector[OutputControlSpec] =
    row.outputControls match {
      case None       => Vector.empty
      case Some(json) =>
        try json.parseJson match {
          case JsArray(items) => items.map(_.convertTo[OutputControlSpec])
          case _               => Vector.empty
        } catch {
          case e: DeserializationException =>
            log.warn(s"panel ${row.id}: output_controls failed to decode (${e.getMessage}); falling back to empty")
            Vector.empty
        }
    }

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

  // D9 layer iii / C11: the ONLY tolerant caller of FormFieldSpec/FormPanelConfig's
  // otherwise-strict decode. A row written by a later (or rolled-back) version
  // that carries an attribute this build doesn't recognize must stay READABLE —
  // every dashboard read funnels through this mapper, so a 500 here would take
  // down the whole dashboard read for one malformed panel. Falls back to
  // `FormPanelConfig.Empty` with a logged warning naming the panel id, never a
  // silent decode-as-another-kind (D9/C11).
  private def formConfig(row: PanelRepository.PanelRow): FormPanelConfig =
    row.formConfig match {
      case None       => FormPanelConfig.Empty
      case Some(json) =>
        try FormPanelConfig.decode(json.parseJson)
        catch {
          case e: DeserializationException =>
            log.warn(s"panel ${row.id}: form_config failed to decode (${e.getMessage}); falling back to Empty")
            FormPanelConfig.Empty
        }
    }

  private def optString(s: String): Option[String] =
    if (s.isEmpty) None else Some(s)

  /** Read-path tolerance for the caption/annotation text columns: a legacy
   *  empty/whitespace-only stored value normalizes to `None` so it is omitted
   *  from the wire config rather than surfacing as a blank strip. */
  private def normalizeText(s: String): Option[String] =
    if (s.trim.isEmpty) None else Some(s)

}
