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
    staticConfig: Option[StaticDataPayload]
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

/** `steps` reuses `CreatePipelineStepRequest` verbatim (design.md D2) — no new
 *  step DTO. Every field here is non-`Option`: all four are required by the
 *  schema (`pipelineName`, `source`, `outputDataTypeName`, `steps`). */
final case class PipelineProposal(
    pipelineName: String,
    source: PipelineProposalSource,
    outputDataTypeName: String,
    steps: Vector[CreatePipelineStepRequest]
)

//
// `source` is `None` for the existing-sourceId branch (nothing new to report)
// and `Some` for the inline branch — mirrors DashboardProposalService's
// "return what was actually built" convention rather than a new envelope type.
final case class PipelineProposalApplyResponse(
    source: Option[DataSourceResponse],
    pipeline: PipelineSummaryResponse,
    outputDataTypeId: String,
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
          staticConfig = staticConfig
        )
      }
    }

  /** `pipelineName`/`source`/`outputDataTypeName`/`steps` are all required
   *  (none is `Option` on `PipelineProposal`) — `deserializationError` on
   *  each when absent, mirroring `proposalPanelFormat`'s treatment of
   *  `ProposalPanel`'s own two required fields (design.md D5). */
  implicit val pipelineProposalFormat: RootJsonFormat[PipelineProposal] =
    new RootJsonFormat[PipelineProposal] {
      def write(p: PipelineProposal): JsValue = JsObject(
        "pipelineName"       -> JsString(p.pipelineName),
        "source"             -> p.source.toJson,
        "outputDataTypeName" -> JsString(p.outputDataTypeName),
        "steps"              -> JsArray(p.steps.map(_.toJson))
      )

      def read(json: JsValue): PipelineProposal = {
        val obj = json.asJsObject
        PipelineProposal(
          pipelineName = obj.fields
            .get("pipelineName")
            .map(_.convertTo[String])
            .getOrElse(deserializationError("pipeline proposal 'pipelineName' is required")),
          source = obj.fields
            .get("source")
            .map(_.convertTo[PipelineProposalSource])
            .getOrElse(deserializationError("pipeline proposal 'source' is required")),
          outputDataTypeName = obj.fields
            .get("outputDataTypeName")
            .map(_.convertTo[String])
            .getOrElse(deserializationError("pipeline proposal 'outputDataTypeName' is required")),
          steps = obj.fields
            .get("steps")
            .map(_.convertTo[Vector[CreatePipelineStepRequest]])
            .getOrElse(deserializationError("pipeline proposal 'steps' is required"))
        )
      }
    }

  // `source: Option[DataSourceResponse]` relies on spray-json's built-in
  // Option handling (None omitted from the wire, not written as null) —
  // same convention as CreateSourceResponse.fetchError / TestConnectionResponse.error.
  implicit val pipelineProposalApplyResponseFormat: RootJsonFormat[PipelineProposalApplyResponse] =
    jsonFormat4(PipelineProposalApplyResponse.apply)
}
