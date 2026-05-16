package com.helio.api.protocols

import com.helio.domain._
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.util.Try

/** Encode / decode typed pipeline step configs to / from the JSON text stored
 *  on the `pipeline_steps.config` column.
 *
 *  Lives in the protocol package because it shares formatter declarations
 *  with the per-subtype wire payloads. Keeping the codec here avoids
 *  duplicating spray-json wiring in the repository.
 *
 *  Unlike `DataSourceConfigCodec`, this codec has no legacy-tolerance path —
 *  pipeline step config has always been JSON text in `pipeline_steps.config`,
 *  so the codec just needs to round-trip the known shapes per kind. */
object PipelineStepConfigCodec {

  // ── Per-config formatters (mirror of those in PipelineStepProtocol) ──────
  //
  // Duplicated here intentionally — the codec is a standalone object used by
  // the repository, so it can't pick up the trait's implicit formatters. The
  // shapes are identical to `PipelineStepProtocol.*ConfigFormat`; any divergence
  // is a bug.
  private implicit val renameCfgFmt: RootJsonFormat[RenameConfig]            = jsonFormat1(RenameConfig.apply)
  private implicit val filterCondFmt: RootJsonFormat[FilterCondition]        = jsonFormat3(FilterCondition.apply)
  private implicit val filterCfgFmt: RootJsonFormat[FilterConfig]            = jsonFormat2(FilterConfig.apply)
  private implicit val joinCfgFmt: RootJsonFormat[JoinConfig]                = jsonFormat3(JoinConfig.apply)
  private implicit val computeCfgFmt: RootJsonFormat[ComputeConfig]          = jsonFormat3(ComputeConfig.apply)
  private implicit val groupByCfgFmt: RootJsonFormat[GroupByConfig]          = jsonFormat3(GroupByConfig.apply)
  private implicit val castCfgFmt: RootJsonFormat[CastConfig]                = jsonFormat1(CastConfig.apply)
  private implicit val selectCfgFmt: RootJsonFormat[SelectConfig]            = jsonFormat1(SelectConfig.apply)
  private implicit val limitCfgFmt: RootJsonFormat[LimitConfig]              = jsonFormat1(LimitConfig.apply)
  private implicit val sortKeyFmt: RootJsonFormat[SortKey]                   = jsonFormat2(SortKey.apply)
  private implicit val sortCfgFmt: RootJsonFormat[SortConfig]                = jsonFormat1(SortConfig.apply)
  private implicit val aggFieldFmt: RootJsonFormat[AggregateField]           = jsonFormat2(AggregateField.apply)
  private implicit val aggregationFmt: RootJsonFormat[Aggregation]           = jsonFormat3(Aggregation.apply)
  private implicit val aggregateCfgFmt: RootJsonFormat[AggregateConfig]      = jsonFormat2(AggregateConfig.apply)

