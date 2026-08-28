package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.PipelineStepKind
import com.helio.domain.{AggregateConfig, AssertConfig, CastConfig, ChunkByTokenCountConfig, ComputeConfig, DateBucketConfig, DedupeConfig, ExtractHeadingsConfig, FillNullConfig, FilterConfig, GroupByConfig, JoinConfig, LimitConfig, LookupConfig, PivotConfig, RenameConfig, SelectConfig, SortConfig, SplitTextConfig, StringOpsConfig, UnionConfig, UnpivotConfig, WindowConfig}
import spray.json._

// ── Pipeline analyze API types (extracted from PipelineProtocol.scala per
// HEL-221 design.md decision 8 — behavior-preserving file split, same package
// so no import-site changes are needed elsewhere) ───────────────────────────
//
// After CS2c-3a the analyze response carries the same discriminated-union
// shape as the step CRUD response: `type` discriminator + typed `config`
// object. The frontend's `AnalyzeStepResult` narrows directly off `type`.

/** Common shape mirrored by every per-subtype analyze response. */
sealed trait AnalyzeStepResponse {
  def id: String
  def position: Int
  def inputSchema: Vector[SchemaFieldResponse]
  def outputSchema: Vector[SchemaFieldResponse]
  def validationError: Option[String]
  def `type`: String
}

final case class RenameAnalyzeStepResponse(
    id: String, position: Int, config: RenameConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Rename }

final case class FilterAnalyzeStepResponse(
    id: String, position: Int, config: FilterConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Filter }

final case class JoinAnalyzeStepResponse(
    id: String, position: Int, config: JoinConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Join }

final case class ComputeAnalyzeStepResponse(
    id: String, position: Int, config: ComputeConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Compute }

final case class GroupByAnalyzeStepResponse(
    id: String, position: Int, config: GroupByConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.GroupBy }

final case class CastAnalyzeStepResponse(
    id: String, position: Int, config: CastConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Cast }

final case class SelectAnalyzeStepResponse(
    id: String, position: Int, config: SelectConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Select }

final case class LimitAnalyzeStepResponse(
    id: String, position: Int, config: LimitConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Limit }

final case class SortAnalyzeStepResponse(
    id: String, position: Int, config: SortConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Sort }

final case class AggregateAnalyzeStepResponse(
    id: String, position: Int, config: AggregateConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Aggregate }

final case class SplitTextAnalyzeStepResponse(
    id: String, position: Int, config: SplitTextConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.SplitText }

final case class ExtractHeadingsAnalyzeStepResponse(
    id: String, position: Int, config: ExtractHeadingsConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.ExtractHeadings }

final case class ChunkByTokenCountAnalyzeStepResponse(
    id: String, position: Int, config: ChunkByTokenCountConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.ChunkByTokenCount }

final case class DateBucketAnalyzeStepResponse(
    id: String, position: Int, config: DateBucketConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.DateBucket }

final case class PivotAnalyzeStepResponse(
    id: String, position: Int, config: PivotConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Pivot }

final case class WindowAnalyzeStepResponse(
    id: String, position: Int, config: WindowConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Window }

final case class UnpivotAnalyzeStepResponse(
    id: String, position: Int, config: UnpivotConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Unpivot }

final case class DedupeAnalyzeStepResponse(
    id: String, position: Int, config: DedupeConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Dedupe }

final case class FillNullAnalyzeStepResponse(
    id: String, position: Int, config: FillNullConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.FillNull }

final case class StringOpsAnalyzeStepResponse(
    id: String, position: Int, config: StringOpsConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.StringOps }

final case class UnionAnalyzeStepResponse(
    id: String, position: Int, config: UnionConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Union }

final case class LookupAnalyzeStepResponse(
    id: String, position: Int, config: LookupConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Lookup }

final case class AssertAnalyzeStepResponse(
    id: String, position: Int, config: AssertConfig,
    inputSchema: Vector[SchemaFieldResponse], outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
) extends AnalyzeStepResponse { def `type`: String = PipelineStepKind.Assert }


final case class TypeChangedColumnResponse(name: String, previousType: String, currentType: String)

final case class SourceSchemaDriftResponse(
    addedColumns:       Vector[SchemaFieldResponse],
    removedColumns:     Vector[SchemaFieldResponse],
    typeChangedColumns: Vector[TypeChangedColumnResponse]
)

/** `sourceSchemaDrift` (HEL-462) is computed at analyze time and is absent
 *  when there is no baseline yet — i.e. the pipeline has never run
 *  successfully — or the current source schema matches the baseline exactly.
 *  spray-json omits `None` on the wire. */
