package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Pipeline step API types (CS2c-3a cycle 3) ────────────────────────────────
//
// Wire shape is a discriminated union on `type` with a typed `config` object
// per subtype. Per-config JSON formats are owned by each step module under
// [[com.helio.domain.steps]] and re-exported from `com.helio.domain` via the
// package object; this file only adds the per-subtype response wrappers and
// the union-format dispatch.

/** Common shape mirrored by every per-subtype response. The discriminator is
 *  the `type` JSON field — `kind` here is just the Scala-side accessor. */
sealed trait PipelineStepResponse {
  def id: String
  def pipelineId: String
  def position: Int
  def createdAt: String
  def updatedAt: String
  def `type`: String
}

final case class RenameStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: RenameConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Rename }

final case class FilterStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: FilterConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Filter }

final case class JoinStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: JoinConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Join }

final case class ComputeStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: ComputeConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Compute }

final case class GroupByStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: GroupByConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.GroupBy }

final case class CastStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: CastConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Cast }

final case class SelectStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: SelectConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Select }

final case class LimitStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: LimitConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Limit }

final case class SortStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: SortConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Sort }

final case class AggregateStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: AggregateConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Aggregate }

final case class SplitTextStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: SplitTextConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.SplitText }

final case class ExtractHeadingsStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: ExtractHeadingsConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.ExtractHeadings }

final case class ChunkByTokenCountStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: ChunkByTokenCountConfig
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.ChunkByTokenCount }

/** Create request — the `type` discriminator selects which subtype's config
 *  shape `config` must conform to. */
final case class CreatePipelineStepRequest(`type`: String, config: JsObject)

/** PATCH request — `type` is optional. If present and different from the
 *  persisted row's kind, the service returns 400 (cross-type PATCH locked). */
final case class UpdatePipelineStepRequest(`type`: Option[String], config: Option[JsObject], position: Option[Int])

object PipelineStepResponse {
  /** Project the domain ADT into the discriminated-union wire response. */
  def fromDomain(step: PipelineStep): PipelineStepResponse = step match {
    case s: RenameStep    => RenameStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: FilterStep    => FilterStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: JoinStep      => JoinStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: ComputeStep   => ComputeStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: GroupByStep   => GroupByStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: CastStep      => CastStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: SelectStep    => SelectStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: LimitStep     => LimitStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: SortStep      => SortStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: AggregateStep => AggregateStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: SplitTextStep => SplitTextStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: ExtractHeadingsStep => ExtractHeadingsStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
    case s: ChunkByTokenCountStep => ChunkByTokenCountStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config)
  }
}

/** Per-domain protocol trait for the PipelineStep ADT — owns the
 *  discriminated-union formatters for request/response wire shapes. Each
 *  step's per-config JSON format is sourced from its step module's companion
 *  (`SomeConfig.format`), keeping the codec, the wire format, and the
 *  tolerance defaults co-located per kind. */
