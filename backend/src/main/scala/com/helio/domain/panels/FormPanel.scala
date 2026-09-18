package com.helio.domain.panels

import com.helio.domain.model.{DashboardId, DataFieldType, DataSourceId, Panel, PanelAppearance, PanelId, ResourceMeta, UserId}
import spray.json._

/** A single entry in a [[FormPanelConfig]]'s ordered `fields` list. References
 *  a dataset field by name (`sourceField`) and chooses a presentation
 *  `control` — deliberately orthogonal to the dataset's own `DataFieldType`
 *  vocabulary (design.md D3): a form field never re-declares its own data
 *  type, so the dataset's declared schema stays the single authoritative
 *  source of type/required-ness/write-time default.
 *
 *  `initialValue` and `options` are kept as raw [[JsValue]] rather than typed
 *  — the closed attribute set (below) is what's validated, not the shape of
 *  a prefill value or an option list, and round-tripping the caller's exact
 *  JSON is what the create/read-back AC requires. */
final case class FormFieldSpec(
    sourceField: String,
    control: String,
    label: Option[String] = None,
    placeholder: Option[String] = None,
    helpText: Option[String] = None,
    required: Option[Boolean] = None,
    // Prefill only (design.md D3a) — never changes what is stored for an
    // omitted field; the dataset's declared `default` is the sole write-time
    // fill. Renamed from `defaultValue` for exactly this reason.
    initialValue: Option[JsValue] = None,
    step: Option[Double] = None,
    options: Option[JsValue] = None
)

object FormFieldSpec {

  /** The closed attribute set (design.md D3) — an unrecognized key is a
   *  decode FAILURE (D9 layer i), never silently dropped (C8). */
  val AllowedKeys: Set[String] =
    Set("sourceField", "control", "label", "placeholder", "helpText", "required", "initialValue", "step", "options")

  val ValidControls: Set[String] =
    Set("text", "textarea", "number", "date", "select", "checkbox", "file")

  /** design.md D2 — the control-to-type fitness matrix, first entry = the
   *  type's default control. THE single source of truth: the frontend's
   *  `CONTROL_FITNESS` (`state/formConfigValidation.ts`) mirrors this and is
   *  drift-guarded by a Jest test that parses this literal out of this file
   *  (C4) — never edit one side without the other. */
  val FittingControls: Map[DataFieldType, Vector[String]] = Map(
    DataFieldType.StringType     -> Vector("text", "textarea", "select"),
    DataFieldType.StringBodyType -> Vector("textarea", "text", "select"),
    DataFieldType.IntegerType    -> Vector("number", "select", "text"),
    DataFieldType.FloatType      -> Vector("number", "select", "text"),
    DataFieldType.BooleanType    -> Vector("checkbox", "select"),
    DataFieldType.TimestampType  -> Vector("date", "text", "select"),
    DataFieldType.BinaryRefType  -> Vector("file")
  )

  /** The declared type's default control — the fitting matrix's first entry. */
  def defaultControlFor(fieldType: DataFieldType): String = FittingControls(fieldType).head

