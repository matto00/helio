package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.history.{PayloadHistoryConfig, PayloadTierLimit}
import com.helio.domain.model.{DataFieldType, Output, OutputKind}
import com.helio.services.pipelines.OutputFilterCapability
import spray.json._

/** HEL-906 (P1.3 of the Pipelines & Outputs remodel) — wire shapes for
 *  `GET/POST /api/pipelines/:id/outputs` and `GET/PATCH/DELETE
 *  /api/outputs/:id`. `config`/`schema` are carried as raw `JsValue` (like
 *  `PanelResponse.config` / `AlertRuleProtocol.condition`) — an Output's
 *  `config` shape varies by `kind` (known keys per kind: see
 *  `OutputConfigValidation.KnownKeys`) and has no single case class this
 *  protocol could bind to. */
final case class OutputSchemaFieldResponse(name: String, `type`: String)

/** `panelCount` (HEL-909 CR2) is the number of panels currently bound to this
 *  Output. Populated only by `outputResponseFrom`'s `GET /api/outputs` (list)
 *  caller; every single-resource caller (findById/create/update) leaves it
 *  `None`, since none of them needs it and computing it costs an extra
 *  batched query. Replaces the Output picker's prior N+1
 *  `GET /api/outputs/:id/panels`-per-card fetch, which self-rate-limited on
 *  a realistic Output count. */
/** HEL-913 task 5.8a/7.6a/R15: `rootId` names WHICH root this Output is bound to when
 *  `nodeStepId` is absent -- `nodeStepId = None` alone is ambiguous under multi-root ("every
 *  root", not "the root"). Defaulted to `None` so every pre-existing construction site keeps
 *  compiling; `outputResponseFrom` below populates it from `Output.node.rootId`. */
/** HEL-1331: `historyPayloadsAvailable` is read-only -- whether the PIPELINE OWNER's tier keeps payload
 *  runs. `None` = not computed (omitted from the JSON). */
final case class OutputResponse(
    id: String,
    pipelineId: String,
    nodeStepId: Option[String],
    ownerId: String,
    name: String,
    kind: String,
    config: JsValue,
    schema: Vector[OutputSchemaFieldResponse],
    createdAt: String,
    updatedAt: String,
    panelCount: Option[Int] = None,
    rootId: Option[String] = None,
    historyPayloadsAvailable: Option[Boolean] = None,
    historyPayloadLimits: Option[HistoryPayloadLimitsResponse] = None
)

/** HEL-1372: one tier's payload retention, mirroring `PayloadTierLimit` (age in whole days -- `fromEnv` is day-granular). */
final case class HistoryPayloadTierLimitResponse(maxRuns: Int, maxAgeDays: Int)

final case class HistoryPayloadTiersResponse(
    free: HistoryPayloadTierLimitResponse,
    beta: HistoryPayloadTierLimitResponse,
    owner: HistoryPayloadTierLimitResponse
)

/** HEL-1372: read-only snapshot of the running server's `PayloadHistoryConfig`, env overrides included. */
final case class HistoryPayloadLimitsResponse(maxRows: Int, maxBytes: Int, tiers: HistoryPayloadTiersResponse)

object HistoryPayloadLimitsResponse {
  def from(config: PayloadHistoryConfig): HistoryPayloadLimitsResponse = {
    def tier(l: PayloadTierLimit) = HistoryPayloadTierLimitResponse(l.maxRuns, l.maxAge.toDays.toInt)
    HistoryPayloadLimitsResponse(
      config.maxRows,
      config.maxBytes,
      HistoryPayloadTiersResponse(tier(config.free), tier(config.beta), tier(config.owner))
    )
  }
}

final case class OutputsResponse(items: Vector[OutputResponse])

/** HEL-913 task 5.8a: `rootId` and `nodeStepId` are mutually exclusive, enforced by
 *  `OutputService.create` (never a silent default to the pipeline's first root). Both
 *  defaulted to `None`/absent here only so existing single-root-shaped requests (which name
 *  neither, matching today's "root-bound Output" convention) keep decoding unchanged. */
final case class CreateOutputRequest(
    nodeStepId: Option[String],
    kind: String,
    name: String,
    config: Option[JsObject],
    rootId: Option[String] = None
)

