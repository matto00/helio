package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Pipeline summary / CRUD types ────────────────────────────────────────────

final case class CreatePipelineRequest(
    name: String,
    sourceDataSourceId: String,
    outputDataTypeName: String,
    tag: Option[String] = None
)
final case class UpdatePipelineRequest(name: String)
final case class PipelineSummaryResponse(
    id: String,
    name: String,
    sourceDataSourceId: String,
    sourceDataSourceName: String,
    outputDataTypeName: String,
    outputDataTypeId: String,
    lastRunStatus: Option[String],
    lastRunAt: Option[String],
    lastRunRowCount: Option[Long],
    ownerId: Option[String] = None,
    tag: Option[String] = None
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
/** `triggeredByTokenId` (HEL-369): the id of the PAT that authenticated an
 *  external trigger (`POST /api/hooks/run`), or absent for every other
 *  trigger source -- the audit read path this ticket's acceptance criteria
 *  ask for (no new endpoint; existing `GET /api/pipelines/:id/run-history`). */
final case class PipelineRunRecord(
    id: String,
    pipelineId: String,
    status: String,
    startedAt: String,
    completedAt: Option[String],
    rowCount: Option[Int],
    errorLog: Option[String],
    triggerSource: String,
    triggeredByTokenId: Option[String] = None
)
/** `runId` (HEL-369) surfaces the persisted run's id so `HookTriggerService`
 *  can return it to an external caller; `None` only for `previewStep`
 *  (no run is persisted for a step preview). `blocked`/`blockedReason`
 *  (HEL-570, design.md Decision 8): `blocked` is `true` when the run
 *  completed execution without exception but was withheld from writing the
 *  output DataType by the assert fail-policy (see `pipeline-assert-fail-policy`);
 *  `blockedReason` carries the same summary persisted as the run's `errorLog`.
 *  Both default-valued so no existing positional construction breaks. */
final case class RunResultResponse(
    rows: Vector[JsObject],
    rowCount: Int,
    stepRowCounts: Map[String, Long] = Map.empty,
    sourceRowCount: Long = 0L,
    runId: Option[String] = None,
    blocked: Boolean = false,
    blockedReason: Option[String] = None
)

/** `PipelineProtocol extends DataTypeProtocol with PipelineStepProtocol with
 *  PipelineAnalyzeProtocol` because the analyze response references
 *  `SchemaFieldResponse` (lives in `DataTypeProtocol`) and the typed per-step
 *  `*Config` formatters (live in `PipelineStepProtocol`); the analyze API
 *  types/formats themselves live in `PipelineAnalyzeProtocol` (extracted per
 *  HEL-221 design.md decision 8 — behavior-preserving file split to keep both
 *  files under the 250-line soft budget). */
trait PipelineProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with DataTypeProtocol
    with PipelineStepProtocol
    with PipelineAnalyzeProtocol {

  // CRUD formats
  implicit val createPipelineRequestFormat: RootJsonFormat[CreatePipelineRequest]     = jsonFormat4(CreatePipelineRequest.apply)
  implicit val updatePipelineRequestFormat: RootJsonFormat[UpdatePipelineRequest]     = jsonFormat1(UpdatePipelineRequest.apply)
  implicit val pipelineSummaryResponseFormat: RootJsonFormat[PipelineSummaryResponse] = jsonFormat11(PipelineSummaryResponse.apply)

  // Run formats
  implicit val pipelineRunRecordFormat: RootJsonFormat[PipelineRunRecord] = jsonFormat9(PipelineRunRecord.apply)
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

  implicit val runResultResponseFormat: RootJsonFormat[RunResultResponse] = jsonFormat7(RunResultResponse.apply)
}
