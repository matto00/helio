package com.helio.api.protocols.pipelines

import com.helio.api.protocols.sources.{CsvSourceConfigPayload, DataSourceProtocol, DataSourceResponse, RestApiConfigPayload, SqlSourceConfigPayload, StaticDataPayload}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// A proposal carries NO ids: it describes an (optionally new) data source, an
// ordered list of transform steps, and an output DataType contract. Nothing is
// created until a future apply path (HEL-342) consumes it. The wire shape
// matches schemas/pipelines/pipeline-proposal.schema.json. Mirrors
// DashboardProposalProtocol's hand-written, absent-optional-tolerant reader.

/** `source` is one flat object carrying every inline-kind's config as an
 *  `Option`, only the relevant subset populated — the same pattern
 *  `ProposalPanel` uses for panel-type-dependent fields (design.md D1). The
 *  four per-kind config fields are Scala-side only: on the wire they all
 *  serialize through one shared `"config"` key selected by `type`, never
 *  through four separately-named keys (design.md D1/D5). */
final case class PipelineProposalSource(
    sourceId: Option[String], // existing-source branch
    `type`: Option[String], // inline branch: csv|rest_api|sql|static
    name: Option[String], // inline branch: new source's name
    csvConfig: Option[CsvSourceConfigPayload],
    restConfig: Option[ProposalRestApiConfig],
    sqlConfig: Option[SqlSourceConfigPayload],
    staticConfig: Option[StaticDataPayload],
    // HEL-914: request-scoped id a parentless step's `rootClientId` binds to
    // when `PipelineProposal.roots` has more than one element (design.md D2,
    // R13). Never persisted.
    clientId: Option[String] = None
)

// ── HEL-829: proposal-only REST config, carrying the `newConnector` draft ────
//
// Deliberately a NEW type, never `RestApiConfigPayload` (see design.md
// Decision 2) — `RestApiConfigPayload` is the live `POST /api/sources`
// request body (`CreateSourceRequest.config`), consumed by `SourceService`,
// `SourcePreviewRoutes`, `PipelineService`, `AssistantToolExecutor`, and
// `DataSourceConfigCodec`. Adding a `newConnector` field there would leak
// into all of those. `ProposalRestApiConfig` is proposal-only: it is only
// ever read by `PipelineProposalService.validateRestConfig`/`resolveRestSource`
// and never converted through `RestApiConfigPayload.toDomain`.
//
// `NewConnectorDraft` has no field capable of holding a credential — the
// model can describe the need for a new Connector without ever holding the
// secret, by construction, not by convention.
final case class ProposalRestApiConfig(
    connectorId: Option[String] = None, // references an existing Connector
    url: Option[String] = None,         // legacy bare-URL path — UNCHANGED, still dual-supported
                                         // via SourceService.createRest's implicit-Connector synthesis
    newConnector: Option[NewConnectorDraft] = None, // drafts a not-yet-existing Connector
    endpoint: Option[String] = None,
    method: Option[String] = None,
    queryParams: Option[Map[String, String]] = None,
    headers: Option[Map[String, String]] = None,
    body: Option[String] = None,
    bodyContentType: Option[String] = None,
    rootSelector: Option[String] = None,
    parameters: Option[Map[String, String]] = None
)

/** `retrievalInstructions` is model-authored prose describing where a human
 *  obtains the key for this API — it must NEVER contain an actual key value
 *  (the model has none to leak, by construction; this type has no field that
 *  could carry one). */
final case class NewConnectorDraft(
    name: String,
    baseUrl: String,
    authType: String, // "none" | "bearer" | "api_key" — mirrors ConnectorAuthType
    apiKeyName: Option[String],
    apiKeyPlacement: Option[String], // "header" | "query"
    retrievalInstructions: String
)

object ProposalRestApiConfig {

  /** Maps the shared fields onto `RestApiConfigPayload` — used both by
   *  `PipelineProposalService.resolveRestSource` (the apply-time conversion,
   *  design.md Decision 2) and by `AssistantToolExecutor`/`PipelineService`'s
   *  pre-existing `RestApiConfigPayload`-typed comparison/analysis logic,
   *  which the `PipelineProposalSource.restConfig` type change (task 1.1)
   *  requires those call sites to route through — a mechanical consequence
   *  of the type change, not a behavioral change to either file: `newConnector`
   *  never appears here (never mapped to any `RestApiConfigPayload` field),
   *  so it structurally can never match a `test_connection`-verified config,
   *  exactly the "unverified, not yet resolved" outcome that is already
   *  correct for a draft that has no live endpoint to test yet. */
  def toRestApiConfigPayload(cfg: ProposalRestApiConfig): RestApiConfigPayload =
    RestApiConfigPayload(
      connectorId     = cfg.connectorId,
      url             = cfg.url,
      endpoint        = cfg.endpoint,
      method          = cfg.method,
      queryParams     = cfg.queryParams,
      headers         = cfg.headers,
      body            = cfg.body,
      bodyContentType = cfg.bodyContentType,
      rootSelector    = cfg.rootSelector,
      parameters      = cfg.parameters
    )
}