  implicit val format: RootJsonFormat[FormFieldSpec] = new RootJsonFormat[FormFieldSpec] {
    def write(f: FormFieldSpec): JsValue = {
      val base = Map(
        "sourceField" -> JsString(f.sourceField).asInstanceOf[JsValue],
        "control"     -> JsString(f.control)
      )
      val optionalFields = Vector(
        f.label.map("label" -> JsString(_)),
        f.placeholder.map("placeholder" -> JsString(_)),
        f.helpText.map("helpText" -> JsString(_)),
        f.required.map("required" -> JsBoolean(_)),
        f.initialValue.map("initialValue" -> _),
        f.step.map("step" -> JsNumber(_)),
        f.options.map("options" -> _)
      ).flatten
      JsObject(base ++ optionalFields.toMap)
    }

    // Strict (D9 layer i): a plain decode error, no HTTP meaning of its own —
    // `decodeCreate`/`Patch.decode` (or `PanelConfigCodec.safe`) are the only
    // callers that map this to a 400. `PanelRowMapper`'s row-mapper arm
    // catches it instead and falls back to `Empty` (D9 layer iii).
    def read(json: JsValue): FormFieldSpec = json match {
      case JsObject(fields) =>
        val unknown = fields.keySet -- AllowedKeys
        if (unknown.nonEmpty)
          deserializationError(s"Unrecognized form field attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")

        val sourceField = fields.get("sourceField") match {
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"sourceField must be a string, got $x")
          case None              => deserializationError("sourceField is required")
        }
        val control = fields.get("control") match {
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"control must be a string, got $x")
          case None              => deserializationError("control is required")
        }
        val label = fields.get("label") match {
          case None              => None
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"label must be a string, got $x")
        }
        val placeholder = fields.get("placeholder") match {
          case None              => None
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"placeholder must be a string, got $x")
        }
        val helpText = fields.get("helpText") match {
          case None              => None
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"helpText must be a string, got $x")
        }
        val required = fields.get("required") match {
          case None                 => None
          case Some(JsBoolean(b))   => Some(b)
          case Some(x)              => deserializationError(s"required must be a boolean, got $x")
        }
        val initialValue = fields.get("initialValue")
        val step = fields.get("step") match {
          case None              => None
          case Some(JsNumber(n)) => Some(n.toDouble)
          case Some(x)           => deserializationError(s"step must be a number, got $x")
        }
        val options = fields.get("options")

        FormFieldSpec(sourceField, control, label, placeholder, helpText, required, initialValue, step, options)
      case x => deserializationError(s"form field must be an object, got $x")
    }
  }

  def decode(json: JsValue): FormFieldSpec = json.convertTo[FormFieldSpec]
}

/** A `form` panel's submit behaviour (design.md D4). Modelled as an object
 *  rather than a bare string so a later ticket (HEL-1087/1088) can add
 *  submit-time concerns without a wire break. `writeMode` is fixed to
 *  `append` — `replace` is meaningful to the dataset write API but not to a
 *  form submit, so it is rejected rather than silently coerced. */
final case class FormSubmitSpec(
    writeMode: String,
    label: Option[String] = None,
    resetOnSuccess: Option[Boolean] = None
)

object FormSubmitSpec {
  val DefaultWriteMode: String = "append"
  val Default: FormSubmitSpec  = FormSubmitSpec(DefaultWriteMode, None, None)

  private val AllowedKeys: Set[String] = Set("writeMode", "label", "resetOnSuccess")

  implicit val format: RootJsonFormat[FormSubmitSpec] = new RootJsonFormat[FormSubmitSpec] {
    def write(s: FormSubmitSpec): JsValue = {
      val base = Map("writeMode" -> JsString(s.writeMode).asInstanceOf[JsValue])
      val optionalFields = Vector(
        s.label.map("label" -> JsString(_)),
        s.resetOnSuccess.map("resetOnSuccess" -> JsBoolean(_))
      ).flatten
      JsObject(base ++ optionalFields.toMap)
    }

    def read(json: JsValue): FormSubmitSpec = json match {
      case JsObject(fields) =>
        val unknown = fields.keySet -- AllowedKeys
        if (unknown.nonEmpty)
          deserializationError(s"Unrecognized submit attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")

        val writeMode = fields.get("writeMode") match {
          case None              => DefaultWriteMode
          case Some(JsString(s)) => s
          case Some(x)           => deserializationError(s"writeMode must be a string, got $x")
        }
        val label = fields.get("label") match {
          case None              => None
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"label must be a string, got $x")
        }
        val resetOnSuccess = fields.get("resetOnSuccess") match {
          case None               => None
          case Some(JsBoolean(b)) => Some(b)
          case Some(x)            => deserializationError(s"resetOnSuccess must be a boolean, got $x")
        }
        FormSubmitSpec(writeMode, label, resetOnSuccess)
      // `null` is rejected like any other non-object, for consistency with
      // the strictness elsewhere in this file (evaluation-1.md suggestion) —
      // an explicit `"submit": null` should not silently become `append`.
      case x => deserializationError(s"submit must be an object, got $x")
    }
  }

  def decode(json: JsValue): FormSubmitSpec = json.convertTo[FormSubmitSpec]
}

