package com.helio.api.protocols.pipelines

import com.helio.api.protocols.sources.{DataSourceProtocol, RestApiConfigPayload, SqlSourceConfigPayload, StaticDataPayload}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._


/** `steps`/`outputs` (HEL-906 task 3.1, additive): the single-call transactional pipeline
 *  creation shape. `steps` are built in array order; each carries a request-scoped `clientId`
 *  (never persisted) so a later step's `parentStepId` can target an EARLIER step in the SAME
 *  request before either has a real, server-assigned id -- `parentStepId` absent means "extend
 *  the trunk from wherever pipeline creation left off" (root, since a freshly created pipeline
 *  has no steps yet); a `parentStepId` present must resolve to an earlier step's `clientId` in
 *  this same request (a 400 if it doesn't -- forward/self/unknown references are all rejected).
 *  `outputs`' `nodeStepClientId` follows the identical resolve-by-`clientId` rule, `None` meaning
 *  the pipeline's raw source. Failure at ANY step or Output (a bad step type/config, an
 *  unresolvable `parentStepId`/`nodeStepClientId`, an invalid Output kind or `fieldMapping`)
 *  rolls back the ENTIRE call -- ratified as a single real Slick transaction (design.md D3,
 *  option iii) spanning `PipelineRepository`/`PipelineStepRepository`/`OutputRepository`
 *  (`PipelineRepository.runTransactionally`, `DbContext.withUserContext`), not a
 *  compensating-delete of the just-created pipeline row. The compensating-delete approach was
 *  an earlier cycle's implementation and was deleted outright once the real transaction
 *  shipped -- see `PipelineService.createTransactional`'s doc. */
/** `rootClientId` (HEL-913 task 7.3a, R13): names WHICH `roots[]` element (by ITS `clientId`)
 *  this PARENTLESS step attaches to, when the request carries more than one root. Meaningless
 *  (and rejected, see `PipelineService.buildStepsAction`) alongside a non-absent `parentStepId`
 *  -- a step with a parent inherits its root implicitly. With a single root, both absent still
 *  resolves unambiguously to that one root (unchanged pre-multi-root behavior). With more than
 *  one root, a parentless step naming NEITHER, or naming an unresolvable `rootClientId`, is each
 *  a named `BadRequest` -- never a silent default to `roots[0]` (the HEL-620 defect class). */
final case class CreatePipelineTransactionalStepRequest(
    clientId: String,
    `type`: String,
    config: JsObject,
    parentStepId: Option[String] = None,
    enabled: Option[Boolean] = None,
    rootClientId: Option[String] = None
)
/** `rootClientId` (HEL-913 task 7.3a-i, R13 extended to Outputs): names WHICH `roots[]` element
 *  this root-bound (`nodeStepClientId` absent) Output attaches to, under the identical rules
 *  `CreatePipelineTransactionalStepRequest.rootClientId` documents -- meaningless (rejected)
 *  alongside a non-absent `nodeStepClientId`, required (named `BadRequest` if absent OR
 *  unresolvable) when the request carries more than one root, and unambiguous when it carries
 *  exactly one. */
final case class CreatePipelineTransactionalOutputRequest(
    nodeStepClientId: Option[String],
    kind: String,
    name: String,
    config: Option[JsObject] = None,
    rootClientId: Option[String] = None
)
/** One element of `CreatePipelineRequest.roots` (HEL-913 R8/R13), and the `add_root`/`POST
 *  /api/pipelines/:id/roots` request body -- the SAME shape for both (R6: "one shape, not
 *  two"). `sourceId` names an EXISTING caller-owned DataSource. Task 7.1a: the OTHER branch,
 *  an inline source spec, mirrors `PipelineProposalSource`'s Option-per-kind pattern -- `type`
 *  (`sql`/`rest_api`/`static`; `csv` is deliberately NOT supported inline, mirroring
 *  `PipelineProposalService.resolveSource`'s own documented gap: no bytes channel exists in a
 *  JSON body for the upload path), `name` for the new source, and exactly one of
 *  `sqlConfig`/`restConfig`/`staticConfig` populated matching `type`. Exactly one of `sourceId`
 *  or `type` must be given (`PipelineService.resolveInlineOrExistingRoot`'s D1-style mutual-
 *  exclusivity check); neither or both is a named 400. `clientId` (R13) is OPTIONAL and lets a
 *  `steps[]`/`outputs[]` entry in the SAME request name this root via `rootClientId`. */