trait PipelineStepProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  // ── Typed config formatters re-exported from the per-step modules ───────
  //
  // Each step module exposes its own RootJsonFormat as `SomeConfig.format`.
  // The protocol-trait scope needs them as `implicit val` to satisfy the
  // jsonFormat6-derived response formatters below.
  implicit val renameConfigFormat: RootJsonFormat[RenameConfig]       = RenameConfig.format
  implicit val filterConditionFormat: RootJsonFormat[FilterCondition] = FilterCondition.format
  implicit val filterConfigFormat: RootJsonFormat[FilterConfig]       = FilterConfig.format
  implicit val joinConfigFormat: RootJsonFormat[JoinConfig]           = JoinConfig.format
  implicit val computeConfigFormat: RootJsonFormat[ComputeConfig]     = ComputeConfig.format
  implicit val groupByConfigFormat: RootJsonFormat[GroupByConfig]     = GroupByConfig.format
  implicit val castConfigFormat: RootJsonFormat[CastConfig]           = CastConfig.format
  implicit val selectConfigFormat: RootJsonFormat[SelectConfig]       = SelectConfig.format
  implicit val limitConfigFormat: RootJsonFormat[LimitConfig]         = LimitConfig.format
  implicit val sortKeyFormat: RootJsonFormat[SortKey]                 = SortKey.format
  implicit val sortConfigFormat: RootJsonFormat[SortConfig]           = SortConfig.format
  implicit val aggregateFieldFormat: RootJsonFormat[AggregateField]   = AggregateField.format
  implicit val aggregationFormat: RootJsonFormat[Aggregation]         = Aggregation.format
  implicit val aggregateConfigFormat: RootJsonFormat[AggregateConfig] = AggregateConfig.format
  implicit val splitTextConfigFormat: RootJsonFormat[SplitTextConfig] = SplitTextConfig.format
  implicit val extractHeadingsConfigFormat: RootJsonFormat[ExtractHeadingsConfig] = ExtractHeadingsConfig.format
  implicit val chunkByTokenCountConfigFormat: RootJsonFormat[ChunkByTokenCountConfig] = ChunkByTokenCountConfig.format

  // ── Per-subtype response formatters (private — only consumed by the union) ─
  private val renameStepResponseFormat: RootJsonFormat[RenameStepResponse]       = jsonFormat6(RenameStepResponse.apply)
  private val filterStepResponseFormat: RootJsonFormat[FilterStepResponse]       = jsonFormat6(FilterStepResponse.apply)
  private val joinStepResponseFormat: RootJsonFormat[JoinStepResponse]           = jsonFormat6(JoinStepResponse.apply)
  private val computeStepResponseFormat: RootJsonFormat[ComputeStepResponse]     = jsonFormat6(ComputeStepResponse.apply)
  private val groupByStepResponseFormat: RootJsonFormat[GroupByStepResponse]     = jsonFormat6(GroupByStepResponse.apply)
  private val castStepResponseFormat: RootJsonFormat[CastStepResponse]           = jsonFormat6(CastStepResponse.apply)
  private val selectStepResponseFormat: RootJsonFormat[SelectStepResponse]       = jsonFormat6(SelectStepResponse.apply)
  private val limitStepResponseFormat: RootJsonFormat[LimitStepResponse]         = jsonFormat6(LimitStepResponse.apply)
  private val sortStepResponseFormat: RootJsonFormat[SortStepResponse]           = jsonFormat6(SortStepResponse.apply)
  private val aggregateStepResponseFormat: RootJsonFormat[AggregateStepResponse] = jsonFormat6(AggregateStepResponse.apply)
  private val splitTextStepResponseFormat: RootJsonFormat[SplitTextStepResponse] = jsonFormat6(SplitTextStepResponse.apply)
  private val extractHeadingsStepResponseFormat: RootJsonFormat[ExtractHeadingsStepResponse] = jsonFormat6(ExtractHeadingsStepResponse.apply)
  private val chunkByTokenCountStepResponseFormat: RootJsonFormat[ChunkByTokenCountStepResponse] = jsonFormat6(ChunkByTokenCountStepResponse.apply)

  /** Discriminated-union format for the [[PipelineStepResponse]] ADT. Dispatch
   *  is on the top-level `type` field; inbound deserialization rejects unknown
   *  discriminators. */
  implicit object pipelineStepResponseFormat extends RootJsonFormat[PipelineStepResponse] {
    override def write(s: PipelineStepResponse): JsValue = {
      val inner = s match {
        case r: RenameStepResponse    => renameStepResponseFormat.write(r).asJsObject
        case f: FilterStepResponse    => filterStepResponseFormat.write(f).asJsObject
        case j: JoinStepResponse      => joinStepResponseFormat.write(j).asJsObject
        case c: ComputeStepResponse   => computeStepResponseFormat.write(c).asJsObject
        case g: GroupByStepResponse   => groupByStepResponseFormat.write(g).asJsObject
        case c: CastStepResponse      => castStepResponseFormat.write(c).asJsObject
        case s: SelectStepResponse    => selectStepResponseFormat.write(s).asJsObject
        case l: LimitStepResponse     => limitStepResponseFormat.write(l).asJsObject
        case s: SortStepResponse      => sortStepResponseFormat.write(s).asJsObject
        case a: AggregateStepResponse => aggregateStepResponseFormat.write(a).asJsObject
        case t: SplitTextStepResponse => splitTextStepResponseFormat.write(t).asJsObject
        case e: ExtractHeadingsStepResponse => extractHeadingsStepResponseFormat.write(e).asJsObject
        case k: ChunkByTokenCountStepResponse => chunkByTokenCountStepResponseFormat.write(k).asJsObject
      }
      JsObject(inner.fields + ("type" -> JsString(s.`type`)))
    }

    override def read(json: JsValue): PipelineStepResponse =
      json.asJsObject.fields.get("type") match {
        case Some(JsString(PipelineStepKind.Rename))    => renameStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Filter))    => filterStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Join))      => joinStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Compute))   => computeStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.GroupBy))   => groupByStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Cast))      => castStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Select))    => selectStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Limit))     => limitStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Sort))      => sortStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Aggregate)) => aggregateStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.SplitText)) => splitTextStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.ExtractHeadings)) => extractHeadingsStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.ChunkByTokenCount)) => chunkByTokenCountStepResponseFormat.read(json)
        case Some(other)                                => deserializationError(s"Unknown PipelineStep type: $other")
        case None                                       => deserializationError("Missing 'type' discriminator on PipelineStep")
      }
  }

  implicit val createPipelineStepRequestFormat: RootJsonFormat[CreatePipelineStepRequest] = jsonFormat2(CreatePipelineStepRequest.apply)
  implicit val updatePipelineStepRequestFormat: RootJsonFormat[UpdatePipelineStepRequest] = jsonFormat3(UpdatePipelineStepRequest.apply)
}