/** Typed config for a [[FormPanel]] — a panel that writes rows into a
 *  `dataset`-kind source rather than reading a materialized Output
 *  (design.md D1). Persisted as a single `form_config` JSONB column: a
 *  typed-column shape cannot express an ordered, variable-length field list. */
final case class FormPanelConfig(
    dataSourceId: DataSourceId,
    fields: Vector[FormFieldSpec],
    submit: FormSubmitSpec
)

object FormPanelConfig {
  val Empty: FormPanelConfig = FormPanelConfig(DataSourceId(""), Vector.empty, FormSubmitSpec.Default)

  /** The closed top-level attribute set — mirrors `FormFieldSpec.AllowedKeys`
   *  (evaluation-1.md CR3). */
  private val AllowedKeys: Set[String] = Set("dataSourceId", "fields", "submit")

  implicit val format: RootJsonFormat[FormPanelConfig] = new RootJsonFormat[FormPanelConfig] {
    def write(c: FormPanelConfig): JsValue = JsObject(
      "dataSourceId" -> JsString(c.dataSourceId.value),
      "fields"       -> JsArray(c.fields.map(_.toJson)),
      "submit"       -> c.submit.toJson
    )

    // Tolerant at the top level (matches every sibling *PanelConfig): a
    // non-object payload (e.g. absent `config`) yields `Empty` rather than
    // failing, mirroring the codec's "decode(None) => Empty" read-path
    // tolerance rule. A present-but-malformed `fields`/`submit` entry still
    // fails strictly (D9 layer i) — that failure is what `decodeCreate`/
    // `Patch.decode` map to a 400, and what `PanelRowMapper`'s tolerant
    // wrapper (D9 layer iii) catches on the read path instead.
    def read(json: JsValue): FormPanelConfig = json match {
      case JsObject(fields) =>
        // Mirrors the closed-set check both children already perform
        // (`FormFieldSpec.read`/`FormSubmitSpec.read`) — omitting it here
        // let a typo'd key (`submitt`) silently discard its intended value
        // rather than reject, exactly the C8 silent-degradation family this
        // capability exists to close, and `schemas/panels/panel.schema.json`'s
        // `$defs.FormConfig` already declares `additionalProperties: false`
        // (evaluation-1.md CR3).
        val unknown = fields.keySet -- AllowedKeys
        if (unknown.nonEmpty)
          deserializationError(s"Unrecognized form config attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")

        val dataSourceId = fields.get("dataSourceId") match {
          case Some(JsString(s)) => DataSourceId(s)
          case None              => DataSourceId("")
          case Some(x)           => deserializationError(s"dataSourceId must be a string, got $x")
        }
        val fieldList = fields.get("fields") match {
          case Some(JsArray(items)) => items.map(_.convertTo[FormFieldSpec])
          case None                 => Vector.empty
          case Some(x)              => deserializationError(s"fields must be an array, got $x")
        }
        val submit = fields.get("submit") match {
          case Some(s) => s.convertTo[FormSubmitSpec]
          case None    => FormSubmitSpec.Default
        }
        FormPanelConfig(dataSourceId, fieldList, submit)
      case _ => Empty
    }
  }

  def decode(json: JsValue): FormPanelConfig = json.convertTo[FormPanelConfig]

  // A distinct name from `decode`, even though it is `= decode` verbatim
  // today (D9): gives the write path a stable seam if create-only rules are
  // ever added later, without touching the read-path name every other
  // caller (including `PanelRowMapper`'s tolerant wrapper) uses.
  def decodeCreate(json: JsValue): FormPanelConfig = decode(json)

