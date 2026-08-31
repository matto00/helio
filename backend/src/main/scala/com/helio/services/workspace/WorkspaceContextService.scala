package com.helio.services.workspace

import com.helio.services.agents.{AgentMemoryService, AgentPreferencesService}
import com.helio.services.dashboards.DashboardService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.agents.{AgentMemoryEntryResponse, AgentPreferencesResponse}
import com.helio.api.protocols.pipelines.{AnalyzeStepResponse, PipelineSummaryResponse}
import com.helio.api.protocols.sources.ConnectorSummary
import com.helio.api.protocols.workspace.{WorkspaceContextAgentSection, WorkspaceContextColumn, WorkspaceContextColumnStats, WorkspaceContextComputedColumn, WorkspaceContextCounts, WorkspaceContextDashboard, WorkspaceContextDataSource, WorkspaceContextOutput, WorkspaceContextJoinHint, WorkspaceContextPipeline, WorkspaceContextPipelineStep, WorkspaceContextResponse}
import com.helio.domain.model.{AgentMemoryEntry, AuthenticatedUser, DashboardLayout, DataField, DataFieldType, DataSource, Dashboard, FieldTypeCategory, Output, Page, PagedResult, PipelineId}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import spray.json.{JsNull, JsNumber, JsObject, JsString, JsValue}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.math.BigDecimal.RoundingMode

/** Server-side port of `helio-mcp/src/context.ts`'s `buildWorkspaceContext`
 *  (HEL-371). Composes the caller's EXISTING owner-scoped
 *  services — `DashboardService`, `DataSourceService`, `DataTypeService`,
 *  `PipelineService` — and performs no direct database access of its own
 *  (design.md D1), mirroring `DashboardProposalService`'s composition
 *  discipline. Every read therefore inherits the owner-scoping already
 *  proven by those methods' own tests; a scoped PAT is denied before this
 *  service is ever reached (`AuthDirectives.confineScopedToken`, design.md
 *  D6). Exception: `panelRepoOpt`'s panel-count read (beta UI-audit F-004,
 *  documented in full below) — no owner-scoped `PanelService` read exists
 *  that returns a bare count without an ACL/dashboard-detail round trip, so
 *  this one read goes straight to `PanelRepository`, sharing-aware via the
 *  same `Some(user)` predicate the D1-abiding services above use internally.
 *
 *  HEL-372: takes `dataTypeService: DataTypeService` rather than a bare
 *  `DataTypeRepository` (design.md D7) — `findAll` is still exactly what
 *  `DataTypeRepository.findAll` did, but `listRows`'s owner-scoping choke
 *  point (`findByIdOwned`) only exists on the service, and sample rows need
 *  it.
 *
 *  HEL-521 (420-C) design.md Decision 2: `agentPreferencesServiceOpt`/`agentMemoryServiceOpt` are
 *  `Option`-guarded, trailing, default-`None` constructor params -- mirrors
 *  `WorkspaceRoutes`'s existing `workspaceTeardownServiceOpt` nullability precedent, and the
 *  default keeps every existing 4-arg construction site (tests, `ApiRoutes`) compiling unchanged.
 *  When either is `None`, `assemble` produces an empty `agentContext` rather than failing.
 *
 *  Beta UI-audit F-004: `panelRepoOpt` is a NEW `Option`-guarded, trailing, default-`None`
 *  constructor param -- same precedent as the two above, so every existing 4- and 6-arg
 *  construction site (tests) keeps compiling unchanged. When `Some`, `toDashboardEntry`'s
 *  `panelCount` is a real `COUNT(*)` over the panels table instead of the pre-existing
 *  `distinctPanelCount(d.layout)` heuristic, which undercounts (down to 0) any panel the
 *  client's default auto-layout placed without ever being manually dragged/resized -- the
 *  debounce-gated trigger that persists `layout` (`PanelGrid`'s 250ms layout-change debounce).
 *  See `panelCountFor`'s own doc. `ApiRoutes` always supplies `Some(panelRepo)`; only fixtures
 *  built without a `PanelRepository` fall back to the legacy heuristic. */