/** `name`/`config` absent (`None`) means "leave unchanged" — there is no
 *  null-clearing variant for either field (an Output always has a name and a
 *  config object), so a plain `Option` captures the full absent-vs-present
 *  idiom with no need for the `Option[Option[T]]` wrapper HEL-362/HEL-623
 *  reach for when a field can also be explicitly nulled. `config`, when
 *  present, is shallow-merged into the stored config (each top-level key
 *  replaces that key) rather than replacing `config` wholesale — see
 *  `OutputService.mergeConfig`; its keys are validated per kind by
 *  `OutputConfigValidation` (HEL-1313). */
final case class UpdateOutputRequest(name: Option[String], config: Option[JsObject])

/** `GET /api/outputs/:id/rows` response (HEL-946 Bug C(2)). `metric` (HEL-1326) is the metric value
 *  over the FULL filtered set -- `{field, agg, value}` -- present only for a metric Output when a
 *  filter applied on a page-0 request (else the key is absent); `null` when the metric's config
 *  resolves to no field. `materialized:
 *  false` distinguishes "this node has never had a successful run since the
 *  Output was added — `node_snapshots` was never written for it" from a
 *  genuine empty result set (`materialized: true`, `items` still empty) — a
 *  node that ran and legitimately produced zero rows. See
 *  `PipelineRunRepository.latestSuccessfulCompletedAtInternal` for the
 *  derivation. */
final case class OutputRowsResponse(items: Vector[JsValue], total: Int, offset: Int, limit: Int, materialized: Boolean, metric: Option[JsValue] = None)

/** `GET /api/dashboards/:dashboardId/panels/:panelId/rows` response (public/optional-auth). Same
 *  keys as the generic paged shape it replaced (`items`, `total`, `offset`, `limit`), plus the
 *  optional filtered `metric` (HEL-1326) -- declared LAST, with the same presence rule as
 *  `OutputRowsResponse.metric`. */
final case class PublicPanelRowsResponse(items: Vector[JsValue], total: Int, offset: Int, limit: Int, metric: Option[JsValue] = None)

final case class OutputPanelPlacementResponse(panelId: String, dashboardId: String)

final case class DeleteOutputResponse(removedPanelIds: Vector[String])

/** `GET /api/outputs/:id/filter-capabilities` response (HEL-1188 design.md D1/D5). `operators` is
 *  a fixed-order list of wire strings (`Operator.orderedWireStrings`) -- never a `Set`'s own
 *  iteration order, which spray-json/Scala do not guarantee to be stable. A column absent from
 *  `columns` is not filterable at all (D5: "omitting any column left with an empty operator set" --
 *  never an empty-array entry). */
final case class OutputFilterCapabilityColumnResponse(column: String, operators: Vector[String], controlKinds: Vector[String])
final case class OutputFilterCapabilitiesResponse(columns: Vector[OutputFilterCapabilityColumnResponse])

/** `GET /api/outputs/:id/distinct-values?column=` response (HEL-1188 design.md D4). `values` is
 *  already capped and frequency-ordered by `NodeSnapshotRepository.topDistinctValues` -- this
 *  response shape carries that ordering through verbatim, it does not re-sort. */
final case class OutputDistinctValueResponse(value: String, count: Int)
final case class OutputDistinctValuesResponse(column: String, values: Vector[OutputDistinctValueResponse])

/** `GET /api/dashboards/:dashboardId/panels/:panelId/output-meta` response (HEL-1190 design.md
 *  D8) — the public/anonymous-safe metadata equivalent of `OutputResponse`: exactly enough for a
 *  renderer to pick and configure itself (`kind`/`config`/`schema`), never row data, never an
 *  `id`/`pipelineId`/`nodeStepId`/`ownerId` a public caller has no route to use (HEL-1197 removed
 *  `ownerId`; the frontend already reconstructs `ownerId: null`). */
final case class PublicOutputMetaResponse(
    kind: String,
    config: JsValue,
    schema: Vector[OutputSchemaFieldResponse]
)