/** HEL-907 task 1.1: `steps`/`outputs` now reuse P1.3's single-call
 *  transactional shapes (`CreatePipelineTransactionalStepRequest`/
 *  `CreatePipelineTransactionalOutputRequest`, `schemas/pipelines/
 *  create-pipeline-transactional-{step,output}-request.schema.json`)
 *  verbatim — no new step/output DTO, mirroring design.md D2's existing
 *  "reuse, don't invent" convention. A step's `clientId` and an output's
 *  `nodeStepClientId` let a proposal describe branching tree shape and
 *  per-node Output placement before anything has a real persisted id,
 *  exactly like `POST /api/pipelines`'s own single-call create (HEL-906).
 *  `outputs` is OPTIONAL (design.md decision 2 of THIS ticket) — a proposal
 *  may create a pipeline with zero Outputs, to be added later via
 *  `add_output`. `outputDataTypeName` is REMOVED outright (no alias): the
 *  DataType/Metric output contract this field named no longer exists
 *  (HEL-904). */
// HEL-914: `roots` REPLACES the old singular `source` outright -- no alias, no default.
// Non-empty (schema-enforced minItems: 1); a payload carrying `source` is rejected, not
// tolerated (design.md D2, task 2.2).
final case class PipelineProposal(
    pipelineName: String,
    roots: Vector[PipelineProposalSource],
    steps: Vector[CreatePipelineTransactionalStepRequest],
    outputs: Vector[CreatePipelineTransactionalOutputRequest] = Vector.empty
)

/** One applied Output, reported back so a caller (or a combined proposal's
 *  sentinel resolution, `CombinedProposalService`) can address a specific
 *  created Output by id/name — HEL-907 task 1.1/1.3, replacing the old
 *  single `outputDataTypeId: String` (at most one implicit output) now that
 *  a proposal can create zero, one, or many. */
final case class ProposalOutputSummary(id: String, name: String, kind: String, nodeStepId: Option[String])

//
// `source` is `None` for the existing-sourceId branch (nothing new to report)
// and `Some` for the inline branch — mirrors DashboardProposalService's
// "return what was actually built" convention rather than a new envelope type.
final case class PipelineProposalApplyResponse(
    // HEL-914: one element per NEWLY-created inline root, in root order --
    // an existing-sourceId root contributes nothing here (nothing new to
    // report), same convention the old singular `source: Option[...]` used.
    sources: Vector[DataSourceResponse],
    pipeline: PipelineSummaryResponse,
    outputs: Vector[ProposalOutputSummary],
    run: RunResultResponse
)

