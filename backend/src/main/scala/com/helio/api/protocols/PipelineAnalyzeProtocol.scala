package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.{
  AggregateConfig,
  CastConfig,
  ChunkByTokenCountConfig,
  ComputeConfig,
  ExtractHeadingsConfig,
  FilterConfig,
  GroupByConfig,
  JoinConfig,
  LimitConfig,
  PipelineStepKind,
  RenameConfig,
  SelectConfig,
  SortConfig,
  SplitTextConfig
}
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

final case class PipelineAnalyzeResponse(
    id:                   String,
    name:                 String,
    sourceDataSourceName: String,
    outputDataTypeName:   String,
    outputDataTypeId:     String,
    sourceSchema:         Vector[SchemaFieldResponse],
    steps:                Vector[AnalyzeStepResponse]
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

  // ── Analyze formats (per-subtype, dispatched on `type`) ──────────────────
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
        case Some(other)                                => deserializationError(s"Unknown analyze step type: $other")
        case None                                       => deserializationError("Missing 'type' discriminator on analyze step")
      }
  }

  implicit val pipelineAnalyzeResponseFormat: RootJsonFormat[PipelineAnalyzeResponse] = jsonFormat7(PipelineAnalyzeResponse.apply)
}
