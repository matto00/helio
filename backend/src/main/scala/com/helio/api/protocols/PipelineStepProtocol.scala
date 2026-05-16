package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Pipeline step API types (CS2c-3a) ────────────────────────────────────────
//
// Wire shape is a discriminated union on `type` with a typed `config` object
// per subtype — replaces the pre-CS2c-3a `{ op: string, config: string }`
// shape that stored config as a JSON-stringified blob inside a JSON envelope.

/** Common shape mirrored by every per-subtype response. The discriminator is
 *  the `type` JSON field — `kind` here is just the Scala-side accessor used
 *  by the formatter to emit the right discriminator string. */
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

/** Create request — the `type` discriminator selects which subtype's config
 *  shape `config` must conform to. The route layer hands the typed
 *  [[PipelineStep]] off to the service after [[PipelineStepRequestBinding]]
 *  validates the `type` / `config` pair. */
final case class CreatePipelineStepRequest(`type`: String, config: JsObject)

/** PATCH request — `type` is optional. If present and different from the
 *  persisted row's kind, the service returns 400 (cross-type PATCH locked,
 *  matching CS2c-2 DataSource policy). */
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
  }
}

/** Per-domain protocol trait for the PipelineStep ADT — owns the
 *  discriminated-union formatters for request/response wire shapes plus the
 *  typed per-subtype `*Config` formatters used inside them. Mixed into
 *  [[PipelineProtocol]] (which adds the pipeline summary / analyze / run
 *  formatters on top). */
trait PipelineStepProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  // ── Typed config formatters (used by both wire formats and the codec) ────
  implicit val renameConfigFormat: RootJsonFormat[RenameConfig]                 = jsonFormat1(RenameConfig.apply)
  implicit val filterConditionFormat: RootJsonFormat[FilterCondition]           = jsonFormat3(FilterCondition.apply)
  implicit val filterConfigFormat: RootJsonFormat[FilterConfig]                 = jsonFormat2(FilterConfig.apply)
  implicit val joinConfigFormat: RootJsonFormat[JoinConfig]                     = jsonFormat3(JoinConfig.apply)
  implicit val computeConfigFormat: RootJsonFormat[ComputeConfig]               = jsonFormat3(ComputeConfig.apply)
  implicit val groupByConfigFormat: RootJsonFormat[GroupByConfig]               = jsonFormat3(GroupByConfig.apply)
  implicit val castConfigFormat: RootJsonFormat[CastConfig]                     = jsonFormat1(CastConfig.apply)
  implicit val selectConfigFormat: RootJsonFormat[SelectConfig]                 = jsonFormat1(SelectConfig.apply)
  implicit val limitConfigFormat: RootJsonFormat[LimitConfig]                   = jsonFormat1(LimitConfig.apply)
  implicit val sortKeyFormat: RootJsonFormat[SortKey]                           = jsonFormat2(SortKey.apply)
  implicit val sortConfigFormat: RootJsonFormat[SortConfig]                     = jsonFormat1(SortConfig.apply)
  implicit val aggregateFieldFormat: RootJsonFormat[AggregateField]             = jsonFormat2(AggregateField.apply)
  implicit val aggregationFormat: RootJsonFormat[Aggregation]                   = jsonFormat3(Aggregation.apply)
  implicit val aggregateConfigFormat: RootJsonFormat[AggregateConfig]           = jsonFormat2(AggregateConfig.apply)

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

  /** Discriminated-union format for the [[PipelineStepResponse]] ADT. Dispatch
   *  is on the top-level `type` field; inbound deserialization is the inverse
   *  and rejects unknown discriminators with `deserializationError`. */
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
        case Some(other)                                => deserializationError(s"Unknown PipelineStep type: $other")
        case None                                       => deserializationError("Missing 'type' discriminator on PipelineStep")
      }
  }

  implicit val createPipelineStepRequestFormat: RootJsonFormat[CreatePipelineStepRequest] = jsonFormat2(CreatePipelineStepRequest.apply)
  implicit val updatePipelineStepRequestFormat: RootJsonFormat[UpdatePipelineStepRequest] = jsonFormat3(UpdatePipelineStepRequest.apply)
}
