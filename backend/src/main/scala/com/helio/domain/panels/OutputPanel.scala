package com.helio.domain.panels

import com.helio.domain.model.{DashboardId, OutputId, Panel, PanelAppearance, PanelId, ResourceMeta, UserId}
import spray.json._

/** HEL-1189 design.md D2 — a single author-configured control on an `output` panel (date-range/
 *  dropdown/numeric-range/text), parameterizing the read rather than being a panel kind of its own
 *  (spec decision 6). Mirrors `FormFieldSpec`'s closed-key/strict-decode shape but carries an `id`
 *  (`FormFieldSpec` has none — form fields are keyed by `sourceField` uniqueness, but `column` is
 *  NOT unique here: two controls, e.g. a numeric-range and a dropdown, can legitimately bind the
 *  same column). `id` is CLIENT-generated (UUID v4) at "Add control" time — the server never mints
 *  or rewrites it, only persists whatever is given (design.md D2); a forged/colliding `id` can't
 *  bypass validation since `PanelService.rejectInvalidControls` (D4) separately checks
 *  `kind`/`column` regardless of whether `id` was judged new.
 *
 *  `defaultValue`'s JSON shape is fixed per `kind` (design.md D2) but never server-validated, like
 *  `FormFieldSpec.initialValue`: a single JSON string for `text`/`dropdown`; `{"min", "max"}` (each
 *  nullable) for `numeric-range`; `{"from", "to"}` (each nullable ISO-8601 date strings) for
 *  `date-range`. */
final case class OutputControlSpec(
    id: String,
    kind: String,
    column: String,
    label: String,
    defaultValue: Option[JsValue] = None
)

object OutputControlSpec {

  /** design.md D2 — the closed attribute set; an unrecognized key is a decode FAILURE, mirroring
   *  `FormFieldSpec.AllowedKeys`, never a silent drop. */
  val AllowedKeys: Set[String] = Set("id", "kind", "column", "label", "defaultValue")

  /** design.md D2 — mirrors `OutputControlEligibility.ValidKinds` (services/pipelines); kept here
   *  too (rather than only referencing it) so `domain/panels` has no compile-time dependency on
   *  `services/pipelines` for a plain kind-membership check. `OutputPanel.validateConfig` is the
   *  sole caller and only needs set membership, not the eligibility function itself. */
  val ValidKinds: Set[String] = Set("date-range", "dropdown", "numeric-range", "text")

  implicit val format: RootJsonFormat[OutputControlSpec] = new RootJsonFormat[OutputControlSpec] {
    def write(c: OutputControlSpec): JsValue = {
      val base = Map(
        "id"     -> JsString(c.id).asInstanceOf[JsValue],
        "kind"   -> JsString(c.kind),
        "column" -> JsString(c.column),
        "label"  -> JsString(c.label)
      )
      val optionalFields = c.defaultValue.map("defaultValue" -> _).toVector
      JsObject(base ++ optionalFields.toMap)
    }

    // Strict (mirrors FormFieldSpec.format.read): a plain decode error, mapped to a 400 by
    // decodeCreate/Patch.decode; PanelRowMapper's row-mapper arm catches it instead and falls back
    // to an empty controls list, never a silent decode-as-another-kind.
    def read(json: JsValue): OutputControlSpec = json match {
      case JsObject(fields) =>
        val unknown = fields.keySet -- AllowedKeys
        if (unknown.nonEmpty)
          deserializationError(s"Unrecognized control attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")

        val id = fields.get("id") match {
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"id must be a string, got $x")
          case None              => deserializationError("id is required")
        }
        val kind = fields.get("kind") match {
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"kind must be a string, got $x")
          case None              => deserializationError("kind is required")
        }
        val column = fields.get("column") match {
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"column must be a string, got $x")
          case None              => deserializationError("column is required")
        }
        val label = fields.get("label") match {
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"label must be a string, got $x")
          case None              => deserializationError("label is required")
        }
        val defaultValue = fields.get("defaultValue")

        OutputControlSpec(id, kind, column, label, defaultValue)
      case x => deserializationError(s"control must be an object, got $x")
    }
  }

  def decode(json: JsValue): OutputControlSpec = json.convertTo[OutputControlSpec]

  /** HEL-1203: the single structural check every write path shares (blank id/column/label, unknown
   *  kind, duplicate id), so one error shape holds everywhere. Eligibility against the bound
   *  Output is `OutputControlsValidator`'s separate, async job. Ids are compared exactly, on the
   *  FINAL ids (after any id minting by a caller). */
  def validateList(controls: Vector[OutputControlSpec]): Either[String, Unit] =
    controls.collectFirst {
      case c if c.id.trim.isEmpty =>
        "control id must not be blank"
      case c if !ValidKinds.contains(c.kind) =>
        s"unknown control kind: '${c.kind}'. Valid values: ${ValidKinds.toSeq.sorted.mkString(", ")}"
      case c if c.column.trim.isEmpty =>
        s"control column must not be blank (control '${c.id}')"
      case c if c.label.trim.isEmpty =>
        s"control label must not be blank (control '${c.id}')"
    }.toLeft(()).flatMap(_ => duplicateIdCheck(controls.map(_.id)))

  def duplicateIdCheck(ids: Vector[String]): Either[String, Unit] =
    ids.groupBy(identity).collectFirst { case (id, occurrences) if occurrences.size > 1 => id } match {
      case Some(id) => Left(s"duplicate control id: '$id'")
      case None     => Right(())
    }

  /** Message shared by every path that rejects a `controls` key on a non-output panel. */
  val OnlyOnOutputPanel: String = "controls are only supported on an output panel"
}

