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
)(implicit ec: ExecutionContext)
    extends WorkspaceContextComputations {

  /** Shared fetch's row bound (HEL-373 design.md D1): raised from
   *  `SampleRowLimit` (5) to 500 — matches `DataSourceService.staticMaxRows`,
   *  the codebase's existing "reasonably-sized snapshot" constant. Both
   *  `sampleRows` and `columnStats` are derived from this ONE fetch; no
   *  second query. */
  private val StatsRowLimit: Int = 500

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
    // carry zero-to-many Outputs, potentially on different nodes. `outputId`/
    // `outputName` are legacy wire field NAMES this ticket does not rename (that's
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
      roots                = summary.roots,
      outputId     = representativeOutput.map(_.id.value).getOrElse(""),
      outputName   = representativeOutput.map(_.name).getOrElse(""),
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
            .listRows(output.node.pipelineId.value, output.node.stepId.map(_.value), limit = Some(StatsRowLimit), excludeKeys = excludeKeys, explicitRootId = output.node.rootId.map(_.value))
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
