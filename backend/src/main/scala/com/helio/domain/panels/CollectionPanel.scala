package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[CollectionPanel]] (HEL-247).
 *
 *  A Collection renders N homogeneous items of one `baseType`, bound to a
 *  multi-row DataType: one row of the bound snapshot = one rendered item, with
 *  the shared `fieldMapping` applied to every item. The binding reuses the
 *  existing `type_id` / `field_mapping` columns; `baseType` / `layout` /
 *  `itemOptions` persist in the dedicated `collection_options` JSONB column
 *  (V57), mirroring the V56 `chart_options` precedent.
 *
 *  Extensibility (D2/D3): `baseType` is an open string whose valid set is
 *  code-defined (schema `enum: ["metric"]` today). `itemOptions` is keyed per
 *  base type (`{ "<baseType>": { … } }`) and stored as a raw [[JsObject]] so a
 *  future base-type switch preserves the other type's options and adding a new
 *  base type is a code-only change — no migration. */
final case class CollectionPanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject,
    baseType: String = CollectionPanelConfig.DefaultBaseType,
    layout: String = CollectionPanelConfig.DefaultLayout,
    itemOptions: Option[JsObject] = None
)

object CollectionPanelConfig {
  val DefaultBaseType: String = "metric"
  val DefaultLayout: String   = "grid"

  val ValidLayouts: Set[String] = Set("grid", "list")

  val Empty: CollectionPanelConfig =
    CollectionPanelConfig(DataTypeId(""), JsObject.empty, DefaultBaseType, DefaultLayout, None)

  implicit val format: RootJsonFormat[CollectionPanelConfig] = jsonFormat5(CollectionPanelConfig.apply)

  private def baseTypeField(fields: Map[String, JsValue]): String =
    fields.get("baseType") match {
      case Some(JsString(s)) if s.nonEmpty => s
      case _                               => DefaultBaseType
    }

  private def layoutField(fields: Map[String, JsValue], strict: Boolean): String =
    fields.get("layout") match {
      case Some(JsString(s)) if ValidLayouts.contains(s) => s
      case Some(JsString(s)) =>
        if (strict) deserializationError(s"Invalid layout value: '$s'. Valid values: ${ValidLayouts.toSeq.sorted.mkString(", ")}")
        else DefaultLayout
      case Some(JsNull) | None => DefaultLayout
      case Some(x)             => if (strict) deserializationError(s"layout must be a string, got $x") else DefaultLayout
    }

  private def itemOptionsField(fields: Map[String, JsValue]): Option[JsObject] =
    fields.get("itemOptions") match {
      case Some(o: JsObject) if o.fields.nonEmpty => Some(o)
      case _                                      => None
    }

  private def decodeInternal(json: JsValue, strict: Boolean): CollectionPanelConfig = json match {
    case JsObject(fields) =>
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      CollectionPanelConfig(
        dataTypeId  = dataTypeId,
        fieldMapping = mapping,
        baseType    = baseTypeField(fields),
        layout      = layoutField(fields, strict),
        itemOptions = itemOptionsField(fields)
      )
    case _ => Empty
  }

  /** Tolerant read (stored rows / responses) — absent/malformed fields default
   *  (`baseType: "metric"`, `layout: "grid"`, no `itemOptions`), never throws. */
  def decode(json: JsValue): CollectionPanelConfig = decodeInternal(json, strict = false)

  /** Create-path — an invalid `layout` enum raises a 400 (via `PanelConfigCodec`). */
  def decodeCreate(json: JsValue): CollectionPanelConfig = decodeInternal(json, strict = true)

  /** Update-side patch carrying absent-vs-null per field (outer `None` = absent;
   *  `Some(None)` = explicit null/clear; `Some(Some(v))` = set). */
  final case class Patch(
      dataTypeId: Option[Option[DataTypeId]],
      fieldMapping: Option[Option[JsObject]],
      baseType: Option[Option[String]],
      layout: Option[Option[String]],
      itemOptions: Option[Option[JsObject]]
  ) {
    def isEmpty: Boolean =
      dataTypeId.isEmpty && fieldMapping.isEmpty && baseType.isEmpty && layout.isEmpty && itemOptions.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None, None, None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val typeId = fields.get("dataTypeId") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(DataTypeId(s)))
          case Some(x)           => deserializationError(s"dataTypeId must be a string or null, got $x")
        }
        val mapping = fields.get("fieldMapping") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(o))
          case Some(x)           => deserializationError(s"fieldMapping must be an object or null, got $x")
        }
        val baseType = fields.get("baseType") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(s))
          case Some(x)           => deserializationError(s"baseType must be a string or null, got $x")
        }
        val layout = fields.get("layout") match {
          case None                                          => None
          case Some(JsNull)                                  => Some(None)
          case Some(JsString(s)) if ValidLayouts.contains(s) => Some(Some(s))
          case Some(JsString(s)) =>
            deserializationError(s"Invalid layout value: '$s'. Valid values: ${ValidLayouts.toSeq.sorted.mkString(", ")}")
          case Some(x)           => deserializationError(s"layout must be a string or null, got $x")
        }
        val itemOptions = fields.get("itemOptions") match {
          case None                                => None
          case Some(JsNull)                        => Some(None)
          case Some(o: JsObject) if o.fields.isEmpty => Some(None)
          case Some(o: JsObject)                   => Some(Some(o))
          case Some(x)                             => deserializationError(s"itemOptions must be an object or null, got $x")
        }
        Patch(typeId, mapping, baseType, layout, itemOptions)
      case _ => Empty
    }
  }
}

/** Collection panel — N homogeneous items of one base type bound to a
 *  multi-row DataType (HEL-247). Shares the bound-trio binding surface
 *  (`dataTypeId` / `fieldMapping` / `buildQuery`); the row→item expansion is a
 *  frontend rendering concern (`CollectionRenderer`). */
final case class CollectionPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: CollectionPanelConfig
) extends Panel {
  val kind: String = CollectionPanel.Kind

  def dataTypeId: Option[DataTypeId] =
    if (config.dataTypeId.value.isEmpty) None else Some(config.dataTypeId)

  def fieldMapping: Option[JsValue] =
    if (config.fieldMapping.fields.isEmpty) None else Some(config.fieldMapping)

  def validateConfig: Either[String, Unit] = Right(())

  def buildQuery: Option[PanelQuery] =
    dataTypeId.map(_ => PanelQuery(
      selectedFields = Panel.selectedFieldsFromMapping(fieldMapping),
      filters        = List.empty,
      sort           = None,
      limit          = None
    ))

  def withBindingCleared: Panel = copy(config = CollectionPanelConfig.Empty)

  /** Apply an update-side patch, preserving absent-vs-null semantics. */
  def applyPatch(patch: CollectionPanelConfig.Patch): CollectionPanel = copy(
    config = CollectionPanelConfig(
      dataTypeId   = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty)),
      baseType     = patch.baseType.fold(config.baseType)(_.getOrElse(CollectionPanelConfig.DefaultBaseType)),
      layout       = patch.layout.fold(config.layout)(_.getOrElse(CollectionPanelConfig.DefaultLayout)),
      itemOptions  = patch.itemOptions.fold(config.itemOptions)(identity)
    )
  )
}

object CollectionPanel {
  val Kind: String = "collection"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = CollectionPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[CollectionPanelConfig].toJson
  }
}