  // ── Filter-config tolerance ─────────────────────────────────────────────
  //
  // The frontend persists filter steps with `combinator` and `conditions`
  // defaulted on the client. New filters seed `{"combinator":"AND","conditions":[]}`
  // but historical malformed configs may be missing one or the other. Decode
  // with sane defaults to avoid breaking pipelines on read.
  private def decodeFilter(raw: String): FilterConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val combinator = obj.fields.get("combinator") match {
      case Some(JsString(s)) => s
      case _                 => "AND"
    }
    val conditions = obj.fields.get("conditions") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[FilterCondition]).toOption)
      case _ => Vector.empty
    }
    FilterConfig(combinator, conditions)
  }

  // Compute config has an optional `type` field that some legacy rows omit.
  private def decodeCompute(raw: String): ComputeConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val column = obj.fields.get("column") match {
      case Some(JsString(s)) => s
      case _                 => ""
    }
    val expression = obj.fields.get("expression") match {
      case Some(JsString(s)) => s
      case _                 => ""
    }
    val typ = obj.fields.get("type") match {
      case Some(JsString(s)) => Some(s)
      case _                 => None
    }
    ComputeConfig(column, expression, typ)
  }

  /** Aggregate-config tolerance — the pre-CS2c-3a engine treated
   *  `groupBy` / `aggregations` as optional (via `cfg.fields.get(...)
   *  .getOrElse(empty)`). Preserve that behavior at the codec boundary so
   *  existing pipelines that persisted partial configs (e.g. created from
   *  the editor mid-keystroke) continue to round-trip. */
  private def decodeAggregate(raw: String): AggregateConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val groupBy = obj.fields.get("groupBy") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[AggregateField]).toOption)
      case _ => Vector.empty
    }
    val aggregations = obj.fields.get("aggregations") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)
      case _ => Vector.empty
    }
    AggregateConfig(groupBy, aggregations)
  }

  /** Decode a stored config blob into the typed config for the given kind.
   *  Returns a [[scala.util.Try]] so the repository can fail loudly on a
   *  malformed row (corrupted JSON) while still tolerating the small set of
   *  optional-field shapes the frontend has emitted historically. */
  def decode(kind: String, raw: String): Try[Any] = Try {
    kind match {
      case PipelineStepKind.Rename    => JsonParser(raw).convertTo[RenameConfig]
      case PipelineStepKind.Filter    => decodeFilter(raw)
      case PipelineStepKind.Join      => JsonParser(raw).convertTo[JoinConfig]
      case PipelineStepKind.Compute   => decodeCompute(raw)
      case PipelineStepKind.GroupBy   => JsonParser(raw).convertTo[GroupByConfig]
      case PipelineStepKind.Cast      => JsonParser(raw).convertTo[CastConfig]
      case PipelineStepKind.Select    => JsonParser(raw).convertTo[SelectConfig]
      case PipelineStepKind.Limit     => JsonParser(raw).convertTo[LimitConfig]
      case PipelineStepKind.Sort      => JsonParser(raw).convertTo[SortConfig]
      case PipelineStepKind.Aggregate => decodeAggregate(raw)
      case other                      => throw new IllegalArgumentException(s"Unknown step op: '$other'")
    }
  }

  /** Encode a typed config back to JSON text for storage. The compactPrint
   *  shape is the canonical on-disk representation. */
  def encode(step: PipelineStep): String = step match {
    case s: RenameStep    => s.config.toJson.compactPrint
    case s: FilterStep    => s.config.toJson.compactPrint
    case s: JoinStep      => s.config.toJson.compactPrint
    case s: ComputeStep   => s.config.toJson.compactPrint
    case s: GroupByStep   => s.config.toJson.compactPrint
    case s: CastStep      => s.config.toJson.compactPrint
    case s: SelectStep    => s.config.toJson.compactPrint
    case s: LimitStep     => s.config.toJson.compactPrint
    case s: SortStep      => s.config.toJson.compactPrint
    case s: AggregateStep => s.config.toJson.compactPrint
  }

  /** Encode an already-decoded typed config (loose-typed Any from the service
   *  layer's `decode(...).get` flow) back to JSON text. Used by the repository
   *  when assembling a row from a non-step container (insert / update flows
   *  hand the codec the typed config plus the kind discriminator). */
  def encodeConfig(config: Any): String = config match {
    case c: RenameConfig    => c.toJson.compactPrint
    case c: FilterConfig    => c.toJson.compactPrint
    case c: JoinConfig      => c.toJson.compactPrint
    case c: ComputeConfig   => c.toJson.compactPrint
    case c: GroupByConfig   => c.toJson.compactPrint
    case c: CastConfig      => c.toJson.compactPrint
    case c: SelectConfig    => c.toJson.compactPrint
    case c: LimitConfig     => c.toJson.compactPrint
    case c: SortConfig      => c.toJson.compactPrint
    case c: AggregateConfig => c.toJson.compactPrint
    case other =>
      throw new IllegalArgumentException(
        s"PipelineStepConfigCodec.encodeConfig: unexpected config type ${other.getClass.getName}"
      )
  }

  /** Encode a typed config JsObject (request payload) directly, used when the
   *  route layer accepts a JsObject and the service hands it to the repo.
   *  The repository invokes [[decode]] to validate the shape before writing. */
  def encodeJsObject(kind: String, configJson: JsObject): Try[String] =
    decode(kind, configJson.compactPrint).map(_ => configJson.compactPrint)
}
