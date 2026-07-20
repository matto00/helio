package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

// ── Per-chart-type display options (HEL-248) ────────────────────────────────
//
// `chartOptions` is keyed per chart type so switching bar→pie→bar restores the
// original bar settings — nothing is destroyed on a type change. Each key is
// independently shaped and every option maps to a real ECharts construct
// (see design.md D4). All fields are optional; absent = the pre-change default.

final case class LineChartOptions(
    smooth: Option[Boolean] = None,
    showPoints: Option[Boolean] = None,
    areaFill: Option[Boolean] = None
)

object LineChartOptions {
  val Empty: LineChartOptions = LineChartOptions(None, None, None)
  implicit val format: RootJsonFormat[LineChartOptions] = jsonFormat3(LineChartOptions.apply)
}

final case class BarChartOptions(
    orientation: Option[String] = None,
    stacking: Option[String] = None,
    barGapPct: Option[Int] = None
)

object BarChartOptions {
  val Empty: BarChartOptions = BarChartOptions(None, None, None)
  implicit val format: RootJsonFormat[BarChartOptions] = jsonFormat3(BarChartOptions.apply)
}

final case class PieChartOptions(
    donutHolePct: Option[Int] = None,
    showPercentLabels: Option[Boolean] = None
)

object PieChartOptions {
  val Empty: PieChartOptions = PieChartOptions(None, None)
  implicit val format: RootJsonFormat[PieChartOptions] = jsonFormat2(PieChartOptions.apply)
}

final case class ScatterChartOptions(
    sizeField: Option[String] = None,
    colorField: Option[String] = None
)

object ScatterChartOptions {
  val Empty: ScatterChartOptions = ScatterChartOptions(None, None)
  implicit val format: RootJsonFormat[ScatterChartOptions] = jsonFormat2(ScatterChartOptions.apply)
}

final case class ChartOptions(
    line: Option[LineChartOptions] = None,
    bar: Option[BarChartOptions] = None,
    pie: Option[PieChartOptions] = None,
    scatter: Option[ScatterChartOptions] = None
)

object ChartOptions {
  val Empty: ChartOptions = ChartOptions(None, None, None, None)

  // Written via the derived formats; `None` fields are omitted on the wire by
  // DefaultJsonProtocol (the spray-json None-omission the ticket flags).
  implicit val format: RootJsonFormat[ChartOptions] = jsonFormat4(ChartOptions.apply)

  val ValidOrientations: Set[String] = Set("vertical", "horizontal")
  val ValidStackings: Set[String]    = Set("none", "stacked", "normalized")
  val BarGapRange: (Int, Int)        = (0, 100)
  val DonutHoleRange: (Int, Int)     = (0, 90)

  /** Parse the per-type-keyed options object.
   *
   *  `strict = true` (create/PATCH input): an unknown enum or out-of-range
   *  number raises `deserializationError` → HTTP 400 with a field-naming
   *  message. `strict = false` (stored-row read): invalid values are dropped
   *  to `None` so a bad row never throws (PanelRowMapper read-path tolerance).
   *
   *  Returns `None` when the resulting options are empty (no type carried any
   *  value) so an empty `{}` normalizes to "no options". */
  def parse(json: JsValue, strict: Boolean): Option[ChartOptions] = json match {
    case JsObject(fields) =>
      val opts = ChartOptions(
        line    = fields.get("line").flatMap(parseLine(_, strict)),
        bar     = fields.get("bar").flatMap(parseBar(_, strict)),
        pie     = fields.get("pie").flatMap(parsePie(_, strict)),
        scatter = fields.get("scatter").flatMap(parseScatter(_, strict))
      )
      if (opts == Empty) None else Some(opts)
    case JsNull => None
    case x      => if (strict) deserializationError(s"chartOptions must be an object, got $x") else None
  }