  /** Update patch — every field `Option`-wrapped (absent = keep existing);
   *  each present sub-value is decoded with the SAME strict rules as create
   *  (C8: a `step` that silently vanishes on PATCH is the same
   *  silent-degradation family this capability exists to close). */
  final case class Patch(
      dataSourceId: Option[DataSourceId],
      fields: Option[Vector[FormFieldSpec]],
      submit: Option[FormSubmitSpec]
  ) {
    def isEmpty: Boolean = dataSourceId.isEmpty && fields.isEmpty && submit.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val dataSourceId = fields.get("dataSourceId") match {
          case None              => None
          case Some(JsString(s)) => Some(DataSourceId(s))
          case Some(x)           => deserializationError(s"dataSourceId must be a string, got $x")
        }
        val fieldList = fields.get("fields") match {
          case None                 => None
          case Some(JsArray(items)) => Some(items.map(_.convertTo[FormFieldSpec]))
          case Some(x)              => deserializationError(s"fields must be an array, got $x")
        }
        val submit = fields.get("submit") match {
          case None    => None
          case Some(s) => Some(s.convertTo[FormSubmitSpec])
        }
        Patch(dataSourceId, fieldList, submit)
      case _ => Empty
    }
  }
}

final case class FormPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: FormPanelConfig
) extends Panel {
  val kind: String = FormPanel.Kind

  def dataSourceId: Option[DataSourceId] =
    if (config.dataSourceId.value.isEmpty) None else Some(config.dataSourceId)

  /** Structural validation only (design.md's "Validation at this layer is
   *  structural only" — a field list's consistency with the bound dataset's
   *  declared schema is HEL-1084's author-time check, out of scope here). */
  def validateConfig: Either[String, Unit] = {
    def fieldErrors: Either[String, Unit] = {
      val blank = config.fields.exists(_.sourceField.trim.isEmpty)
      if (blank) Left("sourceField must not be blank")
      else {
        val duplicates = config.fields.groupBy(_.sourceField).collect { case (name, fs) if fs.size > 1 => name }
        if (duplicates.nonEmpty) Left(s"duplicate sourceField: ${duplicates.toSeq.sorted.mkString(", ")}")
        else {
          config.fields.collectFirst {
            case f if !FormFieldSpec.ValidControls.contains(f.control) =>
              s"unknown control: '${f.control}'. Valid values: ${FormFieldSpec.ValidControls.toSeq.sorted.mkString(", ")}"
            case f if f.control == "select" && f.options.isEmpty =>
              "select field requires options"
            // Tighten-only (D3a): `required: false` would let a form present
            // a dataset-required field as optional, so it is malformed.
            case f if f.required.contains(false) =>
              s"required cannot be false for field '${f.sourceField}' — requiredness may only be tightened"
            case f if f.step.exists(_ <= 0) =>
              s"step must be positive for field '${f.sourceField}'"
            case f if f.step.isDefined && f.control != "number" =>
              s"step is only valid alongside control: number (field '${f.sourceField}' has control '${f.control}')"
          } match {
            case Some(err) => Left(err)
            case None       => Right(())
          }
        }
      }
    }

    for {
      _ <- if (config.dataSourceId.value.isEmpty) Left("dataSourceId is required") else Right(())
      _ <- fieldErrors
      // Modelled as an object (D4) so a form submit never silently accepts a
      // write mode meaningful only to the raw dataset write API.
      _ <- if (config.submit.writeMode != FormSubmitSpec.DefaultWriteMode)
             Left(s"writeMode must be '${FormSubmitSpec.DefaultWriteMode}'")
           else Right(())
    } yield ()
  }

  def applyPatch(patch: FormPanelConfig.Patch): FormPanel =
    copy(
      config = FormPanelConfig(
        dataSourceId = patch.dataSourceId.getOrElse(config.dataSourceId),
        fields        = patch.fields.getOrElse(config.fields),
        submit        = patch.submit.getOrElse(config.submit)
      )
    )
}

object FormPanel {
  val Kind: String = "form"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = FormPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[FormPanelConfig].toJson
  }
}