final case class PipelineAnalyzeResponse(
    id:                   String,
    name:                 String,
    sourceDataSourceName: String,
    outputDataTypeName:   String,
    outputDataTypeId:     String,
    sourceSchema:         Vector[SchemaFieldResponse],
    steps:                Vector[AnalyzeStepResponse],
    sourceSchemaDrift:    Option[SourceSchemaDriftResponse] = None
)

/** `PipelineAnalyzeProtocol extends DataTypeProtocol with PipelineStepProtocol`
 *  because the analyze response references `SchemaFieldResponse` (lives in
 *  `DataTypeProtocol`) and the typed per-step `*Config` formatters (live in
 *  `PipelineStepProtocol`) — same dependencies the analyze types needed when
 *  they lived in `PipelineProtocol`. */
trait PipelineAnalyzeProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with DataTypeProtocol
    with PipelineStepProtocol {

  private val renameAnalyzeFormat: RootJsonFormat[RenameAnalyzeStepResponse]       = jsonFormat6(RenameAnalyzeStepResponse.apply)
  private val filterAnalyzeFormat: RootJsonFormat[FilterAnalyzeStepResponse]       = jsonFormat6(FilterAnalyzeStepResponse.apply)
  private val joinAnalyzeFormat: RootJsonFormat[JoinAnalyzeStepResponse]           = jsonFormat6(JoinAnalyzeStepResponse.apply)
  private val computeAnalyzeFormat: RootJsonFormat[ComputeAnalyzeStepResponse]     = jsonFormat6(ComputeAnalyzeStepResponse.apply)
  private val groupByAnalyzeFormat: RootJsonFormat[GroupByAnalyzeStepResponse]     = jsonFormat6(GroupByAnalyzeStepResponse.apply)
  private val castAnalyzeFormat: RootJsonFormat[CastAnalyzeStepResponse]           = jsonFormat6(CastAnalyzeStepResponse.apply)
  private val selectAnalyzeFormat: RootJsonFormat[SelectAnalyzeStepResponse]       = jsonFormat6(SelectAnalyzeStepResponse.apply)
  private val limitAnalyzeFormat: RootJsonFormat[LimitAnalyzeStepResponse]         = jsonFormat6(LimitAnalyzeStepResponse.apply)
  private val sortAnalyzeFormat: RootJsonFormat[SortAnalyzeStepResponse]           = jsonFormat6(SortAnalyzeStepResponse.apply)
  private val aggregateAnalyzeFormat: RootJsonFormat[AggregateAnalyzeStepResponse] = jsonFormat6(AggregateAnalyzeStepResponse.apply)
  private val splitTextAnalyzeFormat: RootJsonFormat[SplitTextAnalyzeStepResponse] = jsonFormat6(SplitTextAnalyzeStepResponse.apply)
  private val extractHeadingsAnalyzeFormat: RootJsonFormat[ExtractHeadingsAnalyzeStepResponse] = jsonFormat6(ExtractHeadingsAnalyzeStepResponse.apply)
  private val chunkByTokenCountAnalyzeFormat: RootJsonFormat[ChunkByTokenCountAnalyzeStepResponse] = jsonFormat6(ChunkByTokenCountAnalyzeStepResponse.apply)
  private val dateBucketAnalyzeFormat: RootJsonFormat[DateBucketAnalyzeStepResponse] = jsonFormat6(DateBucketAnalyzeStepResponse.apply)
  private val pivotAnalyzeFormat: RootJsonFormat[PivotAnalyzeStepResponse] = jsonFormat6(PivotAnalyzeStepResponse.apply)
  private val windowAnalyzeFormat: RootJsonFormat[WindowAnalyzeStepResponse] = jsonFormat6(WindowAnalyzeStepResponse.apply)
  private val unpivotAnalyzeFormat: RootJsonFormat[UnpivotAnalyzeStepResponse] = jsonFormat6(UnpivotAnalyzeStepResponse.apply)
  private val dedupeAnalyzeFormat: RootJsonFormat[DedupeAnalyzeStepResponse] = jsonFormat6(DedupeAnalyzeStepResponse.apply)
  private val fillNullAnalyzeFormat: RootJsonFormat[FillNullAnalyzeStepResponse] = jsonFormat6(FillNullAnalyzeStepResponse.apply)
  private val stringOpsAnalyzeFormat: RootJsonFormat[StringOpsAnalyzeStepResponse] = jsonFormat6(StringOpsAnalyzeStepResponse.apply)
  private val unionAnalyzeFormat: RootJsonFormat[UnionAnalyzeStepResponse] = jsonFormat6(UnionAnalyzeStepResponse.apply)
  private val lookupAnalyzeFormat: RootJsonFormat[LookupAnalyzeStepResponse] = jsonFormat6(LookupAnalyzeStepResponse.apply)
  private val assertAnalyzeFormat: RootJsonFormat[AssertAnalyzeStepResponse] = jsonFormat6(AssertAnalyzeStepResponse.apply)

  implicit object analyzeStepResponseFormat extends RootJsonFormat[AnalyzeStepResponse] {
    override def write(s: AnalyzeStepResponse): JsValue = {
      val inner = s match {
        case r: RenameAnalyzeStepResponse    => renameAnalyzeFormat.write(r).asJsObject
        case f: FilterAnalyzeStepResponse    => filterAnalyzeFormat.write(f).asJsObject
        case j: JoinAnalyzeStepResponse      => joinAnalyzeFormat.write(j).asJsObject
        case c: ComputeAnalyzeStepResponse   => computeAnalyzeFormat.write(c).asJsObject
        case g: GroupByAnalyzeStepResponse   => groupByAnalyzeFormat.write(g).asJsObject
        case c: CastAnalyzeStepResponse      => castAnalyzeFormat.write(c).asJsObject
        case s: SelectAnalyzeStepResponse    => selectAnalyzeFormat.write(s).asJsObject
        case l: LimitAnalyzeStepResponse     => limitAnalyzeFormat.write(l).asJsObject
        case s: SortAnalyzeStepResponse      => sortAnalyzeFormat.write(s).asJsObject
        case a: AggregateAnalyzeStepResponse => aggregateAnalyzeFormat.write(a).asJsObject
        case t: SplitTextAnalyzeStepResponse => splitTextAnalyzeFormat.write(t).asJsObject
        case e: ExtractHeadingsAnalyzeStepResponse => extractHeadingsAnalyzeFormat.write(e).asJsObject
        case k: ChunkByTokenCountAnalyzeStepResponse => chunkByTokenCountAnalyzeFormat.write(k).asJsObject
        case d: DateBucketAnalyzeStepResponse => dateBucketAnalyzeFormat.write(d).asJsObject
        case p: PivotAnalyzeStepResponse => pivotAnalyzeFormat.write(p).asJsObject
        case w: WindowAnalyzeStepResponse => windowAnalyzeFormat.write(w).asJsObject
        case u: UnpivotAnalyzeStepResponse => unpivotAnalyzeFormat.write(u).asJsObject
        case d: DedupeAnalyzeStepResponse => dedupeAnalyzeFormat.write(d).asJsObject
        case n: FillNullAnalyzeStepResponse => fillNullAnalyzeFormat.write(n).asJsObject
        case o: StringOpsAnalyzeStepResponse => stringOpsAnalyzeFormat.write(o).asJsObject
        case u: UnionAnalyzeStepResponse => unionAnalyzeFormat.write(u).asJsObject
        case l: LookupAnalyzeStepResponse => lookupAnalyzeFormat.write(l).asJsObject
        case a: AssertAnalyzeStepResponse => assertAnalyzeFormat.write(a).asJsObject
      }
      JsObject(inner.fields + ("type" -> JsString(s.`type`)))
    }
    override def read(json: JsValue): AnalyzeStepResponse =
      json.asJsObject.fields.get("type") match {
        case Some(JsString(PipelineStepKind.Rename))    => renameAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Filter))    => filterAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Join))      => joinAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Compute))   => computeAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.GroupBy))   => groupByAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Cast))      => castAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Select))    => selectAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Limit))     => limitAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Sort))      => sortAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Aggregate)) => aggregateAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.SplitText)) => splitTextAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.ExtractHeadings)) => extractHeadingsAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.ChunkByTokenCount)) => chunkByTokenCountAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.DateBucket)) => dateBucketAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Pivot))      => pivotAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Window))     => windowAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Unpivot))    => unpivotAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Dedupe))     => dedupeAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.FillNull))   => fillNullAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.StringOps))  => stringOpsAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Union))      => unionAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Lookup))     => lookupAnalyzeFormat.read(json)
        case Some(JsString(PipelineStepKind.Assert))     => assertAnalyzeFormat.read(json)
        case Some(other)                                => deserializationError(s"Unknown analyze step type: $other")
        case None                                       => deserializationError("Missing 'type' discriminator on analyze step")
      }
  }

  implicit val typeChangedColumnResponseFormat: RootJsonFormat[TypeChangedColumnResponse] = jsonFormat3(TypeChangedColumnResponse.apply)
  implicit val sourceSchemaDriftResponseFormat: RootJsonFormat[SourceSchemaDriftResponse] = jsonFormat3(SourceSchemaDriftResponse.apply)

  implicit val pipelineAnalyzeResponseFormat: RootJsonFormat[PipelineAnalyzeResponse] = jsonFormat8(PipelineAnalyzeResponse.apply)
}
