package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import com.helio.domain.model._
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
  /** HEL-412: persisted disable/enable flag — always serialized (additive,
   *  never omitted on the wire). */
  def enabled: Boolean
}

final case class RenameStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: RenameConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Rename }

final case class FilterStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: FilterConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Filter }

final case class JoinStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: JoinConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Join }

final case class ComputeStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: ComputeConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Compute }

final case class GroupByStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: GroupByConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.GroupBy }

final case class CastStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: CastConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Cast }

final case class SelectStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: SelectConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Select }

final case class LimitStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: LimitConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Limit }

final case class SortStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: SortConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Sort }

final case class AggregateStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: AggregateConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Aggregate }

final case class SplitTextStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: SplitTextConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.SplitText }

final case class ExtractHeadingsStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: ExtractHeadingsConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.ExtractHeadings }

final case class ChunkByTokenCountStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: ChunkByTokenCountConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.ChunkByTokenCount }

final case class DateBucketStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: DateBucketConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.DateBucket }

final case class PivotStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: PivotConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Pivot }

final case class WindowStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: WindowConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Window }

final case class UnpivotStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: UnpivotConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Unpivot }

final case class DedupeStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: DedupeConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Dedupe }

final case class FillNullStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: FillNullConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.FillNull }

final case class StringOpsStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: StringOpsConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.StringOps }

final case class UnionStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: UnionConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Union }

final case class LookupStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: LookupConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Lookup }

final case class AssertStepResponse(
    id: String, pipelineId: String, position: Int,
    createdAt: String, updatedAt: String, config: AssertConfig, enabled: Boolean = true
) extends PipelineStepResponse { def `type`: String = PipelineStepKind.Assert }

/** Create request — the `type` discriminator selects which subtype's config
 *  shape `config` must conform to. `position` is an OPTIONAL list index
 *  (HEL-410) into the pipeline's current position-sorted step list: absent
 *  means append (the pre-existing behavior); present means insert-at,
 *  validated at the service layer as `0 <= position <= count`. `enabled`
 *  (HEL-412) is OPTIONAL and defaults to `true` (created enabled) when
 *  absent. */
final case class CreatePipelineStepRequest(`type`: String, config: JsObject, position: Option[Int] = None, enabled: Option[Boolean] = None)

/** PATCH request — `type` is optional. If present and different from the
 *  persisted row's kind, the service returns 400 (cross-type PATCH locked).
 *  `enabled` (HEL-412) is OPTIONAL: absent means no change. */
final case class UpdatePipelineStepRequest(`type`: Option[String], config: Option[JsObject], position: Option[Int], enabled: Option[Boolean] = None)

/** `PUT /api/pipelines/:id/steps/order` body (HEL-407) — the pipeline's step
 *  ids in their new relative order. Must be exactly a permutation of the
 *  pipeline's current step ids (validated at the service layer); on success
 *  every step's `position` is set to its index in `stepIds`. */
final case class ReorderPipelineStepsRequest(stepIds: Seq[String])

