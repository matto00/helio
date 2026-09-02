package com.helio.api.protocols.workspace

import com.helio.api.protocols.agents.{AgentMemoryEntryResponse, AgentMemoryProtocol, AgentPreferencesProtocol, AgentPreferencesResponse}
import com.helio.api.protocols.sources.{ConnectorEntityProtocol, ConnectorSummary}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// Server-side port of `helio-mcp/src/context.ts`'s `WorkspaceContext` — see
// `schemas/workspace/workspace-context.schema.json` for the documented structural-parity
// delta (D4: no `pipelineShapes`) and the per-step field-set decision (this
// type carries the FULL per-step parity set — `position`/`type`/
// `outputColumns`/`validationError` — not just `outputColumns`, matching
// `context.ts`'s `steps` shape 1:1; see the schema description for the
// explicit call-out).

final case class WorkspaceContextCounts(
    dataSources: Int,
    dataTypes: Int,
    pipelines: Int,
    dashboards: Int
)

final case class WorkspaceContextDataSource(
    id: String,
    name: String,
    `type`: String,
    tag: Option[String]
)

/** `semanticRole` (HEL-374 design.md D1): one of `temporal`/`dimension`/`measure`/
 *  `identifier`/`boolean`/`text`, derived deterministically from the column's
 *  declared `dataType` + a name heuristic + (when available) `columnStats` —
 *  see `WorkspaceContextService.classifySemanticRole`. Advisory only: it never
 *  alters `dataType`, the authoritative declared type. */
final case class WorkspaceContextColumn(name: String, dataType: String, nullable: Boolean, semanticRole: String)
final case class WorkspaceContextComputedColumn(name: String, dataType: String, expression: String)

/** One inferred, advisory cross-DataType joinability hint (HEL-374 design.md
 *  D2): a bounded, precision-favoring pairwise comparison of `identifier`-role
 *  columns across the caller's own pipeline-output DataTypes, computed
 *  entirely from data `assemble` already fetched — no new DB access. Never
 *  authors a join step itself (HEL-342's concern). `confidence` is always in
 *  `[0.5, 1.0]`: `0.5` = name+type match with weak/no value or cardinality
 *  evidence; it approaches `1.0` only as sampled values overlap AND both
 *  columns show enough distinct values to make coincidental overlap unlikely
 *  — a cardinality-damped value-overlap boost (post-design-gate fix, design.md
 *  D2's `evidenceWeight`), not raw Jaccard overlap alone, so two unrelated
 *  low-cardinality identifier columns that coincidentally share the same
 *  small example-value set do NOT read as near-certain
 *  (`WorkspaceContextService.computeJoinHints`). A bounded heuristic over a
 *  small sample, never certainty — always advisory. The lexicographically
 *  smaller `outputId` of the pair is always `left` — one hint per unordered
 *  pair, never two. */
final case class WorkspaceContextJoinHint(
    leftOutputId: String,
    leftColumn: String,
    rightOutputId: String,
    rightColumn: String,
    confidence: Double
)

/** Per-column statistics (HEL-373 `computeColumnStats`, design.md D4/D5/D6/D7):
 *  `nullRate`/`distinctCount`/`distinctCountCapped`/`exampleValues` are always
 *  present (design.md D7); `min`/`max`/`mean` are numeric-column-only and
 *  therefore `Option` — spray-json's `jsonFormatN` OMITS a `None` field from
 *  the wire rather than emitting `null`, so these three must NOT be listed in
 *  `ColumnStats`'s `required` array in `schemas/workspace/workspace-context.schema.json`
 *  (the exact lesson HEL-371 cost a full eval cycle on). */
final case class WorkspaceContextColumnStats(
    nullRate: Double,
    distinctCount: Int,
    distinctCountCapped: Boolean,
    exampleValues: Vector[JsValue],
    min: Option[Double],
    max: Option[Double],
    mean: Option[Double]
)

/** `pipelineOutput = sourceId.isEmpty` (design.md D7) — classified directly
 *  off the domain `DataType.sourceId: Option[DataSourceId]`, never through a
 *  wire round-trip (spray-json omits `None` fields, which is the exact
 *  footgun `context.ts`'s own inline comment documents for its client-side
 *  fan-out — the Scala assembler avoids it by construction).
 *
 *  `sampleRows` (HEL-372): up to 5 rows from the DataType's latest
 *  pipeline-run snapshot, capped to the first 40 declared Structured-category
 *  columns and 200 characters per cell (`WorkspaceContextService.sanitizeSampleRows`,
 *  design.md D3). Always present (an empty `Vector`, never `Option`) — a
 *  source-companion DataType or one with no run snapshot reports `[]`, so
 *  there is no spray-json `None`-omission concern here.
 *
 *  `columnStats` (HEL-373): one entry per Structured-category column (capped
 *  at 40, design.md D2), keyed by column name, computed from the same
 *  ≤500-row fetch `sampleRows` derives from. Always present (an empty `Map`,
 *  never `Option`) — same always-present convention as `sampleRows`. */