final class WorkspaceContextService(
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    // HEL-904 task 3.12: replaces `dataTypeService: DataTypeService` in the SAME positional
    // slot -- every existing test call site passing a literal `null` here (the majority of this
    // file's fixtures, which never exercise `toDataTypeEntry`/`assemble`'s Output-fetch path)
    // keeps compiling unchanged; only call sites passing a real `dataTypeService` instance need
    // updating to pass a real `outputRepo` instead.
    outputRepo: OutputRepository,
    pipelineService: PipelineService,
    agentPreferencesServiceOpt: Option[AgentPreferencesService] = None,
    agentMemoryServiceOpt: Option[AgentMemoryService] = None,
    panelRepoOpt: Option[PanelRepository] = None,
    // HEL-828 design.md Decision 5: same Option-guarded, trailing, default-None precedent as
    // panelRepoOpt above -- every existing construction site keeps compiling unchanged. When
    // `None`, `connectors` degrades to an empty Vector rather than failing `assemble`.
    connectorRepoOpt: Option[ConnectorRepository] = None,
    // HEL-904 task 3.12: NEW trailing, Option-guarded, default-None param -- same precedent as
    // panelRepoOpt/connectorRepoOpt above, so every existing construction site (which predates
    // node_snapshots) keeps compiling unchanged. When `None`, `toDataTypeEntry`'s sample-row/
    // column-stats fetch degrades to empty (mirrors `toDataTypeEntry`'s existing
    // `dt.sourceId.isDefined` skip-the-query behavior for a resource with nothing to sample).
    nodeSnapshotRepoOpt: Option[NodeSnapshotRepository] = None
)(implicit ec: ExecutionContext) {

  /** Bounded sample-row count per pipeline-output DataType (design.md D1/D3)
   *  — a documented constant, never unbounded; `DataTypeRowRepository.listRows`
   *  enforces this at the SQL tier via `LIMIT`. `sampleRows` is derived from
   *  the first `SampleRowLimit` of the shared `StatsRowLimit`-wide fetch
   *  below (HEL-373 design.md D1) — its own wire output is unchanged. */
  private val SampleRowLimit: Int = 5

  /** Shared fetch's row bound (HEL-373 design.md D1): raised from
   *  `SampleRowLimit` (5) to 500 — matches `DataSourceService.staticMaxRows`,
   *  the codebase's existing "reasonably-sized snapshot" constant. Both
   *  `sampleRows` and `columnStats` are derived from this ONE fetch; no
   *  second query. */
  private val StatsRowLimit: Int = 500

  /** First N declared Structured-category columns retained per sample row
   *  and per `columnStats` (design.md D3/D2 round-3 fix) — enforced BOTH at
   *  the SQL tier (`excludeKeys` extension below) and independently by
   *  `computeColumnStats`'s own column enumeration (design.md D2). */
  private val SampleColumnLimit: Int = 40

  /** Per-cell character cap before truncation (design.md D3). */
  private val SampleCellCharLimit: Int = 200

  private val TruncationMarker: String = "…[truncated]"

  /** `distinctCount` stops distinguishing beyond this cap (design.md D4);
   *  `distinctCountCapped: true` reports "at least this many, exact count not
   *  computed beyond the cap." */
  private val DistinctCountCap: Int = 100

  /** Max `exampleValues` entries per column (design.md D6). */
  private val ExampleValueLimit: Int = 5

  /** `mean`'s fixed rounding precision — 4 decimal places (design.md D5/D6
   *  determinism). Round-3 fix: applied via `BigDecimal.setScale`, not a
   *  multiply-by-`10^scale`-then-`math.round` factor (see
   *  `computeColumnStatsForField`'s round-3-fix comment for why the latter
   *  technique is itself an overflow surface). */
  private val MeanRoundingScale: Int = 4

  /** `classifySemanticRole`'s string→dimension cardinality ceiling (HEL-374
   *  design.md D1 step 7) — a string column with `distinctCount` at or below
   *  this (and real evidence, and not `distinctCountCapped`) is classified
   *  `dimension` rather than `text`. Self-approved tunable, no existing
   *  codebase precedent (design.md Planner Notes). */
  private val DimensionCardinalityThreshold: Int = 50

  /** `computeJoinHints`'s per-name-bucket candidate cap (HEL-374 design.md
   *  D2) — enforced AFTER the `columnStats`-membership candidacy restriction,
   *  so this bounds comparisons, not candidate gathering itself. Stable-sorted
   *  by `(dataTypeId, column)` before truncation (deterministic). Self-approved
   *  tunable, no existing codebase precedent. */
  private val MaxColumnsPerNameBucket: Int = 50

  /** `computeJoinHints`'s output cap (HEL-374 design.md D2) — sorted by
   *  confidence descending, `(leftDataTypeId, leftColumn, rightDataTypeId,
   *  rightColumn)` ascending tie-break, before truncation. Self-approved
   *  tunable, no existing codebase precedent. */
  private val MaxJoinHints: Int = 50

  /** `computeJoinHints`'s confidence-damping floor (HEL-374 design.md D2,
   *  post-design-gate human-review fix): a pair's `evidenceWeight` reaches
   *  `1.0` once BOTH sides' `distinctCount` is at or above this — below it,
   *  `evidenceWeight` scales down linearly, damping the value-overlap boost
   *  so two unrelated low-cardinality identifier columns that coincidentally
   *  share the same small example-value set (e.g. sequential integers
   *  `1..5`, common in small/demo data) cannot read as near-certain. Self-
   *  approved tunable, no existing codebase precedent. */
  private val MinDistinctForFullConfidence: Int = 20

  /** `agentContext.memory`'s surfaced-entry cap (HEL-521 / 420-C design.md Decision 3) -- a fifth
   *  of `AgentMemoryService`'s own 100-entry-per-user hard cap, keeping the section compact per
   *  the ticket's AC4 while still surfacing a meaningful slice. Independently mirrored (same
   *  value, separately defined -- design.md Risks) by `helio-mcp/src/context.ts`'s own top-N
   *  memory constant. Self-approved tunable, no existing codebase precedent. */
  private val AgentMemoryTopN: Int = 20

  /** Assembles one snapshot of the caller's workspace. `dataSources`/
   *  `dataTypes`/`dashboards` use `Page.Default` (200 — design.md D3, parity
   *  with the MCP's own unparameterized fan-out); `counts` always reports
   *  each list call's true `PagedResult.total`, so truncation past 200 items
   *  is detectable — HEL-377 makes it self-describing via
   *  `truncation.paginationTruncatedResources`, this ticket's carried finding.
   *
   *  `budgetBytes` (HEL-377 design.md D2/D7/D8): defaults to
   *  `WorkspaceContextBudget.DefaultBudgetBytes` (env-var overridable) so
   *  existing callers with a single argument are unaffected. The assembled
   *  response is built with `WorkspaceContextBudget.PlaceholderTruncation` —
   *  a value that is unconditionally overwritten by the final
   *  `WorkspaceContextBudget.apply` call below, never otherwise read (see
   *  that constant's doc) — and `WorkspaceContextBudget.apply` is the LAST
   *  step before returning, a pure in-memory pass over the already-bounded
   *  structure above (no new DB access, no new `Future` step). */
  def assemble(
      user: AuthenticatedUser,
      budgetBytes: Int = WorkspaceContextBudget.DefaultBudgetBytes
  ): Future[WorkspaceContextResponse] = {
    val sourcesF      = dataSourceService.findAll(user, Page.Default)
    // HEL-904 task 3.12: `outputRepo` is `null` in any environment where `ApiRoutes`' own
    // `outputRepoOpt` degrades to `None` (no `DbContext` passed -- a pre-existing, task-3.1
    // convention this class did not introduce, see `ApiRoutes.outputRepoOpt`'s own doc). A real
    // caller in that shape (confirmed live: `ApiTokenAuthSpec`'s `ApiRoutes` fixture predates
    // `dbContext` and constructs `WorkspaceContextService` transitively via `ApiRoutes` with
    // `outputRepo = null`) must degrade `dataTypes`/`counts.dataTypes` to empty, not NPE the
    // whole `GET /api/workspace/context` route -- mirrors `DataTypeService.listRows`'s identical
    // null-repo-degrades-to-empty precedent.
    val typesF        =
      if (outputRepo == null) Future.successful(PagedResult(Vector.empty[Output], 0, 0, Page.Default.limit))
      else outputRepo.findAllByOwner(user.id, Page.Default)
    val dashboardsF   = dashboardService.findAll(user, Page.Default)
    val summariesF    = pipelineService.listSummaries(user)
    val agentContextF = buildAgentContext(user)
    val connectorsF   = buildConnectors(user)

    for {
      sourcesPage    <- sourcesF
      typesPage      <- typesF
      dashboardsPage <- dashboardsF
      summaries      <- summariesF
      pipelines      <- Future.traverse(summaries)(buildPipeline(_, user))
      dataTypes      <- Future.traverse(typesPage.items)(toDataTypeEntry(_, user))
      dashboards     <- Future.traverse(dashboardsPage.items)(toDashboardEntry(_, user))
      agentContext   <- agentContextF
      connectors     <- connectorsF
    } yield {
      val assembled = WorkspaceContextResponse(
        generatedAt = Instant.now().toString,
        counts = WorkspaceContextCounts(
          dataSources = sourcesPage.total,
          dataTypes   = typesPage.total,
          pipelines   = summaries.size,
          dashboards  = dashboardsPage.total
        ),
        dataSources = sourcesPage.items.map(toDataSourceEntry),
        dataTypes   = dataTypes,
        pipelines   = pipelines,
        dashboards  = dashboards,
        // HEL-374 design.md D2/D3: computed once, entirely in-memory, AFTER the
        // traverse above completes — `dataTypes` is the exact structure already
        // owner-scoped by `typesPage` (D3), no new DB access, no new Future step.
        joinHints    = computeJoinHints(dataTypes),
        truncation   = WorkspaceContextBudget.PlaceholderTruncation,
        agentContext = agentContext,
        connectors   = connectors
      )
      WorkspaceContextBudget.apply(assembled, budgetBytes, sourcesPage, typesPage, dashboardsPage)
    }
  }

  /** HEL-521 (420-C) design.md Decision 2/3: composes the caller's `AgentPreferences` + top-N
   *  most-recently-useful `AgentMemoryEntry` records into one `WorkspaceContextAgentSection`,
   *  touching every surfaced memory entry (design.md Decision 4 -- ONLY this path ever calls
   *  `AgentMemoryService.touch`, never the MCP read path). Produces
   *  `WorkspaceContextAgentSection.empty` when EITHER `agentPreferencesServiceOpt` or
   *  `agentMemoryServiceOpt` is `None` (tasks.md 2.2) -- a partially-wired environment degrades to
   *  fully empty, not a half-populated section. The wire response carries the pre-touch
   *  `lastUsedAt` values (design.md Decision 3's "re-sorted here, not re-fetched") -- `touch`'s
   *  effect is only ever observable on a LATER `list`/`assemble` call, never this same one.
   *
   *  HEL-531 (420-E) design.md Decision 4: when the already-fetched `preferences.memoryEnabled`
   *  is `false`, the `memoryService.list`/`touch` calls are skipped ENTIRELY -- `agentContext.memory`
   *  is empty, but `agentContext.preferences` still reflects the caller's stored preferences. No
   *  new dependency needed here -- `preferences` was already being fetched before this ticket. */
  private def buildAgentContext(user: AuthenticatedUser): Future[WorkspaceContextAgentSection] =
    (agentPreferencesServiceOpt, agentMemoryServiceOpt) match {
      case (Some(preferencesService), Some(memoryService)) =>
        preferencesService.get(user).flatMap { preferences =>
          if (preferences.memoryEnabled)
            for {
              entries  <- memoryService.list(user).map(_.getOrElse(Seq.empty))
              surfaced  = rankMemoryEntries(entries).take(AgentMemoryTopN)
              _        <- Future.traverse(surfaced)(entry => memoryService.touch(entry.id, user))
            } yield WorkspaceContextAgentSection(
              preferences = AgentPreferencesResponse.fromDomain(preferences),
              memory      = surfaced.map(AgentMemoryEntryResponse.fromDomain)
            )
          else
            Future.successful(
              WorkspaceContextAgentSection(
                preferences = AgentPreferencesResponse.fromDomain(preferences),
                memory      = Vector.empty
              )
            )
        }
      case _ => Future.successful(WorkspaceContextAgentSection.empty)
    }

  /** HEL-828 design.md Decision 5/6: the caller's Connectors, owner-scoped
   *  (`ConnectorRepository.findAll`, the same RLS-scoped query `GET /api/connectors` uses),
   *  projected through the slim, explicitly allow-listed `ConnectorSummary.fromDomain` --
   *  `config`/`defaultHeaders`/`authType` are never read. Degrades to an empty `Vector` when
   *  `connectorRepoOpt` is `None` (design.md Decision 5's "not currently wired" precedent),
   *  mirroring `buildAgentContext`'s own not-wired degrade. */
  private def buildConnectors(user: AuthenticatedUser): Future[Vector[ConnectorSummary]] =
    connectorRepoOpt match {
      case Some(repo) => repo.findAll(user).map(_.map(ConnectorSummary.fromDomain))
      case None       => Future.successful(Vector.empty)
    }

  /** Ranks `entries` most-recently-useful first: entries with a `lastUsedAt` sorted descending by
   *  that timestamp, followed by never-used (`lastUsedAt = None`) entries in their incoming order
   *  (design.md Decision 3 -- "nulls-last"; `AgentMemoryService.list` already returns
   *  newest-`createdAt`-first, so the never-used tail stays deterministic without a second sort
   *  key). Does NOT truncate to `AgentMemoryTopN` itself -- callers `.take()` separately, so this
   *  stays independently unit-testable against an unbounded input.
   *
   *  `private[services]` so `WorkspaceContextServiceSpec` can unit-test the ranking directly,
   *  mirroring `computeJoinHints`'s existing testability precedent. */
  private[services] def rankMemoryEntries(entries: Seq[AgentMemoryEntry]): Vector[AgentMemoryEntry] = {
    val (touched, neverUsed) = entries.partition(_.lastUsedAt.isDefined)
    val touchedDesc           = touched.sortBy(_.lastUsedAt.get.toEpochMilli)(Ordering.Long.reverse)
    (touchedDesc ++ neverUsed).toVector
  }

  /** Per-pipeline `analyze` fan-out (design.md D5 — parallel via
   *  `Future.traverse`, not batched; `analyze` is DB-cheap, no Spark job). An
   *  individual failure — either a `Left(ServiceError)` from `analyze` or an
   *  unexpected thrown exception — degrades ONLY this pipeline's entry to
   *  `steps: []` + `stepsError`, mirroring `context.ts`'s per-pipeline
   *  `try/catch`, never failing the whole assembly.
   *
   *  `private[services]` (not `private`) rather than fully private so
   *  `WorkspaceContextServiceSpec` can exercise the degrade path directly for
   *  a summary whose pipeline has since been deleted (tasks.md 4.5) — the
   *  race between `listSummaries` and a per-id `analyze` that this guards
   *  against isn't reproducible deterministically through `assemble` alone
   *  over a single real Postgres instance. */
  private[services] def buildPipeline(
      summary: PipelineSummaryResponse,
      user: AuthenticatedUser
  ): Future[WorkspaceContextPipeline] = {
    // HEL-904 task 3.12: a pipeline no longer mints exactly one DataType (task 3.5) -- it can
    // carry zero-to-many Outputs, potentially on different nodes. `outputDataTypeId`/
    // `outputDataTypeName` are legacy wire field NAMES this ticket does not rename (that's
    // section 5's schema-surface job); populated here with the pipeline's first Output by
    // `position` (an ACL-bypassing internal read -- `summary` itself already came from an
    // owner-scoped `listSummaries` call, so the pipeline's ownership is already established)
    // as the best-effort "representative" Output, matching the field's old one-per-pipeline
    // semantics as closely as the new many-Outputs-per-pipeline model allows. Empty strings
    // when the pipeline has no Output yet (unchanged from the prior placeholder).
    val outputsF =
      if (outputRepo == null) Future.successful(Vector.empty[Output])
      else outputRepo.listByPipelineInternal(PipelineId(summary.id))
    val analyzeF = pipelineService.analyze(PipelineId(summary.id), user)
      .map {
        case Right(analyzed) => (analyzed.steps.map(toStepEntry), Option.empty[String])
        case Left(err)       => (Vector.empty[WorkspaceContextPipelineStep], Some(err.message))
      }
      .recover { case ex =>
        (Vector.empty[WorkspaceContextPipelineStep], Some(Option(ex.getMessage).getOrElse(ex.getClass.getName)))
      }
    for {
      outputs                    <- outputsF
      (steps, stepsError)        <- analyzeF
    } yield toPipelineEntry(summary, steps, stepsError, outputs.headOption)
  }

  private def toStepEntry(s: AnalyzeStepResponse): WorkspaceContextPipelineStep =
    WorkspaceContextPipelineStep(
      position        = s.position,
      `type`          = s.`type`,
      outputColumns   = s.outputSchema.map(_.name),
      validationError = s.validationError
    )

  private def toPipelineEntry(
      summary: PipelineSummaryResponse,
      steps: Vector[WorkspaceContextPipelineStep],
      stepsError: Option[String],
      representativeOutput: Option[Output]
  ): WorkspaceContextPipeline =
    WorkspaceContextPipeline(
      id                   = summary.id,
      name                 = summary.name,
      sourceDataSourceId   = summary.sourceDataSourceId,
      sourceDataSourceName = summary.sourceDataSourceName,
      outputDataTypeId     = representativeOutput.map(_.id.value).getOrElse(""),
      outputDataTypeName   = representativeOutput.map(_.name).getOrElse(""),
      lastRunStatus        = summary.lastRunStatus,
      lastRunAt            = summary.lastRunAt,
      lastRunRowCount      = summary.lastRunRowCount,
      tag                  = summary.tag,
      steps                = steps,
      stepsError           = stepsError
    )

  /** `private[services]` (not `private`) — HEL-661 design.md D2: reused verbatim by
   *  `WorkspaceSearchService.getResource`'s data-source dispatch, mirroring `buildPipeline`'s
   *  existing same-package-reuse precedent. Zero behavior change. */
  private[services] def toDataSourceEntry(ds: DataSource): WorkspaceContextDataSource =
    WorkspaceContextDataSource(id = ds.id.value, name = ds.name, `type` = ds.kind, tag = ds.tag)

  /** `private[services]` (not `private`) — HEL-661 design.md D2: reused verbatim by
   *  `WorkspaceSearchService.getResource`'s DataType dispatch, mirroring `buildPipeline`'s existing
   *  same-package-reuse precedent. Zero behavior change.
   *
   *  `pipelineOutput = dt.sourceId.isEmpty` — classified directly off the
   *  domain field (design.md D7), never through a wire round-trip.
   *
   *  HEL-372: fetches bounded `sampleRows` for a pipeline-output DataType
   *  only (design.md D2 — a source-companion DataType is never written to
   *  `data_type_rows`, so skipping the query entirely for `dt.sourceId.isDefined`
   *  avoids a guaranteed-empty round trip). `excludeKeys` strips Content-category
   *  (`string-body`/`binary-ref`, HEL-217) field values at the SQL tier before
   *  they ever reach the app (design.md D1); `sanitizeSampleRows` then applies
   *  the column/cell caps (design.md D3). A `listRows` failure (e.g. the
   *  DataType was deleted in the race between this `findAll` snapshot and this
   *  per-id call) degrades to `sampleRows = Vector.empty` rather than failing
   *  the whole assembly — mirrors `buildPipeline`'s per-entry degrade
   *  discipline (design.md D5 of the parent HEL-371 change). */
  private[services] def toDataTypeEntry(output: Output, user: AuthenticatedUser): Future[WorkspaceContextOutput] = {
    // HEL-904 task 3.12: `output.schema` (`Vector[SchemaField]`, `{name, type}` only — no
    // `nullable`/`displayName`) is adapted into the existing `Vector[DataField]`-shaped
    // classification/stats machinery below (`classifySemanticRole`/`computeColumnStats`/
    // `sanitizeSampleRows`) via a synthetic, non-persisted `DataField` per field
    // (`nullable = false` — inferredSchema carries no nullability signal at all, so this is a
    // deliberate, documented default, not a lossy guess about a real value) — reuses every
    // already-tested field-category/semantic-role/stats function UNCHANGED rather than forking a
    // second parallel implementation over a different input shape.
    val fields: Vector[DataField] = output.schema.map(sf => DataField(sf.name, sf.name, sf.`type`, nullable = false))

    // HEL-373 design.md D1: ONE shared fetch (limit = StatsRowLimit, 500)
    // serves both sampleRows and columnStats — no second query path.
    // excludeKeys is the union of Content-category field names (unchanged
    // from HEL-372) and the Structured-category column-count overflow beyond
    // SampleColumnLimit (design.md D1 round-1 fix) — Postgres itself never
    // returns more than 40 Structured columns per row.
    //
    // HEL-904 task 3.12: rows now come from `node_snapshots` (`NodeSnapshotRepository`, keyed by
    // the Output's own `NodeRef`) rather than `data_type_rows` keyed by DataType id — degrades to
    // empty when `nodeSnapshotRepoOpt` is `None` (not currently wired), same "not wired ->
    // empty" precedent as `panelRepoOpt`/`connectorRepoOpt` elsewhere in this file. Ownership of
    // `output` was already established by the caller (`assemble`'s `outputRepo.findAllByOwner`),
    // so this read needs no separate ACL check of its own — mirrors `toDataTypeEntry`'s prior
    // `dataTypeService.listRows`'s post-`findByIdOwned` internal read.
    val statsF: Future[(Vector[JsObject], Map[String, WorkspaceContextColumnStats])] =
      nodeSnapshotRepoOpt match {
        case None => Future.successful((Vector.empty, Map.empty))
        case Some(nodeSnapshotRepo) =>
          val excludeKeys = contentFieldNames(fields) ++ overflowStructuredFieldNames(fields, SampleColumnLimit)
          nodeSnapshotRepo
            .listRows(output.node.pipelineId.value, output.node.stepId.map(_.value), limit = Some(StatsRowLimit), excludeKeys = excludeKeys)
            .map { rawRows =>
              // Both outputs derived from `rawRows` in this SAME step, so `rawRows`
              // goes out of scope here — never retained beyond this map (design.md
              // D1a's binding memory-retention requirement).
              (sanitizeSampleRows(fields, rawRows), computeColumnStats(fields, rawRows))
            }
      }

    statsF.map { case (sampleRows, columnStats) =>
      WorkspaceContextOutput(
        id             = output.id.value,
        name           = output.name,
        // HEL-904 task 3.12: an Output has no source-companion concept (that distinction was
        // retired with the DataType/Metric split) -- always `None`/`pipelineOutput = true`, since
        // every Output is, by construction, a projection of a pipeline node.
        sourceId       = None,
        pipelineOutput = true,
        columns        = fields.map(f => WorkspaceContextColumn(f.name, f.dataType, f.nullable, classifySemanticRole(f, columnStats.get(f.name)))),
        // An Output has no computed-field concept of its own (that lived on the old DataType);
        // always empty.
        computedColumns = Vector.empty,
        // An Output has no versioning concept (that lived on the old DataType); a fixed `1`
        // preserves the wire field's presence without fabricating a meaningful version history.
        version        = 1,
        // Not yet exposed on the domain `Output` case class (the DB column exists but nothing
        // reads it out yet) -- `None` until a later cycle adds it, same "not yet wired" precedent
        // used throughout this file.
        tag            = None,
        sampleRows     = sampleRows,
        columnStats    = columnStats
      )
    }
  }

  private def contentFieldNames(fields: Vector[DataField]): Set[String] =
    fields.filter(f => fieldCategory(f) == FieldTypeCategory.Content).map(_.name).toSet

  /** HEL-904 task 3.12: inlined verbatim from the now-decoupled
   *  `DataTypeService.overflowStructuredFieldNames` (a pure function, no DataType-repository
   *  dependency) so this file no longer needs a `DataTypeService` collaborator at all. */
  private def overflowStructuredFieldNames(fields: Vector[DataField], limit: Int): Set[String] =
    fields
      .filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured))
      .drop(limit)
      .map(_.name)
      .toSet

  /** A field whose `dataType` string doesn't parse via `DataFieldType.fromString`
   *  is conservatively excluded from both categories (never Structured, so
   *  never sampled) — design.md D3. */
  private def fieldCategory(f: DataField): Option[FieldTypeCategory] =
    DataFieldType.fromString(f.dataType).map(DataFieldType.category)

  private val TemporalNameTokens: Set[String]   = Set("date", "time", "timestamp", "dob")
  private val IdentifierNameTokens: Set[String] = Set("id", "uuid", "guid")

  /** Name-token normalization (HEL-374 design.md D1 steps 4/5): camelCase
   *  boundary insertion (`fooBar` → `foo_Bar`), lowercase, split on `_`. The
   *  ONE shared implementation for BOTH the temporal-token check (step 4) and
   *  the identifier-token check (step 5) — token-exact matching throughout,
   *  never substring (a raw `.contains("date")`/`.contains("guid")` would
   *  misclassify `validated`/`estimated`/`guidance`/`guideline`/`misguided`;
   *  design-gate round-1 finding, closed in round 2). Also reused verbatim by
   *  `computeJoinHints`'s name-bucket grouping key (design.md D2) — one
   *  normalization helper, not a forked copy, so the two can never drift.
   *  `private[services]` so this can be unit-tested directly (tasks.md 2.1). */
  private[services] def normalizedNameTokens(name: String): Vector[String] = {
    val snakeCase = name.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase
    snakeCase.split("_").toVector.filter(_.nonEmpty)
  }

  private def isTemporalName(tokens: Vector[String]): Boolean =
    tokens.exists(TemporalNameTokens.contains) || (tokens.size > 1 && tokens.last == "at")

  private def isIdentifierName(tokens: Vector[String]): Boolean =
    tokens.exists(IdentifierNameTokens.contains)

  /** Deterministic `semanticRole` classification (HEL-374 design.md D1),
   *  first-match-wins, 8-step precedence:
   *   1. Content-category field → `text` (carried finding #6 — content values
   *      are never inspected; this is a name/category-only, unconditional
   *      short-circuit, checked BEFORE any name heuristic so a Content field
   *      can never be misclassified `temporal`/`identifier` by its name).
   *   2. Declared `boolean` → `boolean`.
   *   3. Declared `timestamp` → `temporal`.
   *   4. Name matches the temporal-token heuristic → `temporal`.
   *   5. Name matches the identifier-token heuristic → `identifier`.
   *   6. Declared `integer`/`float` → `measure`.
   *   7. Declared `string` with real evidence (`distinctCount > 0`, excludes
   *      the all-empty-snapshot case from being misread as "confirmed low
   *      cardinality"), not `distinctCountCapped`, and `distinctCount <=
   *      DimensionCardinalityThreshold` → `dimension`; otherwise → `text`.
   *   8. Unparseable `dataType` (falls through every declared-type check
   *      above) → `text`.
   *  `private[services]` so `WorkspaceContextServiceSpec` (or a dedicated
   *  spec) can table-drive this directly (tasks.md 5.1). */
  private[services] def classifySemanticRole(field: DataField, stats: Option[WorkspaceContextColumnStats]): String = {
    val declaredType = DataFieldType.fromString(field.dataType)
    val tokens        = normalizedNameTokens(field.name)

    if (fieldCategory(field).contains(FieldTypeCategory.Content)) "text"
    else if (declaredType.contains(DataFieldType.BooleanType)) "boolean"
    else if (declaredType.contains(DataFieldType.TimestampType)) "temporal"
    else if (isTemporalName(tokens)) "temporal"
    else if (isIdentifierName(tokens)) "identifier"
    else if (declaredType.contains(DataFieldType.IntegerType) || declaredType.contains(DataFieldType.FloatType)) "measure"
    else if (declaredType.contains(DataFieldType.StringType)) {
      val lowCardinality = stats.exists(s =>
        s.distinctCount > 0 && !s.distinctCountCapped && s.distinctCount <= DimensionCardinalityThreshold
      )
      if (lowCardinality) "dimension" else "text"
    } else "text" // unparseable dataType (step 8)
  }

  /** Pure, unit-testable sanitizer (design.md D3, tasks.md 2.1/4.2):
   *   1. Column projection — keep only `Structured`-category fields (a field
   *      whose `dataType` doesn't parse is conservatively excluded), take the
   *      first `SampleColumnLimit` of those in `fields`' declared order.
   *   2. Row projection — the first `SampleRowLimit` rows (defense-in-depth;
   *      the SQL-tier `LIMIT` already bounds this in the real call path, but
   *      this keeps the function safe to call directly with an oversized
   *      `rawRows` in a unit test).
   *   3. Cell truncation — any retained cell whose `compactPrint.length > 200`
   *      is replaced with `JsString(compactPrint.take(200) + "…[truncated]")`,
   *      applied uniformly regardless of the value's original JSON type.
   *
   *  `private[services]` (not `private`) so `WorkspaceContextServiceSpec` can
   *  unit-test it directly without a DB fixture per case. */
  private[services] def sanitizeSampleRows(fields: Vector[DataField], rawRows: Vector[JsObject]): Vector[JsObject] = {
    val structuredFieldNames: Vector[String] =
      fields.filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured)).take(SampleColumnLimit).map(_.name)

    rawRows.take(SampleRowLimit).map { row =>
      val projected = structuredFieldNames.flatMap(name => row.fields.get(name).map(name -> truncateCell(_)))
      JsObject(projected.toMap)
    }
  }

  private def truncateCell(v: JsValue): JsValue = {
    val compact = v.compactPrint
    if (compact.length > SampleCellCharLimit)
      JsString(compact.take(SampleCellCharLimit) + TruncationMarker)
    else v
  }

  /** Per-column fold accumulator for `computeColumnStats` — not part of the
   *  wire shape, purely an internal aggregation helper. `distinctSeen` is
   *  unordered and capped at `DistinctCountCap + 1` (101) entries (design.md
   *  D4 — order doesn't matter for a count); `exampleValues`/`exampleKeysSeen`
   *  are the order-preserving, separately-capped-at-5 sibling (design.md D6).
   */
  private final case class ColumnFold(
      nullCount: Int = 0,
      distinctSeen: Set[String] = Set.empty,
      exampleValues: Vector[JsValue] = Vector.empty,
      exampleKeysSeen: Set[String] = Set.empty,
      numericCount: Int = 0,
      numericSum: Double = 0.0,
      numericMin: Double = Double.PositiveInfinity,
      numericMax: Double = Double.NegativeInfinity
  )

  /** `computeColumnStats`'s direct sibling to `sanitizeSampleRows` (design.md
   *  D1/D2/D3/D4/D5/D6/D8, tasks.md 3.1). **Column enumeration**: filters
   *  `fields` to Structured-category and takes the first `SampleColumnLimit`
   *  (40) in declared order — REQUIRED and independent of the SQL-tier
   *  `excludeKeys` bound applied to the fetch itself (design.md D2 round-3
   *  fix: the SQL-tier bound only stops Postgres from sending overflow-column
   *  *values*; it does nothing to stop this enumeration from still producing
   *  an entry per overflow column name if not filtered here too).
   *
   *  Produces one entry per (capped) Structured-category column even when
   *  `rawRows` is empty (design.md D8) — `nullRate: 0` (not `NaN`),
   *  `distinctCount: 0`, `distinctCountCapped: false`, `exampleValues: []`,
   *  no `min`/`max`/`mean` in that case.
   *
   *  `private[services]` (not `private`) so `WorkspaceContextServiceSpec` can
   *  unit-test it directly without a DB fixture per case, mirroring
   *  `sanitizeSampleRows`. */
  private[services] def computeColumnStats(
      fields: Vector[DataField],
      rawRows: Vector[JsObject]
  ): Map[String, WorkspaceContextColumnStats] = {
    val structuredFields: Vector[DataField] =
      fields.filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured)).take(SampleColumnLimit)

    structuredFields.map(field => field.name -> computeColumnStatsForField(field, rawRows)).toMap
  }

  private def computeColumnStatsForField(field: DataField, rawRows: Vector[JsObject]): WorkspaceContextColumnStats = {
    val isNumericField = DataFieldType.fromString(field.dataType) match {
      case Some(DataFieldType.IntegerType) | Some(DataFieldType.FloatType) => true
      case _                                                               => false
    }
    val totalRows = rawRows.size

    val fold = rawRows.foldLeft(ColumnFold()) { (acc, row) =>
      row.fields.get(field.name) match {
        case None | Some(JsNull) =>
          acc.copy(nullCount = acc.nullCount + 1)
        case Some(v) =>
          val truncated    = truncateCell(v)
          val truncatedKey = truncated.compactPrint

          // Distinct-count set: stops growing once already past the cap
          // (design.md D4 — never allowed past 101 entries).
          val withDistinct =
            if (acc.distinctSeen.size > DistinctCountCap || acc.distinctSeen.contains(truncatedKey)) acc
            else acc.copy(distinctSeen = acc.distinctSeen + truncatedKey)

          // Example values: first 5 distinct, truncated, non-null values in
          // row order (design.md D6 determinism).
          val withExamples =
            if (withDistinct.exampleValues.size >= ExampleValueLimit || withDistinct.exampleKeysSeen.contains(truncatedKey))
              withDistinct
            else
              withDistinct.copy(
                exampleValues   = withDistinct.exampleValues :+ truncated,
                exampleKeysSeen = withDistinct.exampleKeysSeen + truncatedKey
              )

          if (isNumericField)
            asNumeric(v) match {
              case Some(n) =>
                withExamples.copy(
                  numericCount = withExamples.numericCount + 1,
                  numericSum   = withExamples.numericSum + n,
                  numericMin   = math.min(withExamples.numericMin, n),
                  numericMax   = math.max(withExamples.numericMax, n)
                )
              case None => withExamples
            }
          else withExamples
      }
    }

    val distinctCountCapped = fold.distinctSeen.size > DistinctCountCap
    val distinctCount       = math.min(fold.distinctSeen.size, DistinctCountCap)
    val nullRate            = if (totalRows == 0) 0.0 else fold.nullCount.toDouble / totalRows

    // `rawMean` is deliberately left UNROUNDED here — see the rounding
    // technique note below for why.
    val (min, max, rawMean) =
      if (fold.numericCount > 0)
        (Some(fold.numericMin), Some(fold.numericMax), Some(fold.numericSum / fold.numericCount))
      else (None, None, None)

    // HEL-373 skeptic-final-3.md, human-mandated placement: the terminal
    // boundary before a WorkspaceContextColumnStats is built and serialized —
    // the ONE place a "no non-finite min/max/mean" invariant can be enforced
    // totally, regardless of whether the non-finite value originated from a
    // per-value parse (asNumeric, already airtight per rounds 1-2) or from
    // aggregation itself (e.g. `fold.numericSum` overflowing Double to
    // Infinity across many individually-finite values, round 3's finding —
    // `min`/`max` cannot overflow the same way since they're `math.min`/
    // `math.max` over already-finite operands, but are guarded here too so
    // the invariant covers all three fields uniformly rather than depending
    // on today's arithmetic happening not to overflow). INVARIANT: no
    // WorkspaceContextColumnStats may ever be constructed containing a
    // non-finite min/max/mean — a non-finite value is excluded (`None`), same
    // "excluded, not fabricated, not zero" semantics asNumeric already
    // established for individual values.
    //
    // Rounding technique (round-3 fix, replaces design.md D5's originally
    // literal `math.round(sum/count * 10000) / 10000.0`): that technique's
    // OWN multiply-by-10000 step is a second, independent overflow surface —
    // `math.round` on a Double **at or beyond `Long.MaxValue` in magnitude**
    // (not just actual `Infinity`) silently CLAMPS to `Long.MaxValue` rather
    // than erroring (confirmed by direct probe: `math.round(1e308)` ==
    // `Long.MaxValue`), so a genuinely large-but-finite mean (e.g. one
    // enormous-but-legitimate outlier value averaged with 499 ordinary rows)
    // would silently fabricate the identical wrong ~922-trillion value this
    // whole ticket has been about eliminating — even though `rawMean` itself
    // is finite and mathematically correct. `BigDecimal.setScale` avoids this
    // entirely: it rounds to 4 decimal places without ever multiplying the
    // value's own magnitude, so a legitimately huge finite mean survives
    // correctly (its 4-decimals-place rounding is a practical no-op at that
    // magnitude, which is expected — not a defect). The final `.isFinite`
    // check (defense in depth) still excludes the vanishingly rare case where
    // `.toDouble`'s own BigDecimal→Double conversion overflows.
    WorkspaceContextColumnStats(
      nullRate             = nullRate,
      distinctCount        = distinctCount,
      distinctCountCapped  = distinctCountCapped,
      exampleValues        = fold.exampleValues,
      min                  = min.filter(_.isFinite),
      max                  = max.filter(_.isFinite),
      mean                 = rawMean.filter(_.isFinite).map(roundToFourDecimals).filter(_.isFinite)
    )
  }

  /** Rounds `v` to 4 decimal places via `BigDecimal.setScale` (design.md D5's
   *  "4 decimal places" requirement) without the intermediate
   *  multiply-then-`math.round`-as-`Long` overflow surface — see the
   *  round-3-fix comment at `computeColumnStatsForField`'s call site. Callers
   *  are responsible for ensuring `v` is already finite (this function does
   *  not itself guard non-finite input — `BigDecimal(Double.PositiveInfinity)`
   *  throws, so callers must filter first, which `computeColumnStatsForField`
   *  already does). */
  private def roundToFourDecimals(v: Double): Double =
    BigDecimal(v).setScale(MeanRoundingScale, RoundingMode.HALF_UP).toDouble

  /** Numeric parsing (design.md D5): `JsNumber` directly; `JsString(s)` via
   *  `s.trim.toDoubleOption` (CSV sources read numeric-declared columns as
   *  strings at runtime); everything else (boolean/object/array/unparseable
   *  string) is `None` — excluded from `min`/`max`/`mean`, NOT counted as
   *  null, NOT treated as `0`.
   *
   *  **Single exit-point finiteness filter (HEL-373 skeptic-final-2.md,
   *  human-mandated restructure after skeptic-final-1.md's per-branch patch
   *  missed a sibling instance of the same bug)**: `.filter(_.isFinite)` is
   *  applied ONCE, to the whole match's result, not per-branch. Why: a
   *  large-magnitude numeric JSON literal can overflow to `±Infinity` on
   *  conversion to `Double` regardless of which branch produced the
   *  candidate — `JsNumber`'s `BigDecimal.toDouble` overflows for a
   *  sufficiently large magnitude (e.g. `1e400`) even though `BigDecimal`
   *  itself is always finite/arbitrary-precision, and `JsString`'s
   *  `toDoubleOption` accepts the literal strings `"NaN"`/`"Infinity"`/
   *  `"-Infinity"` as successfully-parsed non-finite doubles. Either path
   *  would otherwise poison `mean` via `math.round` (`NaN` → `0L`,
   *  `Infinity` → `Long.MaxValue`) and make `min`/`max` silently
   *  wire-serialize to `null` via a `Some(NaN)`/`Some(Infinity)` — a
   *  different, unhandled failure mode from the documented `None`-omission
   *  behavior. Filtering once at the exit makes the function structurally
   *  incapable of returning a non-finite value regardless of which branch
   *  produced it, and any future branch added here inherits the guarantee
   *  automatically — the fix is at the contract's boundary, not duplicated
   *  per-branch.
   *
   *  `private[services]` so `WorkspaceContextServiceSpec` can unit-test it
   *  directly. */
  private[services] def asNumeric(v: JsValue): Option[Double] = (v match {
    case JsNumber(n) => Some(n.toDouble)
    case JsString(s) => s.trim.toDoubleOption
    case _           => None
  }).filter(_.isFinite)

  /** One join-hint candidate: an `identifier`-role column that also has a
   *  `columnStats` entry (HEL-374 design.md D2's round-1-fix candidacy
   *  restriction — see `computeJoinHints`), paired with the owning
   *  DataType's id and the `columnStats` needed for the confidence
   *  computation. Not part of the wire shape, purely an internal grouping
   *  helper. */
  private final case class JoinCandidate(dataTypeId: String, column: WorkspaceContextColumn, stats: WorkspaceContextColumnStats)

  /** Declared-type bucket for join-hint pairing (design.md D2): only columns
   *  in the SAME bucket are ever compared (numeric-ish vs. numeric-ish,
   *  string-ish vs. string-ish, timestamp vs. timestamp) — a cross-type
   *  identifier join (e.g. a string-typed id vs. an integer-typed id) is a
   *  stated, accepted miss (design.md Risks), not silently mismatched to a
   *  spurious pair. An unparseable `dataType` buckets with its own literal
   *  string, so two columns with the same unrecognized `dataType` can still
   *  pair, but never with a recognized type. */
  private def typeBucket(dataType: String): String = DataFieldType.fromString(dataType) match {
    case Some(DataFieldType.IntegerType) | Some(DataFieldType.FloatType)         => "numeric"
    case Some(DataFieldType.StringType)                                         => "string"
    case Some(DataFieldType.TimestampType)                                      => "timestamp"
    case Some(DataFieldType.BooleanType)                                        => "boolean"
    case Some(DataFieldType.StringBodyType) | Some(DataFieldType.BinaryRefType) => "content"
    case None                                                                   => s"unknown:$dataType"
  }

  /** Jaccard overlap of two already-truncated `compactPrint` example-value
   *  sets (design.md D2). Guards its own divide-by-zero explicitly, at the
   *  terminal boundary where the value is computed (carried finding #3 — ask
   *  what happens on the empty-vs-empty case before writing the guard, not
   *  just at it): an empty-vs-empty pair (e.g. two all-null identifier
   *  columns) yields `0.0`, not a fabricated `NaN`. */
  private def jaccard(left: Set[String], right: Set[String]): Double = {
    val union = left ++ right
    if (union.isEmpty) 0.0 else (left intersect right).size.toDouble / union.size.toDouble
  }

  /** Confidence for one candidate pair (HEL-374 design.md D2, post-design-gate
   *  human-review fix): `0.5 + 0.5 * jaccard * evidenceWeight`, NOT raw
   *  `0.5 + 0.5 * jaccard`. Raw Jaccard over ≤5 example values saturates
   *  trivially — two UNRELATED identifier columns that happen to hold small
   *  sequential integers (`1,2,3,4,5`, an overwhelmingly common shape for
   *  surface ids in small/demo/test data) would otherwise read as
   *  `confidence = 1.0` on pure coincidence. `evidenceWeight` dampens the
   *  value-overlap boost by cardinality evidence, reusing `distinctCount`
   *  (`columnStats` already computes it — no new computation, no new fetch):
   *  a column whose sampled `distinctCount` is small can contribute only a
   *  fraction of full evidence weight regardless of how completely its
   *  ≤5 example values overlap; a well-evidenced identifier column (typically
   *  `distinctCountCapped: true`) reaches `evidenceWeight = 1.0` quickly, so a
   *  real match can still reach the top of the scale. Rounded via the
   *  EXISTING `roundToFourDecimals` (reused verbatim, per carried finding #1
   *  — safe by inspection here since the domain is bounded `[0.5, 1.0]`). */
  private def joinHintConfidence(left: JoinCandidate, right: JoinCandidate): Double = {
    val leftValues  = left.stats.exampleValues.map(_.compactPrint).toSet
    val rightValues = right.stats.exampleValues.map(_.compactPrint).toSet
    val evidenceWeight =
      math.min(1.0, math.min(left.stats.distinctCount, right.stats.distinctCount).toDouble / MinDistinctForFullConfidence)
    roundToFourDecimals(0.5 + 0.5 * jaccard(leftValues, rightValues) * evidenceWeight)
  }

  /** Bounded, precision-favoring cross-DataType joinability hints (HEL-374
   *  design.md D2) — a pure post-processing step over `dataTypes`, the exact
   *  structures `assemble` already built; no new DB access, no new `Future`
   *  step (wired once, after the `Future.traverse` that builds `dataTypes`
   *  completes — design.md D3).
   *
   *  **Candidate gathering (design-gate round-1 fix, the central cost-bound
   *  requirement)**: a column is a candidate iff its `semanticRole ==
   *  "identifier"` AND its DataType's `columnStats` contains an entry for it
   *  — NOT gathered from `columns` alone, which is built from the DataType's
   *  entire unbounded declared field list. `columnStats` is independently
   *  capped at `SampleColumnLimit` (40) by `computeColumnStats`'s own
   *  enumeration, so requiring membership in it genuinely bounds candidates
   *  to ≤40 per DataType (verified by construction, not assumed) — and, as a
   *  side effect, automatically excludes source-companion DataTypes (whose
   *  `columnStats` is always empty) with no separate `pipelineOutput` filter,
   *  and guarantees every candidate has `exampleValues` available for the
   *  confidence computation.
   *
   *  **Bounding the comparison work**: candidates are grouped by normalized
   *  name (`normalizedNameTokens`, reused verbatim from the semantic-role
   *  name heuristic — one implementation, not a forked copy); each bucket is
   *  capped at `MaxColumnsPerNameBucket`, stable-sorted by `(dataTypeId,
   *  column name)` before truncation (deterministic, not iteration-order-
   *  dependent). Only cross-DataType, same-declared-type-bucket pairs are
   *  compared. Worst case: `Page.Default` (200) DataTypes × `SampleColumnLimit`
   *  (40) candidates each = 8,000 candidate columns; each compared against at
   *  most `MaxColumnsPerNameBucket - 1` (49) same-bucket peers ⇒ ≤ 392,000
   *  pairwise comparisons, each an O(1)-ish Jaccard over ≤5-element sets — no
   *  DB I/O, sub-second CPU, independent of how many buckets exist.
   *
   *  `private[services]` so this can be pure-unit-tested directly (tasks.md
   *  5.2), mirroring `sanitizeSampleRows`/`computeColumnStats`. */
  private[services] def computeJoinHints(dataTypes: Vector[WorkspaceContextOutput]): Vector[WorkspaceContextJoinHint] = {
    val candidates: Vector[JoinCandidate] = dataTypes.flatMap { dt =>
      dt.columns
        .filter(c => c.semanticRole == "identifier" && dt.columnStats.contains(c.name))
        .map(c => JoinCandidate(dt.id, c, dt.columnStats(c.name)))
    }

    val buckets: Map[String, Vector[JoinCandidate]] =
      candidates.groupBy(c => normalizedNameTokens(c.column.name).mkString(""))

    val hints: Vector[WorkspaceContextJoinHint] = buckets.values.flatMap { bucket =>
      val capped = bucket.sortBy(c => (c.dataTypeId, c.column.name)).take(MaxColumnsPerNameBucket)
      for {
        i <- capped.indices
        j <- (i + 1) until capped.size
        a  = capped(i)
        b  = capped(j)
        if a.dataTypeId != b.dataTypeId
        if typeBucket(a.column.dataType) == typeBucket(b.column.dataType)
      } yield {
        // Canonical (left, right) assignment (design.md D2): the
        // lexicographically smaller dataTypeId is always left — one hint per
        // unordered pair, never two.
        val (left, right) = if (a.dataTypeId < b.dataTypeId) (a, b) else (b, a)
        WorkspaceContextJoinHint(
          leftDataTypeId  = left.dataTypeId,
          leftColumn      = left.column.name,
          rightDataTypeId = right.dataTypeId,
          rightColumn     = right.column.name,
          confidence      = joinHintConfidence(left, right)
        )
      }
    }.toVector

    hints
      .sortBy(h => (-h.confidence, h.leftDataTypeId, h.leftColumn, h.rightDataTypeId, h.rightColumn))
      .take(MaxJoinHints)
  }

  /** `private[services]` (not `private`) — HEL-661 design.md D2: reused verbatim by
   *  `WorkspaceSearchService`'s dashboard dispatch (both `find`'s panel-count description synthesis
   *  and `getResource`'s dashboard detail), mirroring `buildPipeline`'s existing same-package-reuse
   *  precedent. `Future`-returning (beta UI-audit F-004 fix) -- `panelCountFor` needs a real DB
   *  read when `panelRepoOpt` is wired, matching `toDataTypeEntry`'s existing
   *  `(entity, user) => Future[...]` shape immediately below. */
  private[services] def toDashboardEntry(d: Dashboard, user: AuthenticatedUser): Future[WorkspaceContextDashboard] =
    panelCountFor(d, user).map(count => WorkspaceContextDashboard(id = d.id.value, name = d.name, panelCount = count))

  /** Beta UI-audit F-004 fix: when `panelRepoOpt` is wired, the real row count over the panels
   *  table -- `Page(0, 1)` still returns the accurate total via that same query's own COUNT
   *  alongside the (discarded) 1-row slice, no over-fetch (same technique
   *  `PatchSetPreviewImpact.compute`'s `DashboardDelete` case already uses for its cascade hint).
   *  Falls back to the legacy layout-derived heuristic only when no `PanelRepository` is wired
   *  (fixtures using the pre-existing 4-/6-arg constructor) -- never in the running app, where
   *  `ApiRoutes` always supplies `Some(panelRepo)`. */
  private def panelCountFor(d: Dashboard, user: AuthenticatedUser): Future[Int] =
    panelRepoOpt match {
      case Some(panelRepo) => panelRepo.findAllByDashboardId(d.id, Some(user), Page(0, 1)).map(_.total)
      case None            => Future.successful(distinctPanelCount(d.layout))
    }

  /** Distinct panel ids referenced across all four responsive breakpoints —
   *  mirrors `context.ts`'s `panelCount` helper. LEGACY fallback ONLY (beta UI-audit F-004) --
   *  undercounts any panel the client placed via its default auto-layout without ever being
   *  manually dragged/resized, since `dashboard.layout` is written only by that debounce-gated
   *  drag/resize persist path. Retained solely so `panelCountFor`'s `panelRepoOpt = None` branch
   *  (fixtures) keeps its pre-fix behavior; `panelCountFor`'s `Some` branch is the real fix and is
   *  what the running app always exercises. */
  private def distinctPanelCount(layout: DashboardLayout): Int =
    (layout.lg ++ layout.md ++ layout.sm ++ layout.xs).map(_.panelId).toSet.size
}