/** Typed config for an [[OutputPanel]] — a placement of one [[com.helio.
 *  domain.model.Output]] (HEL-904 task 3.6). Replaces the five "bound"
 *  configs ([[MetricPanelConfig]] / [[ChartPanelConfig]] / [[TablePanelConfig]] /
 *  [[CollectionPanelConfig]] / [[TimelinePanelConfig]]) — everything those
 *  configs used to carry (`fieldMapping`, `aggregation`, `chartOptions`,
 *  `columnWidths`/`density`/`columnOrder`, `timelineOptions`, `metricId`,
 *  `label`/`unit`) now lives on the Output itself (`outputs.config`,
 *  `OutputRepository`), not on the placement. A Panel placement owns
 *  `outputId` plus the common identity/appearance fields every [[Panel]]
 *  subtype already carries (design.md "Panel remains the name for a
 *  placement"), plus (HEL-1189 design.md D1) an ordered `controls` list —
 *  the author-configured date-range/dropdown/numeric-range/text controls
 *  that parameterize the read (leaf 2 of HEL-915). */
final case class OutputPanelConfig(outputId: OutputId, controls: Vector[OutputControlSpec] = Vector.empty)

object OutputPanelConfig {
  val Empty: OutputPanelConfig = OutputPanelConfig(OutputId(""), Vector.empty)

  implicit val format: RootJsonFormat[OutputPanelConfig] = new RootJsonFormat[OutputPanelConfig] {
    def write(c: OutputPanelConfig): JsValue = JsObject(
      "outputId" -> JsString(c.outputId.value),
      "controls" -> JsArray(c.controls.map(_.toJson))
    )

    def read(json: JsValue): OutputPanelConfig = decode(json)
  }

  /** HEL-1189 design.md D5 — the READ-TIME response shape: identical to `format.write` except
   *  each control also carries `orphaned: Boolean` (`true` iff its `id` is in `orphanedIds`), per
   *  `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever the panel's controls
   *  are read"). `orphanedIds` is computed by the caller (`OutputControlsValidator.isOrphaned`,
   *  the SAME decision the write-time validator uses — see that class) against the Output's
   *  CURRENT schema/contract; this method is purely a wire-shape concern, no I/O. Used only by
   *  read paths that have actually computed live orphan status (`PanelResponse.fromDomain`'s
   *  `orphanedControlIds` param) — every other caller of `format.write` (create/update echoes,
   *  patchset/proposal previews, etc.) is unaffected and never emits this key. */
  def responseJson(c: OutputPanelConfig, orphanedIds: Set[String]): JsValue = JsObject(
    "outputId" -> JsString(c.outputId.value),
    "controls" -> JsArray(c.controls.map { control =>
      JsObject(control.toJson.asJsObject.fields + ("orphaned" -> JsBoolean(orphanedIds.contains(control.id))))
    })
  )

  def decode(json: JsValue): OutputPanelConfig = json match {
    case JsObject(fields) =>
      val outputId = fields.get("outputId") match {
        case Some(JsString(s)) => OutputId(s)
        case _                 => OutputId("")
      }
      // HEL-1203: a present-but-non-array `controls` is a decode failure, never a silent empty list.
      // Read-time tolerance for persisted rows lives in `PanelRowMapper`, which does not use this.
      val controls = fields.get("controls") match {
        case None                 => Vector.empty
        case Some(JsArray(items)) => items.map(_.convertTo[OutputControlSpec])
        case Some(x)              => deserializationError(s"controls must be an array, got $x")
      }
      OutputPanelConfig(outputId, controls)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): OutputPanelConfig = decode(json)

  /** design.md D4/D2: `controls` is `Option`-wrapped like every other patch field — absent means
   *  "keep existing" (a title/appearance/outputId-only PATCH leaves the persisted controls list
   *  untouched), present replaces the whole list (mirrors `FormPanelConfig.Patch.fields`). */
  final case class Patch(outputId: Option[OutputId], controls: Option[Vector[OutputControlSpec]]) {
    def isEmpty: Boolean = outputId.isEmpty && controls.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val outputId = fields.get("outputId") match {
          case None              => None
          case Some(JsString(s)) => Some(OutputId(s))
          case Some(x)           => deserializationError(s"outputId must be a string, got $x")
        }
        val controls = fields.get("controls") match {
          case None                 => None
          case Some(JsArray(items)) => Some(items.map(_.convertTo[OutputControlSpec]))
          case Some(x)              => deserializationError(s"controls must be an array, got $x")
        }
        Patch(outputId, controls)
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

  def outputId: Option[OutputId] =
    if (config.outputId.value.isEmpty) None else Some(config.outputId)

  /** Structural validation only — a control's `column`/`kind` eligibility against the bound
   *  Output's current filter-capability contract is `OutputControlsValidator`'s job
   *  (design.md D4), which needs an async repository call this synchronous method can't make. */
  def validateConfig: Either[String, Unit] =
    if (config.outputId.value.isEmpty) Left("outputId is required")
    else OutputControlSpec.validateList(config.controls)

  def applyPatch(patch: OutputPanelConfig.Patch): OutputPanel =
    copy(
      config = OutputPanelConfig(
        outputId = patch.outputId.getOrElse(config.outputId),
        controls = patch.controls.getOrElse(config.controls)
      )
    )
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