final case class WorkspaceContextOutput(
    id: String,
    name: String,
    sourceId: Option[String],
    pipelineOutput: Boolean,
    columns: Vector[WorkspaceContextColumn],
    computedColumns: Vector[WorkspaceContextComputedColumn],
    version: Int,
    tag: Option[String],
    sampleRows: Vector[JsObject],
    columnStats: Map[String, WorkspaceContextColumnStats]
)

final case class WorkspaceContextPipelineStep(
    position: Int,
    `type`: String,
    outputColumns: Vector[String],
    validationError: Option[String]
)

/** `steps`/`stepsError` mirror `context.ts`'s per-pipeline `try/catch` around
 *  `analyzePipeline` (design.md D5): a failed analyze degrades this single
 *  pipeline's entry to `steps: []` + `stepsError`, never fails the whole
 *  `GET /api/workspace/context` request. */
final case class WorkspaceContextPipeline(
    id: String,
    name: String,
    sourceDataSourceId: String,
    sourceDataSourceName: String,
    outputId: String,
    outputName: String,
    lastRunStatus: Option[String],
    lastRunAt: Option[String],
    lastRunRowCount: Option[Long],
    tag: Option[String],
    steps: Vector[WorkspaceContextPipelineStep],
    stepsError: Option[String]
)

final case class WorkspaceContextDashboard(id: String, name: String, panelCount: Int)

/** HEL-521 (420-C): the caller's agent-authoring preferences plus up to 20 of their
 *  most-recently-useful `AgentMemoryEntry` records, ranked by `lastUsedAt` descending (an entry
 *  with no `lastUsedAt` ranks below every entry that has one) -- see
 *  `WorkspaceContextService`'s design.md Decision 2/3. ALWAYS present on `WorkspaceContextResponse`
 *  -- never `Option`-wrapped -- defaulting to `WorkspaceContextAgentSection.empty` when the caller
 *  has stored neither, or when the underlying `AgentPreferencesService`/`AgentMemoryService` are
 *  not wired (design.md Decision 2). */
final case class WorkspaceContextAgentSection(
    preferences: AgentPreferencesResponse,
    memory: Vector[AgentMemoryEntryResponse]
)

object WorkspaceContextAgentSection {
  // HEL-531 (420-E): `memoryEnabled = true` here is the same hardcoded, never-`sys.env`-read
  // default `AgentPreferencesResponse`'s own no-row-stored fields use above -- this path only
  // triggers when the underlying services aren't wired at all (design.md Decision 2), so there is
  // no real stored/env-configured value to read; `true` mirrors "no opt-out has ever existed".
  val empty: WorkspaceContextAgentSection =
    WorkspaceContextAgentSection(
      preferences = AgentPreferencesResponse(None, None, None, JsObject.empty, memoryEnabled = true),
      memory      = Vector.empty
    )
}

/** Deterministic budgeting outcome (HEL-377 design.md D6) — reports
 *  whether/how `WorkspaceContextBudget.apply` shrank `sampleRows`/
 *  `exampleValues`/`joinHints` to fit `budgetBytes`, so a downstream consumer
 *  (HEL-341's Claude call) can tell the context is partial. ALWAYS present
 *  (a required top-level field on `WorkspaceContextResponse`, never
 *  `Option`) — every field here is a simple scalar/vector, so there is no
 *  spray-json `None`-omission risk (the epic's carried finding #8).
 *
 *  `estimatedSizeBytes`/`budgetBytes` are UTF-16 code-unit counts of the
 *  compact JSON serialization (`String.length`), NOT exact UTF-8 byte counts
 *  and NOT a real LLM token count (design.md D1) — an approximate,
 *  model-independent proxy for prompt cost. `estimatedSizeBytes` measures the
 *  response's CORE fields only (every field except this `truncation` object
 *  itself) — excluding `truncation`'s own bytes avoids the self-referential
 *  paradox of a field whose value would have to describe a size that
 *  includes its own not-yet-known serialized length; `truncation`'s bytes are
 *  a small, roughly-fixed metadata overhead added on top of the budgeted
 *  core, not counted against `budgetBytes` itself. */
final case class WorkspaceContextTruncation(
    applied: Boolean,
    budgetBytes: Int,
    estimatedSizeBytes: Int,
    sampleRowsCap: Int,
    exampleValuesCap: Int,
    joinHintsKept: Int,
    joinHintsOmittedByBudget: Int,
    structuralFloorExceedsBudget: Boolean,
    paginationTruncatedResources: Vector[String]
)

