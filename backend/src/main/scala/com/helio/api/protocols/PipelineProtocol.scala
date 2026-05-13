package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Pipeline summary / CRUD types ────────────────────────────────────────────

final case class CreatePipelineRequest(name: String, sourceDataSourceId: String, outputDataTypeName: String)
final case class UpdatePipelineRequest(name: String)
final case class PipelineSummaryResponse(
    id: String,
    name: String,
    sourceDataSourceName: String,
    outputDataTypeName: String,
    outputDataTypeId: String,
    lastRunStatus: Option[String],
    lastRunAt: Option[String],
    lastRunRowCount: Option[Long]
)

// ── Pipeline step API types ──────────────────────────────────────────────────

final case class CreatePipelineStepRequest(op: String, config: String)
final case class UpdatePipelineStepRequest(op: Option[String], config: Option[String], position: Option[Int])
final case class PipelineStepResponse(
    id: String,
    pipelineId: String,
    position: Int,
    op: String,
    config: String,
    createdAt: String,
    updatedAt: String
)

// ── Pipeline analyze API types ───────────────────────────────────────────────

final case class AnalyzeStepResponse(
    id:              String,
    position:        Int,
    op:              String,
    config:          String,
    inputSchema:     Vector[SchemaFieldResponse],
    outputSchema:    Vector[SchemaFieldResponse],
    validationError: Option[String]
)
final case class PipelineAnalyzeResponse(
    id:                   String,
    name:                 String,
    sourceDataSourceName: String,
    outputDataTypeName:   String,
    outputDataTypeId:     String,
    sourceSchema:         Vector[SchemaFieldResponse],
    steps:                Vector[AnalyzeStepResponse]
)

// ── Pipeline run API types ───────────────────────────────────────────────────

final case class RunSubmitResponse(runId: String)
final case class RunStatusResponse(
    runId: String,
    status: String,
    rows: Option[JsValue],
    error: Option[String],
    rowCount: Option[Int] = None
)
final case class PipelineRunRecord(
    id: String,
    pipelineId: String,
    status: String,
    startedAt: String,
    completedAt: Option[String],
    rowCount: Option[Int],
    errorLog: Option[String]
)
final case class RunResultResponse(
    rows: Vector[JsObject],
    rowCount: Int,
    stepRowCounts: Map[String, Long] = Map.empty,
    sourceRowCount: Long = 0L
)

object PipelineStepResponse {
  import com.helio.infrastructure.PipelineStepRepository.PipelineStepRow
  def fromRow(row: PipelineStepRow): PipelineStepResponse =
    PipelineStepResponse(
      id         = row.id,
      pipelineId = row.pipelineId,
      position   = row.position,
      op         = row.op,
      config     = row.config,
      createdAt  = row.createdAt.toString,
      updatedAt  = row.updatedAt.toString
    )
}

/** `PipelineProtocol extends DataTypeProtocol` because the analyze response
 *  references `SchemaFieldResponse`, which lives in `DataTypeProtocol`.
 *  (Schema-field describes a row shape, a DataType-domain concept that
 *  Pipeline reuses.) */
trait PipelineProtocol extends SprayJsonSupport with DefaultJsonProtocol with DataTypeProtocol {
  // CRUD formats
  implicit val createPipelineRequestFormat: RootJsonFormat[CreatePipelineRequest]     = jsonFormat3(CreatePipelineRequest.apply)
  implicit val updatePipelineRequestFormat: RootJsonFormat[UpdatePipelineRequest]     = jsonFormat1(UpdatePipelineRequest.apply)
  implicit val pipelineSummaryResponseFormat: RootJsonFormat[PipelineSummaryResponse] = jsonFormat8(PipelineSummaryResponse.apply)

  // Step formats
  implicit val createPipelineStepRequestFormat: RootJsonFormat[CreatePipelineStepRequest] = jsonFormat2(CreatePipelineStepRequest.apply)
  implicit val updatePipelineStepRequestFormat: RootJsonFormat[UpdatePipelineStepRequest] = jsonFormat3(UpdatePipelineStepRequest.apply)
  implicit val pipelineStepResponseFormat: RootJsonFormat[PipelineStepResponse]           = jsonFormat7(PipelineStepResponse.apply)

  // Analyze formats
  implicit val analyzeStepResponseFormat: RootJsonFormat[AnalyzeStepResponse]         = jsonFormat7(AnalyzeStepResponse.apply)
  implicit val pipelineAnalyzeResponseFormat: RootJsonFormat[PipelineAnalyzeResponse] = jsonFormat7(PipelineAnalyzeResponse.apply)

  // Run formats
  implicit val pipelineRunRecordFormat: RootJsonFormat[PipelineRunRecord] = jsonFormat7(PipelineRunRecord.apply)
  implicit val runSubmitResponseFormat: RootJsonFormat[RunSubmitResponse] = jsonFormat1(RunSubmitResponse.apply)
  implicit val runStatusResponseFormat: RootJsonFormat[RunStatusResponse] = new RootJsonFormat[RunStatusResponse] {
    def write(r: RunStatusResponse): JsValue = {
      val fields = scala.collection.mutable.Map[String, JsValue](
        "runId"  -> JsString(r.runId),
        "status" -> JsString(r.status)
      )
      r.rows.foreach(v     => fields("rows")     = v)
      r.error.foreach(v    => fields("error")    = JsString(v))
      r.rowCount.foreach(v => fields("rowCount") = JsNumber(v))
      JsObject(fields.toMap)
    }
    def read(json: JsValue): RunStatusResponse = {
      val obj = json.asJsObject
      RunStatusResponse(
        runId    = obj.fields("runId").convertTo[String],
        status   = obj.fields("status").convertTo[String],
        rows     = obj.fields.get("rows"),
        error    = obj.fields.get("error").map(_.convertTo[String]),
        rowCount = obj.fields.get("rowCount").map(_.convertTo[Int])
      )
    }
  }

  implicit val runResultResponseFormat: RootJsonFormat[RunResultResponse] = jsonFormat4(RunResultResponse.apply)
}