trait PipelineProposalProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with DataSourceProtocol
    with PipelineStepProtocol
    // HEL-383: apply-proposal's response carries PipelineSummaryResponse +
    // RunResultResponse, both defined/formatted in PipelineProtocol.
    with PipelineProtocol {

  // HEL-829: standard jsonFormatN suffice for both new proposal-only types —
  // unlike PipelineProposalSource, neither needs a hand-written reader/writer
  // (no shared-key multiplexing).
  implicit val newConnectorDraftFormat: RootJsonFormat[NewConnectorDraft] =
    jsonFormat6(NewConnectorDraft.apply)
  implicit val proposalRestApiConfigFormat: RootJsonFormat[ProposalRestApiConfig] =
    jsonFormat11(ProposalRestApiConfig.apply)

  /** Hand-written (not `jsonFormatN`) so the writer can pick whichever of the
   *  four per-kind `Option` fields is populated and serialize *that one* to
   *  the single `"config"` key, and the reader can dispatch on `type` to
   *  decode `"config"` into the matching field, leaving the other three
   *  `None` (design.md D1). No field here is required — an existing-source
   *  proposal supplies only `sourceId`; an inline-source proposal supplies
   *  `type`/`name`/`config` and omits `sourceId`. */
  implicit val pipelineProposalSourceFormat: RootJsonFormat[PipelineProposalSource] =
    new RootJsonFormat[PipelineProposalSource] {
      def write(s: PipelineProposalSource): JsValue = {
        val fields = scala.collection.mutable.Map[String, JsValue]()
        s.sourceId.foreach(v => fields("sourceId") = JsString(v))
        s.`type`.foreach(v => fields("type") = JsString(v))
        s.name.foreach(v => fields("name") = JsString(v))
        s.csvConfig.foreach(v => fields("config") = v.toJson)
        s.restConfig.foreach(v => fields("config") = v.toJson)
        s.sqlConfig.foreach(v => fields("config") = v.toJson)
        s.staticConfig.foreach(v => fields("config") = v.toJson)
        s.clientId.foreach(v => fields("clientId") = JsString(v))
        JsObject(fields.toMap)
      }

      def read(json: JsValue): PipelineProposalSource = {
        val obj    = json.asJsObject
        val kind   = obj.fields.get("type").map(_.convertTo[String])
        val config = obj.fields.get("config")

        val (csvConfig, restConfig, sqlConfig, staticConfig) = kind match {
          case Some("csv")      => (config.map(_.convertTo[CsvSourceConfigPayload]), None, None, None)
          case Some("rest_api") => (None, config.map(_.convertTo[ProposalRestApiConfig]), None, None)
          case Some("sql")      => (None, None, config.map(_.convertTo[SqlSourceConfigPayload]), None)
          case Some("static")   => (None, None, None, config.map(_.convertTo[StaticDataPayload]))
          case _                => (None, None, None, None)
        }

        PipelineProposalSource(
          sourceId     = obj.fields.get("sourceId").map(_.convertTo[String]),
          `type`       = kind,
          name         = obj.fields.get("name").map(_.convertTo[String]),
          csvConfig    = csvConfig,
          restConfig   = restConfig,
          sqlConfig    = sqlConfig,
          staticConfig = staticConfig,
          clientId     = obj.fields.get("clientId").map(_.convertTo[String])
        )
      }
    }

  /** `pipelineName`/`source`/`steps` are required — `deserializationError` on
   *  each when absent, mirroring `proposalPanelFormat`'s treatment of
   *  `ProposalPanel`'s own two required fields (design.md D5). `outputs`
   *  (HEL-907 task 1.1) is OPTIONAL, defaulting to empty when absent — a
   *  proposal may create a pipeline with zero Outputs. */
  implicit val pipelineProposalFormat: RootJsonFormat[PipelineProposal] =
    new RootJsonFormat[PipelineProposal] {
      def write(p: PipelineProposal): JsValue = {
        val fields = scala.collection.mutable.Map[String, JsValue](
          "pipelineName" -> JsString(p.pipelineName),
          "roots"        -> JsArray(p.roots.map(_.toJson)),
          "steps"        -> JsArray(p.steps.map(_.toJson))
        )
        if (p.outputs.nonEmpty) fields("outputs") = JsArray(p.outputs.map(_.toJson))
        JsObject(fields.toMap)
      }

      def read(json: JsValue): PipelineProposal = {
        val obj = json.asJsObject
        // HEL-914 task 2.2/6b.1: `source` is REJECTED outright, not tolerated
        // as an unknown key -- a tolerant reader here would silently discard
        // the caller's stated sources (design.md D7).
        if (obj.fields.contains("source")) {
          deserializationError(
            "pipeline proposal 'source' is no longer accepted -- use 'roots' (a non-empty array)"
          )
        }
        val roots = obj.fields
          .get("roots")
          .map(_.convertTo[Vector[PipelineProposalSource]])
          .getOrElse(deserializationError("pipeline proposal 'roots' is required"))
        if (roots.isEmpty) {
          deserializationError("pipeline proposal 'roots' must be non-empty")
        }
        PipelineProposal(
          pipelineName = obj.fields
            .get("pipelineName")
            .map(_.convertTo[String])
            .getOrElse(deserializationError("pipeline proposal 'pipelineName' is required")),
          roots = roots,
          steps = obj.fields
            .get("steps")
            .map(_.convertTo[Vector[CreatePipelineTransactionalStepRequest]])
            .getOrElse(deserializationError("pipeline proposal 'steps' is required")),
          outputs = obj.fields
            .get("outputs")
            .map(_.convertTo[Vector[CreatePipelineTransactionalOutputRequest]])
            .getOrElse(Vector.empty)
        )
      }
    }

  implicit val proposalOutputSummaryFormat: RootJsonFormat[ProposalOutputSummary] =
    jsonFormat4(ProposalOutputSummary.apply)

  // `source: Option[DataSourceResponse]` relies on spray-json's built-in
  // Option handling (None omitted from the wire, not written as null) —
  // same convention as CreateSourceResponse.fetchError / TestConnectionResponse.error.
  implicit val pipelineProposalApplyResponseFormat: RootJsonFormat[PipelineProposalApplyResponse] =
    jsonFormat4(PipelineProposalApplyResponse.apply)
}