  private def parseLine(json: JsValue, strict: Boolean): Option[LineChartOptions] = json match {
    case JsObject(f) =>
      val o = LineChartOptions(
        smooth     = boolField(f, "smooth", strict),
        showPoints = boolField(f, "showPoints", strict),
        areaFill   = boolField(f, "areaFill", strict)
      )
      if (o == LineChartOptions.Empty) None else Some(o)
    case x => if (strict) deserializationError(s"chartOptions.line must be an object, got $x") else None
  }

  private def parseBar(json: JsValue, strict: Boolean): Option[BarChartOptions] = json match {
    case JsObject(f) =>
      val o = BarChartOptions(
        orientation = enumField(f, "orientation", ValidOrientations, strict),
        stacking    = enumField(f, "stacking", ValidStackings, strict),
        barGapPct   = clampedIntField(f, "barGapPct", BarGapRange._1, BarGapRange._2, strict)
      )
      if (o == BarChartOptions.Empty) None else Some(o)
    case x => if (strict) deserializationError(s"chartOptions.bar must be an object, got $x") else None
  }

  private def parsePie(json: JsValue, strict: Boolean): Option[PieChartOptions] = json match {
    case JsObject(f) =>
      val o = PieChartOptions(
        donutHolePct      = clampedIntField(f, "donutHolePct", DonutHoleRange._1, DonutHoleRange._2, strict),
        showPercentLabels = boolField(f, "showPercentLabels", strict)
      )
      if (o == PieChartOptions.Empty) None else Some(o)
    case x => if (strict) deserializationError(s"chartOptions.pie must be an object, got $x") else None
  }

  private def parseScatter(json: JsValue, strict: Boolean): Option[ScatterChartOptions] = json match {
    case JsObject(f) =>
      val o = ScatterChartOptions(
        sizeField  = stringField(f, "sizeField", strict),
        colorField = stringField(f, "colorField", strict)
      )
      if (o == ScatterChartOptions.Empty) None else Some(o)
    case x => if (strict) deserializationError(s"chartOptions.scatter must be an object, got $x") else None
  }

  private def boolField(fields: Map[String, JsValue], key: String, strict: Boolean): Option[Boolean] =
    fields.get(key) match {
      case None               => None
      case Some(JsBoolean(b)) => Some(b)
      case Some(x)            => if (strict) deserializationError(s"chartOptions field '$key' must be a boolean, got $x") else None
    }

  private def stringField(fields: Map[String, JsValue], key: String, strict: Boolean): Option[String] =
    fields.get(key) match {
      case None              => None
      case Some(JsString(s)) => if (s.isEmpty) None else Some(s)
      case Some(x)           => if (strict) deserializationError(s"chartOptions field '$key' must be a string, got $x") else None
    }

  private def enumField(fields: Map[String, JsValue], key: String, valid: Set[String], strict: Boolean): Option[String] =
    fields.get(key) match {
      case None                                      => None
      case Some(JsString(s)) if valid.contains(s)    => Some(s)
      case Some(JsString(s))                         =>
        if (strict) deserializationError(s"Invalid $key value: '$s'. Valid values: ${valid.toSeq.sorted.mkString(", ")}")
        else None
      case Some(x) => if (strict) deserializationError(s"chartOptions field '$key' must be a string, got $x") else None
    }

  private def clampedIntField(fields: Map[String, JsValue], key: String, min: Int, max: Int, strict: Boolean): Option[Int] =
    fields.get(key) match {
      case None => None
      case Some(JsNumber(n)) =>
        val v = n.toInt
        if (v >= min && v <= max) Some(v)
        else if (strict) deserializationError(s"$key must be between $min and $max, got $v")
        else None
      case Some(x) => if (strict) deserializationError(s"chartOptions field '$key' must be a number, got $x") else None
    }
}

/** Typed config for a [[ChartPanel]]. Same shape as the other "bound trio"
 *  configs ([[MetricPanelConfig]] / [[TablePanelConfig]]) — they are kept
 *  as distinct types per design.md §1 so future divergence is structural.
 *
 *  `chartOptions` (HEL-248) carries optional per-chart-type display options,
 *  keyed by chart type; absent = the pre-change rendering defaults. */
