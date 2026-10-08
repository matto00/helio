package com.helio.services.panels

import com.helio.domain.model._
import com.helio.domain.panels._
import spray.json._

/** A pre-validated, normalized snapshot of an `UpdatePanelRequest`.
 *
 *  CS2c-3c collapses the prior 14-field flat shape to four fields: title,
 *  appearance, type (with cross-type 400 lock at apply time), and a raw
 *  `config: JsValue` patch that the per-subtype `*Config.Patch.decode`
 *  resolves at apply time. */
final case class ResolvedPanelPatch(
    trimmedTitle: Option[String],
    appearance:   Option[PanelAppearance],
    panelType:    Option[PanelType],
    configPatch:  Option[JsValue]
) {
  def hasAnyField: Boolean =
    trimmedTitle.isDefined || appearance.isDefined || panelType.isDefined || configPatch.isDefined
}
