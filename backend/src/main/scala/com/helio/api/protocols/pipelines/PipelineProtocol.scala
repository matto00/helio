package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._


final case class CreatePipelineRequest(
    name: String,
    sourceDataSourceId: String,
    tag: Option[String] = None
)
final case class UpdatePipelineRequest(name: String)
final case class PipelineSummaryResponse(
    id: String,
    name: String,
    sourceDataSourceId: String,
    sourceDataSourceName: String,
    lastRunStatus: Option[String],
    lastRunAt: Option[String],
    lastRunRowCount: Option[Long],
    ownerId: Option[String] = None,
    tag: Option[String] = None
)


final case class RunSubmitResponse(runId: String)
final case class RunStatusResponse(
    runId: String,
    status: String,
    rows: Option[JsValue],
    error: Option[String],
    rowCount: Option[Int] = None
)
/** One failing assertion rule's detail (HEL-576, design.md Decision 1) --
 *  `AssertionSummary.failures` carries only the FAILED results; a passing
 *  result is just a count, never a detail. Mirrors
 *  `PipelineRunAssertionRow`'s `kind`/`field`/`severity`/`message` shape,
 *  minus `stepId`/`passed`/`observed` (not needed by the Run History UI's
 *  expandable failing-rules list). */
final case class AssertionFailureDetail(
    kind: String,
    field: Option[String],
    severity: String,
    message: Option[String]
)
/** Per-run pass/fail-by-severity assertion summary (HEL-576, design.md
 *  Decision 1). Non-optional and zero-valued (not `Option`-wrapped) for a run
 *  with no `assert` steps -- mirrors `stepRowCounts: Map[String, Long] =
 *  Map.empty`'s existing empty-collection-default convention rather than
 *  introducing a new "maybe absent" pattern for the frontend to null-check. */
final case class AssertionSummary(
    passed: Int = 0,
    warnFailed: Int = 0,
    errorFailed: Int = 0,
    failures: Vector[AssertionFailureDetail] = Vector.empty
)
/** `triggeredByTokenId` (HEL-369): the id of the PAT that authenticated an
 *  external trigger (`POST /api/hooks/run`), or absent for every other
 *  trigger source -- the audit read path this ticket's acceptance criteria
 *  ask for (no new endpoint; existing `GET /api/pipelines/:id/run-history`).
 *  `assertions` (HEL-576, design.md Decision 1): the run's pass/fail-by-
 *  severity assertion summary, zero-valued for a run with no `assert` steps. */
final case class PipelineRunRecord(
    id: String,
    pipelineId: String,
    status: String,
    startedAt: String,
    completedAt: Option[String],
    rowCount: Option[Int],
    errorLog: Option[String],
    triggerSource: String,
    triggeredByTokenId: Option[String] = None,
    assertions: AssertionSummary = AssertionSummary()
)
/** `GET /api/types/:id/assertion-status` response (HEL-576, design.md
 *  Decision 6): `invalid` is true when the DataType's owning pipeline's
 *  latest NON-DRY run has at least one persisted error-severity failed
 *  assertion; `failedRuleCount` is the count of such failures. */
final case class AssertionStatusResponse(
    dataTypeId: String,
    invalid: Boolean,
    failedRuleCount: Int
)
/** One truncated read reported on a run result (HEL-861, design D8) -- one entry per truncated
 *  read, primary source included, so a caller can tell WHICH source was cut and by how much. */
final case class TruncatedReadResponse(
    dataSourceName: String,
    rowsRead: Long,
    availableRowCount: Option[Long]
)

/** `runId` (HEL-369) surfaces the persisted run's id so `HookTriggerService`
 *  can return it to an external caller; `None` only for `previewStep`
 *  (no run is persisted for a step preview). `blocked`/`blockedReason`
 *  (HEL-570, design.md Decision 8): `blocked` is `true` when the run
 *  completed execution without exception but was withheld from writing the
 *  output DataType by the assert fail-policy (see `pipeline-assert-fail-policy`);
 *  `blockedReason` carries the same summary persisted as the run's `errorLog`.
 *  Both default-valued so no existing positional construction breaks.
 *
 *  HEL-861 (design D4/D8): `sourceTruncated` is run-WIDE -- true if ANY read in the run
 *  (primary or a `join`/`union`/`lookup` secondary source) was truncated by the row cap.
 *  `sourceAvailableRowCount` is scoped to the PRIMARY source only, and only when its driver
 *  could measure a true total (REST always can; SQL never can) -- never a run-wide total.
 *  `truncationNotice` is composed once, server-side, and is `None` when nothing was truncated,
 *  so every surface (API, MCP, UI) reads the identical, already-correct sentence.
 *  `sourceRowCount` keeps its pre-existing meaning (rows actually read) unchanged. */
final case class RunResultResponse(
    rows: Vector[JsObject],
    rowCount: Int,
    stepRowCounts: Map[String, Long] = Map.empty,
    sourceRowCount: Long = 0L,
    runId: Option[String] = None,
    blocked: Boolean = false,
    blockedReason: Option[String] = None,
    sourceTruncated: Boolean = false,
    sourceAvailableRowCount: Option[Long] = None,
    truncationNotice: Option[String] = None,
    truncatedReads: Vector[TruncatedReadResponse] = Vector.empty
)

/** `PipelineProtocol extends PipelineStepProtocol with PipelineAnalyzeProtocol`
 *  because the typed per-step `*Config` formatters live in
 *  `PipelineStepProtocol`; the analyze API types/formats themselves live in
 *  `PipelineAnalyzeProtocol` (extracted per HEL-221 design.md decision 8 —
 *  behavior-preserving file split to keep both files under the 250-line soft
 *  budget). HEL-904 task 4.1: `DataTypeProtocol` mixin removed outright —
 *  DataTypes no longer exist. */
trait PipelineProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with PipelineStepProtocol
    with PipelineAnalyzeProtocol {

  implicit val createPipelineRequestFormat: RootJsonFormat[CreatePipelineRequest]     = jsonFormat3(CreatePipelineRequest.apply)
  implicit val updatePipelineRequestFormat: RootJsonFormat[UpdatePipelineRequest]     = jsonFormat1(UpdatePipelineRequest.apply)
  implicit val pipelineSummaryResponseFormat: RootJsonFormat[PipelineSummaryResponse] = jsonFormat9(PipelineSummaryResponse.apply)

  implicit val assertionFailureDetailFormat: RootJsonFormat[AssertionFailureDetail] =
    jsonFormat4(AssertionFailureDetail.apply)
  implicit val assertionSummaryFormat: RootJsonFormat[AssertionSummary]           = jsonFormat4(AssertionSummary.apply)
  implicit val assertionStatusResponseFormat: RootJsonFormat[AssertionStatusResponse] =
    jsonFormat3(AssertionStatusResponse.apply)
  implicit val pipelineRunRecordFormat: RootJsonFormat[PipelineRunRecord] = jsonFormat10(PipelineRunRecord.apply)
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

  // HEL-861: MUST be declared ABOVE runResultResponseFormat -- implicit vals in a spray-json
  // protocol trait initialize in declaration order, so declaring this after runResultResponseFormat
  // compiles but yields a null implicit at runtime.
  implicit val truncatedReadResponseFormat: RootJsonFormat[TruncatedReadResponse] =
    jsonFormat3(TruncatedReadResponse.apply)
  implicit val runResultResponseFormat: RootJsonFormat[RunResultResponse] = jsonFormat11(RunResultResponse.apply)
}