final case class ChartPanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject,
    aggregation: Option[JsObject] = None,
    chartOptions: Option[ChartOptions] = None,
    annotation: Option[String] = None
)

object ChartPanelConfig {
  val Empty: ChartPanelConfig = ChartPanelConfig(DataTypeId(""), JsObject.empty, None, None, None)

  implicit val format: RootJsonFormat[ChartPanelConfig] = jsonFormat5(ChartPanelConfig.apply)

  /** Normalize an annotation input to the cleared/set state: absent, null,
   *  empty, and whitespace-only all collapse to `None` so a blank annotation
   *  round-trips as an omitted field, never a stored `""`. */
  private def normalizeAnnotation(value: Option[JsValue]): Option[String] = value match {
    case Some(JsString(s)) if s.trim.nonEmpty => Some(s)
    case _                                    => None
  }

  private def decodeInternal(json: JsValue, strict: Boolean): ChartPanelConfig = json match {
    case JsObject(fields) =>
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      val aggregation = fields.get("aggregation") match {
        case Some(o: JsObject) => Some(o)
        case _                 => None
      }
      val chartOptions = fields.get("chartOptions").flatMap(ChartOptions.parse(_, strict))
      ChartPanelConfig(dataTypeId, mapping, aggregation, chartOptions, normalizeAnnotation(fields.get("annotation")))
    case _ => Empty
  }

  /** Tolerant read (stored rows / responses) — invalid options dropped. */
  def decode(json: JsValue): ChartPanelConfig = decodeInternal(json, strict = false)

  /** Create-path — invalid enums/ranges raise a 400 (via `PanelConfigCodec`). */
  def decodeCreate(json: JsValue): ChartPanelConfig = decodeInternal(json, strict = true)

  final case class Patch(
      dataTypeId: Option[Option[DataTypeId]],
      fieldMapping: Option[Option[JsObject]],
      aggregation: Option[Option[JsObject]],
      chartOptions: Option[Option[ChartOptions]],
      annotation: Option[Option[String]]
  ) {
    def isEmpty: Boolean =
      dataTypeId.isEmpty && fieldMapping.isEmpty && aggregation.isEmpty && chartOptions.isEmpty && annotation.isEmpty
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
        val aggregation = fields.get("aggregation") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(o))
          case Some(x)           => deserializationError(s"aggregation must be an object or null, got $x")
        }
        // Absent = leave unchanged; null = clear; object = strict-validate and
        // replace (an empty object normalizes to a clear via `parse` → None).
        val chartOptions = fields.get("chartOptions") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(ChartOptions.parse(o, strict = true))
          case Some(x)           => deserializationError(s"chartOptions must be an object or null, got $x")
        }
        // Absent = leave unchanged; null/empty/whitespace = clear; non-blank = set.
        val annotation = fields.get("annotation") match {
          case None                                 => None
          case Some(JsNull)                         => Some(None)
          case Some(JsString(s)) if s.trim.nonEmpty => Some(Some(s))
          case Some(JsString(_))                    => Some(None)
          case Some(x)                              => deserializationError(s"annotation must be a string or null, got $x")
        }
        Patch(typeId, mapping, aggregation, chartOptions, annotation)
      case _ => Empty
    }
  }
}

final case class ChartPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: ChartPanelConfig
) extends Panel {
  val kind: String = ChartPanel.Kind

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

  def withBindingCleared: Panel = copy(config = ChartPanelConfig.Empty)

  def applyPatch(patch: ChartPanelConfig.Patch): ChartPanel = copy(
    config = ChartPanelConfig(
      dataTypeId   = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty)),
      aggregation  = patch.aggregation.fold(config.aggregation)(identity),
      chartOptions = patch.chartOptions.fold(config.chartOptions)(identity),
      annotation   = patch.annotation.fold(config.annotation)(identity)
    )
  )
}

object ChartPanel {
  val Kind: String = "chart"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = ChartPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[ChartPanelConfig].toJson
  }
}