/** Top-level response for `GET /api/workspace/context`. Field-for-field
 *  structural parity with `helio-mcp/src/context.ts`'s `WorkspaceContext`
 *  EXCEPT `pipelineShapes`, intentionally omitted (design.md D4 — not part of
 *  this ticket's scope/acceptance criteria; `PipelineShapeService` is
 *  stateless/code-level with no RLS story).
 *
 *  `truncation` (HEL-377): the deterministic byte-budget outcome — see
 *  `WorkspaceContextTruncation`.
 *
 *  `agentContext` (HEL-521 / 420-C): the caller's agent-authoring preferences + bounded memory —
 *  see `WorkspaceContextAgentSection`. Additive field, no signature change to `assemble` itself.
 *
 *  `connectors` (HEL-828 design.md Decision 5/6): the caller's Connectors, owner-scoped, projected
 *  through the slim, explicitly allow-listed `ConnectorSummary` shape (`id`/`name`/`kind`/`host`
 *  only — never `config`/`defaultHeaders`/`authType`). A STRUCTURAL field for budget-trimming
 *  purposes (design.md Decision 5/spec "Connectors are a structural field, never shrunk by budget
 *  trimming") — never shrunk/omitted under `budgetBytes` pressure, exactly like `counts` and each
 *  resource list's identity fields. */
final case class WorkspaceContextResponse(
    generatedAt: String,
    counts: WorkspaceContextCounts,
    dataSources: Vector[WorkspaceContextDataSource],
    dataTypes: Vector[WorkspaceContextOutput],
    pipelines: Vector[WorkspaceContextPipeline],
    dashboards: Vector[WorkspaceContextDashboard],
    joinHints: Vector[WorkspaceContextJoinHint],
    truncation: WorkspaceContextTruncation,
    agentContext: WorkspaceContextAgentSection,
    connectors: Vector[ConnectorSummary]
)

trait WorkspaceContextProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with AgentPreferencesProtocol
    with AgentMemoryProtocol
    with ConnectorEntityProtocol {
  implicit val workspaceContextCountsFormat: RootJsonFormat[WorkspaceContextCounts] =
    jsonFormat4(WorkspaceContextCounts.apply)
  implicit val workspaceContextDataSourceFormat: RootJsonFormat[WorkspaceContextDataSource] =
    jsonFormat4(WorkspaceContextDataSource.apply)
  implicit val workspaceContextColumnFormat: RootJsonFormat[WorkspaceContextColumn] =
    jsonFormat4(WorkspaceContextColumn.apply)
  implicit val workspaceContextComputedColumnFormat: RootJsonFormat[WorkspaceContextComputedColumn] =
    jsonFormat3(WorkspaceContextComputedColumn.apply)
  implicit val workspaceContextJoinHintFormat: RootJsonFormat[WorkspaceContextJoinHint] =
    jsonFormat5(WorkspaceContextJoinHint.apply)
  implicit val workspaceContextColumnStatsFormat: RootJsonFormat[WorkspaceContextColumnStats] =
    jsonFormat7(WorkspaceContextColumnStats.apply)
  // Map[String, WorkspaceContextColumnStats]'s format is summoned automatically
  // by spray-json's built-in `mapFormat[V: JsonFormat]` given the above
  // implicit — no separate named val needed.
  implicit val workspaceContextOutputFormat: RootJsonFormat[WorkspaceContextOutput] =
    jsonFormat10(WorkspaceContextOutput.apply)
  implicit val workspaceContextPipelineStepFormat: RootJsonFormat[WorkspaceContextPipelineStep] =
    jsonFormat4(WorkspaceContextPipelineStep.apply)
  implicit val workspaceContextPipelineFormat: RootJsonFormat[WorkspaceContextPipeline] =
    jsonFormat12(WorkspaceContextPipeline.apply)
  implicit val workspaceContextDashboardFormat: RootJsonFormat[WorkspaceContextDashboard] =
    jsonFormat3(WorkspaceContextDashboard.apply)
  implicit val workspaceContextTruncationFormat: RootJsonFormat[WorkspaceContextTruncation] =
    jsonFormat9(WorkspaceContextTruncation.apply)
  implicit val workspaceContextAgentSectionFormat: RootJsonFormat[WorkspaceContextAgentSection] =
    jsonFormat2(WorkspaceContextAgentSection.apply)
  implicit val workspaceContextResponseFormat: RootJsonFormat[WorkspaceContextResponse] =
    jsonFormat10(WorkspaceContextResponse.apply)
}