final case class CreatePipelineRootRequest(
    sourceId: Option[String] = None,
    `type`: Option[String] = None,
    name: Option[String] = None,
    sqlConfig: Option[SqlSourceConfigPayload] = None,
    restConfig: Option[RestApiConfigPayload] = None,
    staticConfig: Option[StaticDataPayload] = None,
    clientId: Option[String] = None
)
/** HEL-913 task 7.1 (design.md decision 11, "no deprecation"): `roots` REPLACES the scalar
 *  `sourceDataSourceId` outright -- there is no accepted alias and no default. A caller omitting
 *  `roots` or supplying the legacy scalar field gets a named 400
 *  (`PipelineService.create`/`RequestValidation`), never a silently-empty pipeline and never a
 *  tolerated legacy branch. See `specs/pipeline-create-api/spec.md`'s "A legacy scalar
 *  sourceDataSourceId body is rejected" scenario. */
final case class CreatePipelineRequest(
    name: String,
    roots: Vector[CreatePipelineRootRequest],
    tag: Option[String] = None,
    steps: Vector[CreatePipelineTransactionalStepRequest] = Vector.empty,
    outputs: Vector[CreatePipelineTransactionalOutputRequest] = Vector.empty
)
final case class UpdatePipelineRequest(name: String)
/** `id`/`dataSourceId`/`dataSourceName` per root, in `position` order (HEL-913 task 7.2). */
final case class PipelineRootSummaryResponse(
    id: String,
    dataSourceId: String,
    dataSourceName: String
)
/** `DELETE /api/pipelines/:id/roots/:rootId` response (HEL-913 task 7.4/7.5, R7 phase 2 step 3 --
 *  "report the placement count of the Outputs about to be deleted", mirroring
 *  `DeletePipelineStepResponse`'s report-what-was-removed convention). `removedStepCount` is
 *  every step deleted with this root (its root-level step and its full descendant subtree, not
 *  just the trunk); `removedOutputCount` is every Output deleted as a consequence (step-bound
 *  Outputs on a doomed step, or root-bound Outputs on this root), computed BEFORE the delete so
 *  a DB-level cascade never produces a report that undercounts. */