object PipelineStepResponse {
  /** Project the domain ADT into the discriminated-union wire response. */
  def fromDomain(step: PipelineStep): PipelineStepResponse = step match {
    case s: RenameStep    => RenameStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: FilterStep    => FilterStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: JoinStep      => JoinStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: ComputeStep   => ComputeStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: GroupByStep   => GroupByStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: CastStep      => CastStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: SelectStep    => SelectStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: LimitStep     => LimitStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: SortStep      => SortStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: AggregateStep => AggregateStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: SplitTextStep => SplitTextStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: ExtractHeadingsStep => ExtractHeadingsStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: ChunkByTokenCountStep => ChunkByTokenCountStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: DateBucketStep => DateBucketStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: PivotStep      => PivotStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: WindowStep     => WindowStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: UnpivotStep    => UnpivotStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: DedupeStep     => DedupeStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: FillNullStep   => FillNullStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: StringOpsStep  => StringOpsStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: UnionStep      => UnionStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: LookupStep     => LookupStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
    case s: AssertStep     => AssertStepResponse(s.id.value, s.pipelineId.value, s.position, s.createdAt.toString, s.updatedAt.toString, s.config, s.enabled)
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
  // jsonFormat7-derived response formatters below.
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
  implicit val dateBucketConfigFormat: RootJsonFormat[DateBucketConfig] = DateBucketConfig.format
  implicit val pivotConfigFormat: RootJsonFormat[PivotConfig] = PivotConfig.format
  implicit val windowConfigFormat: RootJsonFormat[WindowConfig] = WindowConfig.format
  implicit val unpivotConfigFormat: RootJsonFormat[UnpivotConfig] = UnpivotConfig.format
  implicit val dedupeConfigFormat: RootJsonFormat[DedupeConfig] = DedupeConfig.format
  implicit val fillNullConfigFormat: RootJsonFormat[FillNullConfig] = FillNullConfig.format
  implicit val stringOpsConfigFormat: RootJsonFormat[StringOpsConfig] = StringOpsConfig.format
  implicit val unionConfigFormat: RootJsonFormat[UnionConfig] = UnionConfig.format
  implicit val lookupConfigFormat: RootJsonFormat[LookupConfig] = LookupConfig.format
  implicit val assertRuleFormat: RootJsonFormat[AssertRule] = AssertRule.format
  implicit val assertConfigFormat: RootJsonFormat[AssertConfig] = AssertConfig.format

  // ── Per-subtype response formatters (private — only consumed by the union) ─
  private val renameStepResponseFormat: RootJsonFormat[RenameStepResponse]       = jsonFormat7(RenameStepResponse.apply)
  private val filterStepResponseFormat: RootJsonFormat[FilterStepResponse]       = jsonFormat7(FilterStepResponse.apply)
  private val joinStepResponseFormat: RootJsonFormat[JoinStepResponse]           = jsonFormat7(JoinStepResponse.apply)
  private val computeStepResponseFormat: RootJsonFormat[ComputeStepResponse]     = jsonFormat7(ComputeStepResponse.apply)
  private val groupByStepResponseFormat: RootJsonFormat[GroupByStepResponse]     = jsonFormat7(GroupByStepResponse.apply)
  private val castStepResponseFormat: RootJsonFormat[CastStepResponse]           = jsonFormat7(CastStepResponse.apply)
  private val selectStepResponseFormat: RootJsonFormat[SelectStepResponse]       = jsonFormat7(SelectStepResponse.apply)
  private val limitStepResponseFormat: RootJsonFormat[LimitStepResponse]         = jsonFormat7(LimitStepResponse.apply)
  private val sortStepResponseFormat: RootJsonFormat[SortStepResponse]           = jsonFormat7(SortStepResponse.apply)
  private val aggregateStepResponseFormat: RootJsonFormat[AggregateStepResponse] = jsonFormat7(AggregateStepResponse.apply)
  private val splitTextStepResponseFormat: RootJsonFormat[SplitTextStepResponse] = jsonFormat7(SplitTextStepResponse.apply)
  private val extractHeadingsStepResponseFormat: RootJsonFormat[ExtractHeadingsStepResponse] = jsonFormat7(ExtractHeadingsStepResponse.apply)
  private val chunkByTokenCountStepResponseFormat: RootJsonFormat[ChunkByTokenCountStepResponse] = jsonFormat7(ChunkByTokenCountStepResponse.apply)
  private val dateBucketStepResponseFormat: RootJsonFormat[DateBucketStepResponse] = jsonFormat7(DateBucketStepResponse.apply)
  private val pivotStepResponseFormat: RootJsonFormat[PivotStepResponse] = jsonFormat7(PivotStepResponse.apply)
  private val windowStepResponseFormat: RootJsonFormat[WindowStepResponse] = jsonFormat7(WindowStepResponse.apply)
  private val unpivotStepResponseFormat: RootJsonFormat[UnpivotStepResponse] = jsonFormat7(UnpivotStepResponse.apply)
  private val dedupeStepResponseFormat: RootJsonFormat[DedupeStepResponse] = jsonFormat7(DedupeStepResponse.apply)
  private val fillNullStepResponseFormat: RootJsonFormat[FillNullStepResponse] = jsonFormat7(FillNullStepResponse.apply)
  private val stringOpsStepResponseFormat: RootJsonFormat[StringOpsStepResponse] = jsonFormat7(StringOpsStepResponse.apply)
  private val unionStepResponseFormat: RootJsonFormat[UnionStepResponse] = jsonFormat7(UnionStepResponse.apply)
  private val lookupStepResponseFormat: RootJsonFormat[LookupStepResponse] = jsonFormat7(LookupStepResponse.apply)
  private val assertStepResponseFormat: RootJsonFormat[AssertStepResponse] = jsonFormat7(AssertStepResponse.apply)

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
        case d: DateBucketStepResponse => dateBucketStepResponseFormat.write(d).asJsObject
        case p: PivotStepResponse      => pivotStepResponseFormat.write(p).asJsObject
        case w: WindowStepResponse     => windowStepResponseFormat.write(w).asJsObject
        case u: UnpivotStepResponse    => unpivotStepResponseFormat.write(u).asJsObject
        case d: DedupeStepResponse     => dedupeStepResponseFormat.write(d).asJsObject
        case n: FillNullStepResponse   => fillNullStepResponseFormat.write(n).asJsObject
        case o: StringOpsStepResponse  => stringOpsStepResponseFormat.write(o).asJsObject
        case u: UnionStepResponse      => unionStepResponseFormat.write(u).asJsObject
        case l: LookupStepResponse     => lookupStepResponseFormat.write(l).asJsObject
        case a: AssertStepResponse     => assertStepResponseFormat.write(a).asJsObject
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
        case Some(JsString(PipelineStepKind.DateBucket)) => dateBucketStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Pivot))      => pivotStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Window))     => windowStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Unpivot))    => unpivotStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Dedupe))     => dedupeStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.FillNull))   => fillNullStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.StringOps))  => stringOpsStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Union))      => unionStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Lookup))     => lookupStepResponseFormat.read(json)
        case Some(JsString(PipelineStepKind.Assert))     => assertStepResponseFormat.read(json)
        case Some(other)                                => deserializationError(s"Unknown PipelineStep type: $other")
        case None                                       => deserializationError("Missing 'type' discriminator on PipelineStep")
      }
  }

  implicit val createPipelineStepRequestFormat: RootJsonFormat[CreatePipelineStepRequest] = jsonFormat4(CreatePipelineStepRequest.apply)
  implicit val updatePipelineStepRequestFormat: RootJsonFormat[UpdatePipelineStepRequest] = jsonFormat4(UpdatePipelineStepRequest.apply)
  implicit val reorderPipelineStepsRequestFormat: RootJsonFormat[ReorderPipelineStepsRequest] = jsonFormat1(ReorderPipelineStepsRequest.apply)
}