trait OutputProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val outputSchemaFieldResponseFormat: RootJsonFormat[OutputSchemaFieldResponse] = jsonFormat2(OutputSchemaFieldResponse)
  implicit val historyPayloadTierLimitResponseFormat: RootJsonFormat[HistoryPayloadTierLimitResponse] = jsonFormat2(HistoryPayloadTierLimitResponse.apply)
  implicit val historyPayloadTiersResponseFormat: RootJsonFormat[HistoryPayloadTiersResponse]         = jsonFormat3(HistoryPayloadTiersResponse.apply)
  implicit val historyPayloadLimitsResponseFormat: RootJsonFormat[HistoryPayloadLimitsResponse]       = jsonFormat3(HistoryPayloadLimitsResponse.apply)
  implicit val outputResponseFormat: RootJsonFormat[OutputResponse]                       = jsonFormat14(OutputResponse.apply)
  implicit val outputsResponseFormat: RootJsonFormat[OutputsResponse]                     = jsonFormat1(OutputsResponse)
  implicit val createOutputRequestFormat: RootJsonFormat[CreateOutputRequest]             = jsonFormat5(CreateOutputRequest)
  implicit val outputRowsResponseFormat: RootJsonFormat[OutputRowsResponse]               = jsonFormat6(OutputRowsResponse)
  implicit val publicPanelRowsResponseFormat: RootJsonFormat[PublicPanelRowsResponse]   = jsonFormat5(PublicPanelRowsResponse)
  implicit val outputPanelPlacementResponseFormat: RootJsonFormat[OutputPanelPlacementResponse] = jsonFormat2(OutputPanelPlacementResponse)
  implicit val deleteOutputResponseFormat: RootJsonFormat[DeleteOutputResponse]           = jsonFormat1(DeleteOutputResponse)
  implicit val outputFilterCapabilityColumnResponseFormat: RootJsonFormat[OutputFilterCapabilityColumnResponse] = jsonFormat3(OutputFilterCapabilityColumnResponse)
  implicit val outputFilterCapabilitiesResponseFormat: RootJsonFormat[OutputFilterCapabilitiesResponse]         = jsonFormat1(OutputFilterCapabilitiesResponse)
  implicit val outputDistinctValueResponseFormat: RootJsonFormat[OutputDistinctValueResponse]   = jsonFormat2(OutputDistinctValueResponse)
  implicit val outputDistinctValuesResponseFormat: RootJsonFormat[OutputDistinctValuesResponse] = jsonFormat2(OutputDistinctValuesResponse)
  implicit val publicOutputMetaResponseFormat: RootJsonFormat[PublicOutputMetaResponse] = jsonFormat3(PublicOutputMetaResponse)

  implicit val updateOutputRequestFormat: RootJsonFormat[UpdateOutputRequest] = jsonFormat2(UpdateOutputRequest)

  /** HEL-1188 — converts the domain `OutputFilterCapability.FilterCapabilityContract` (built
   *  against `NodeSnapshotRepository`'s own data) into its wire shape, ordering each column's
   *  operator set deterministically via `Operator.orderedWireStrings`. */
  def outputFilterCapabilitiesResponseFrom(contract: OutputFilterCapability.FilterCapabilityContract): OutputFilterCapabilitiesResponse =
    OutputFilterCapabilitiesResponse(
      contract.columns.map(c => OutputFilterCapabilityColumnResponse(c.column, OutputFilterCapability.Operator.orderedWireStrings(c.operators), c.controlKinds.toVector.sorted))
    )

  def outputDistinctValuesResponseFrom(column: String, values: Vector[(String, Int)]): OutputDistinctValuesResponse =
    OutputDistinctValuesResponse(column, values.map { case (v, count) => OutputDistinctValueResponse(v, count) })

  // HEL-946: the single-arg overload that used to live here hardcoded
  // `config = JsObject.empty` — three call sites (list-by-pipeline, create,
  // and the top-level list-all) used it by omission and silently returned
  // an empty config on every read, even though the DB write was correct.
  // Deleted rather than kept as a documented default: every caller must now
  // name the config it's passing (even `JsObject.empty`, explicitly) so this
  // trap can't be re-entered by a future call site forgetting the argument.

  def outputResponseFrom(output: Output, config: JsObject): OutputResponse =
    outputResponseFrom(output, config, panelCount = None)

  def outputResponseFrom(output: Output, config: JsObject, panelCount: Option[Int]): OutputResponse =
    OutputResponse(
      id         = output.id.value,
      pipelineId = output.node.pipelineId.value,
      nodeStepId = output.node.stepId.map(_.value),
      ownerId    = output.ownerId.value,
      name       = output.name,
      kind       = OutputKind.asString(output.kind),
      config     = config,
      schema     = output.schema.flatMap(sf => DataFieldType.fromString(sf.`type`).map(t => OutputSchemaFieldResponse(sf.name, DataFieldType.asString(t)))),
      createdAt  = output.createdAt.toString,
      updatedAt  = output.updatedAt.toString,
      panelCount = panelCount,
      rootId     = output.node.rootId.map(_.value)
    )
}