final case class RemovePipelineRootResponse(removedStepCount: Int, removedOutputCount: Int)
final case class PipelineSummaryResponse(
    id: String,
    name: String,
    // HEL-913 task 7.2a: `sourceDataSourceId`/`sourceDataSourceName` REMOVED outright (the
    // Stage-1 scalar convenience pair, "the lowest-positioned root's source") -- proposal.md's
    // "the single-source read path is deleted, not kept as a fallback" and R3's ban on a
    // response shape re-encoding "position means something" (the lowest-positioned root is not
    // one of R3's three permitted deterministic tiebreaks). `roots[]` is the only source-list
    // shape now; a caller wanting "the first root's source" reads `roots.head` explicitly, which
    // states the assumption instead of hiding it in a field name.
    roots: Vector[PipelineRootSummaryResponse],
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
/** `GET /api/outputs/:id/assertion-status` response (HEL-576, design.md
 *  Decision 6; retargeted from the retired `GET /api/types/:id/assertion-status`
 *  by HEL-906 task 2.5): `invalid` is true when the Output's own node (its
 *  `NodeRef.stepId` -- `None` means the pipeline's raw source, which never has
 *  an `assert` step and is therefore always `invalid = false`) has at least
 *  one persisted error-severity failed assertion on the pipeline's latest
 *  NON-DRY run; `failedRuleCount` is the count of such failures, scoped to
 *  that step alone (not the whole run). */
final case class AssertionStatusResponse(
    outputId: String,
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

/** `POST /api/pipelines/:id/preview?outputId=` response (HEL-906 cycle 10) -- ONE entry per
 *  previewed Output, `preview` reusing the pre-existing single-node `RunResultResponse` shape
 *  unchanged. */
final case class OutputPreviewEntry(outputId: String, preview: RunResultResponse)

/** The uniform envelope BOTH preview arms return: `outputId` present narrows this to exactly
 *  one entry; `outputId` absent fans out to every Output on the pipeline. A caller (P1.4's MCP
 *  `preview_outputs(pipelineId, outputId?)` tool) has exactly one response shape to parse
 *  either way. */
final case class PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])

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
    with PipelineAnalyzeProtocol
    // HEL-913 task 7.1a: needed for `CreatePipelineRootRequest`'s inline-source fields
    // (`sqlConfig`/`restConfig`/`staticConfig`) -- mirrors PipelineProposalProtocol's existing
    // `extends DataSourceProtocol` for the identical reason (JsonProtocols.scala:33).
    with DataSourceProtocol {

  implicit val createPipelineTransactionalStepRequestFormat: RootJsonFormat[CreatePipelineTransactionalStepRequest] =
    jsonFormat6(CreatePipelineTransactionalStepRequest.apply)
  implicit val createPipelineTransactionalOutputRequestFormat: RootJsonFormat[CreatePipelineTransactionalOutputRequest] =
    jsonFormat5(CreatePipelineTransactionalOutputRequest.apply)
  implicit val createPipelineRootRequestFormat: RootJsonFormat[CreatePipelineRootRequest] =
    jsonFormat7(CreatePipelineRootRequest.apply)
  // Hand-rolled (not jsonFormat5): spray-json's macro-generated format does NOT apply a case
  // class's Scala default value for a missing non-`Option` field (only `Option` fields default
  // to `None` when absent) -- `steps`/`outputs` being `Vector[...] = Vector.empty` preserves the
  // pre-HEL-906 "no steps/outputs key at all" simple-create shape for THOSE two fields.
  // `roots` is deliberately NOT given the same treatment (HEL-913 task 7.1, design.md decision
  // 11 "no deprecation"): an absent `roots` key must fail to decode -- `obj.fields("roots")`
  // (not `.get`) throws `DeserializationException` on a missing key, which
  // `RejectionHandler`/`ExceptionHandler` converts to the named 400 the spec's "A legacy scalar
  // sourceDataSourceId body is rejected" scenario requires. A LEGACY body supplying the old
  // scalar `sourceDataSourceId` and omitting `roots` therefore 400s exactly the same way as one
  // omitting `roots` for any other reason -- there is no separate legacy-detection branch,
  // because there is no accepted legacy shape to detect. */
  implicit val createPipelineRequestFormat: RootJsonFormat[CreatePipelineRequest] = new RootJsonFormat[CreatePipelineRequest] {
    override def write(r: CreatePipelineRequest): JsValue = JsObject(
      "name" -> JsString(r.name),
      "roots" -> r.roots.toJson,
      "tag" -> r.tag.map(JsString(_)).getOrElse(JsNull),
      "steps" -> r.steps.toJson,
      "outputs" -> r.outputs.toJson
    )
    override def read(json: JsValue): CreatePipelineRequest = {
      val obj = json.asJsObject
      CreatePipelineRequest(
        name  = obj.fields("name").convertTo[String],
        roots = obj.fields("roots").convertTo[Vector[CreatePipelineRootRequest]],
        tag   = obj.fields.get("tag").flatMap {
          case JsNull => None
          case other  => Some(other.convertTo[String])
        },
        steps   = obj.fields.get("steps").map(_.convertTo[Vector[CreatePipelineTransactionalStepRequest]]).getOrElse(Vector.empty),
        outputs = obj.fields.get("outputs").map(_.convertTo[Vector[CreatePipelineTransactionalOutputRequest]]).getOrElse(Vector.empty)
      )
    }
  }
  implicit val updatePipelineRequestFormat: RootJsonFormat[UpdatePipelineRequest] = jsonFormat1(UpdatePipelineRequest.apply)
  implicit val pipelineRootSummaryResponseFormat: RootJsonFormat[PipelineRootSummaryResponse] =
    jsonFormat3(PipelineRootSummaryResponse.apply)
  implicit val removePipelineRootResponseFormat: RootJsonFormat[RemovePipelineRootResponse] =
    jsonFormat2(RemovePipelineRootResponse.apply)
  implicit val pipelineSummaryResponseFormat: RootJsonFormat[PipelineSummaryResponse] = jsonFormat8(PipelineSummaryResponse.apply)

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

  // HEL-906 cycle 10: same declaration-order constraint as above -- both depend on
  // runResultResponseFormat already being in scope.
  implicit val outputPreviewEntryFormat: RootJsonFormat[OutputPreviewEntry] = jsonFormat2(OutputPreviewEntry.apply)
  implicit val pipelinePreviewResponseFormat: RootJsonFormat[PipelinePreviewResponse] = jsonFormat1(PipelinePreviewResponse.apply)
}
