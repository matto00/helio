package com.helio.services.workspace

import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.pipelines.{PipelineStepConfigCodec, PipelineSummaryResponse}
import com.helio.api.protocols.workspace.{ResourceNode, ResourceOutputRef, WorkspaceResourceDetail, WorkspaceResourceSummary}
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DataSource, DataSourceId, Output, OutputId, OutputKind, Page, PipelineId, WorkspaceResourceType}
import com.helio.infrastructure.persistence.pipelines.OutputRepository

import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** HEL-661 — narrow `find`/`getResource` primitives for HEL-659's top-level assistant, backing the
 *  `WorkspaceAssistantTools` `ClaudeTool` schemas. Composes the SAME services `WorkspaceContextService`
 *  already composes, plus `workspaceContextService` itself for `getResource`'s per-entry detail
 *  (design.md D1) — mirrors `WorkspaceContextService`'s own "compose services, never touch
 *  repositories directly" discipline. Does NOT replace `WorkspaceContextService`: that continues
 *  backing the unchanged `GET /api/workspace/context` route unaffected by this class.
 *
 *  HEL-904 task 3.2: the Metric resource kind is REMOVED outright (not retargeted) — metrics are
 *  retired (design.md decision 2/11); `MetricService`/`WorkspaceResourceType.Metric` are no longer
 *  composed or matched here (see the `workspace-resource-search` OpenSpec delta).
 *
 *  `find` intentionally does NOT reuse `workspaceContextService`'s heavier per-item assembly (sample
 *  rows/column stats, per-pipeline `analyze`) — it calls each composed service's own lightweight
 *  `findAll`/`listSummaries` directly and synthesizes a one-line description per type (design.md D5),
 *  since that per-item detail would be wasteful for a keyword search. `getResource` is the opposite:
 *  it fetches exactly ONE owned resource and reuses `workspaceContextService`'s (now `private[services]`)
 *  per-entry converters for full detail, rather than duplicating that assembly logic. */
final class WorkspaceSearchService(
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    // HEL-904 task 3.2: replaces `dataTypeService: DataTypeService` in the SAME positional slot
    // (mirrors `WorkspaceContextService`'s own task-3.12 param swap) -- every existing test call
    // site passing a literal `null` here keeps compiling unchanged; only call sites passing a
    // real `dataTypeService` instance need updating to pass a real `outputRepo`.
    outputRepo: OutputRepository,
    pipelineService: PipelineService,
    workspaceContextService: WorkspaceContextService
)(implicit ec: ExecutionContext) {

  require(outputRepo != null, "WorkspaceSearchService requires an OutputRepository")

  /** `find`'s fixed top-K result cap (design.md D1a, design-gate round-1 REFUTE fix) — `find` scans
   *  up to `Page.Default` (200) candidates per requested resource type (up to 1,000 total across all
   *  5 unfiltered), but the ticket's Scope section promises "top-K matches," not "every match." A
   *  named, doc-commented tunable, matching `WorkspaceContextService`'s own style of constants
   *  (`SampleRowLimit`/`MaxJoinHints`). `find` NEVER returns more than this many summaries. */
  private val MaxFindResults: Int = 20


  /** Keyword/substring search across the caller's own data sources, DataTypes, pipelines,
   *  dashboards, and metrics (owner-scoped throughout — every composed `findAll`/`listSummaries` call
   *  already filters by the caller, mirroring `WorkspaceContextService.assemble`'s identical
   *  discipline). `resourceTypes = None` searches all 5 types; a non-empty `Some` restricts the fan-out
   *  to only those types. Matching is case-insensitive substring containment over `name` OR the
   *  synthesized/real `description` (design.md D5). Never throws for a query matching nothing — an
   *  empty `Vector`, not an error. Result set is capped at `MaxFindResults` (design.md D1a), sorted
   *  deterministically: name-match-position ascending (a description-only match sorts after every
   *  name match), then `(resourceType, name)` ascending as a stable tie-break. */
  def find(
      user: AuthenticatedUser,
      query: String,
      resourceTypes: Option[Set[WorkspaceResourceType]] = None
  ): Future[Vector[WorkspaceResourceSummary]] = {
    def requested(t: WorkspaceResourceType): Boolean = resourceTypes.forall(_.contains(t))

    val dataSourceSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.DataSource))
        dataSourceService.findAll(user, Page.Default).map(_.items.map(toDataSourceSummary))
      else Future.successful(Vector.empty)

    val dataTypeSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.DataType))
        outputRepo.findAllByOwner(user.id, Page.Default).map(_.items.map(toDataTypeSummary))
      else Future.successful(Vector.empty)

    val pipelineSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.Pipeline))
        pipelineService.listSummaries(user).map(_.map(toPipelineSummary))
      else Future.successful(Vector.empty)

    val dashboardSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.Dashboard))
        dashboardService.findAll(user, Page.Default).flatMap(page => Future.traverse(page.items)(toDashboardSummary(_, user)))
      else Future.successful(Vector.empty)

    for {
      dataSourceSummaries <- dataSourceSummariesF
      dataTypeSummaries   <- dataTypeSummariesF
      pipelineSummaries   <- pipelineSummariesF
      dashboardSummaries  <- dashboardSummariesF
    } yield {
      val candidates = dataSourceSummaries ++ dataTypeSummaries ++ pipelineSummaries ++ dashboardSummaries
      rankAndTruncate(candidates, WorkspaceSearchService.Query(query))
    }
  }

  /** HEL-1639 D6: a candidate matches when the whole query is a substring of its name or description (the
   *  pre-existing behaviour) OR any significant query token occurs in its name or description. The score is the
   *  number of tokens found in the NAME (a whole-query hit counts as every token), so "Fantasy Football standings
   *  dashboard" finds a dashboard named "Standings". */
  private def score(summary: WorkspaceResourceSummary, q: WorkspaceSearchService.Query): Option[(Int, Int)] = {
    val name = summary.name.toLowerCase
    val desc = summary.description.toLowerCase
    val whole = q.whole
    val wholeInName = name.contains(whole)
    val wholeInDesc = desc.contains(whole)
    val nameTokens = q.tokens.count(name.contains)
    val descTokens = q.tokens.count(desc.contains)
    if (wholeInName) Some((q.tokens.size + 1, name.indexOf(whole)))
    else if (nameTokens > 0) Some((nameTokens, name.indexOf(q.tokens.find(name.contains).get)))
    else if (wholeInDesc || descTokens > 0) Some((0, Int.MaxValue))
    else None
  }

  /** Deterministic top-K selection (design.md D1a): best token score first, then earlier name position, with
   *  `(resourceType, name)` ascending as the stable tie-break -- never an iteration-order-dependent subset. */
  private def rankAndTruncate(candidates: Vector[WorkspaceResourceSummary], q: WorkspaceSearchService.Query): Vector[WorkspaceResourceSummary] =
    candidates
      .flatMap(c => score(c, q).map(sc => (c, sc)))
      .sortBy { case (c, (hits, pos)) => (-hits, pos, c.resourceType, c.name) }
      .map(_._1)
      .take(MaxFindResults)

  private def toDataSourceSummary(ds: DataSource): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = ds.id.value,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.DataSource),
      name         = ds.name,
      description  = s"${ds.kind} data source"
    )

  // HEL-904 task 3.2: renamed from `toDataTypeSummary` -- the wire `resourceType` string stays
  // `"dataType"` (`WorkspaceResourceType.DataType`'s own `asString`, unchanged -- renaming that
  // wire value is section 5's schema-surface job, not this task's), only the source domain object
  // changed from `DataType` to `Output`. `sourceId`/source-companion distinction no longer exists
  // (that split was retired with DataType/Metric) -- every Output is a pipeline-output projection.
  private def toDataTypeSummary(output: Output): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = output.id.value,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.DataType),
      name         = output.name,
      description  = "pipeline output"
    )

  private def toPipelineSummary(p: PipelineSummaryResponse): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = p.id,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.Pipeline),
      name         = p.name,
      // HEL-904 task 3.5: `outputDataTypeName` no longer exists on
      // `PipelineSummaryResponse` (task 3.2 rewires this description onto
      // Outputs). Left source-only until then.
      // HEL-913 task 7.2a: `sourceDataSourceName` (the lowest-positioned root's convenience
      // scalar) removed -- reading `roots.head` here unqualified would be exactly R3's banned
      // "position privileges a root" pattern reappearing in presentation text. A single-root
      // pipeline (still the overwhelming common case) names its one source; a genuine
      // multi-root pipeline states the count instead of silently picking one root to represent
      // all of them.
      description  = p.roots match {
        case Vector(only) => only.dataSourceName
        case many         => s"${many.size} sources"
      }
    )

  /** Reuses `workspaceContextService.toDashboardEntry` (widened `private[services]`, design.md D2)
   *  for its `panelCount` computation rather than duplicating `distinctPanelCount`'s layout-dedup
   *  logic here — one implementation, no drift. `Future`-returning (beta UI-audit F-004 fix) --
   *  `toDashboardEntry` now needs `user` for a real DB-backed `panelCount`. */
  private def toDashboardSummary(d: Dashboard, user: AuthenticatedUser): Future[WorkspaceResourceSummary] =
    workspaceContextService.toDashboardEntry(d, user).map { entry =>
      WorkspaceResourceSummary(
        id           = d.id.value,
        resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.Dashboard),
        name         = d.name,
        description  = s"dashboard, ${entry.panelCount} panels"
      )
    }

  /** Full per-resource detail for exactly one owned resource, dispatched by `resourceType`. Reuses
   *  `workspaceContextService`'s (now `private[services]`) per-entry converters for the 4 resource
   *  types below (design.md D1) rather than duplicating that assembly logic. HEL-904 cycle 29: the
   *  former 5th case (`WorkspaceResourceMetric`, built directly from the now-deleted
   *  `MetricDefinition`) was already removed in an earlier cycle; this comment had gone stale still
   *  citing it. Strictly owner-scoped for EVERY type, matching `find`'s own owner-only listings —
   *  `Left(NotFound)` for an
   *  id that doesn't exist OR isn't owned by `user`, never a leaked "exists but forbidden" signal and
   *  never an exception. */
  def getResource(
      user: AuthenticatedUser,
      id: String,
      resourceType: WorkspaceResourceType
  ): Future[Either[ServiceError, WorkspaceResourceDetail]] = resourceType match {
    case WorkspaceResourceType.DataSource =>
      dataSourceService.findById(DataSourceId(id), user).map(_.map(ds => WorkspaceResourceDetail.DataSourceDetail(workspaceContextService.toDataSourceEntry(ds))))

    case WorkspaceResourceType.DataType =>
      // HEL-904 task 3.2: `outputRepo.findByIdOwned` returns `Future[Option[Output]]`, not the
      // `Either[ServiceError, _]` `dataTypeService.findById` used to -- `None` maps to the same
      // `NotFound` `getResource` already returns for every other unowned/nonexistent resource
      // (existence-not-leaked, unchanged contract).
      outputRepo.findByIdOwned(OutputId(id), user).flatMap {
        case None         => Future.successful(Left(ServiceError.NotFound(s"Output not found: $id")))
        case Some(output) => workspaceContextService.toDataTypeEntry(output, user).map { entry =>
          Right(WorkspaceResourceDetail.DataTypeDetail(entry, Some(output.node.pipelineId.value), output.node.stepId.map(_.value)))
        }
      }

    case WorkspaceResourceType.Pipeline =>
      getPipelineResource(user, PipelineId(id))

    case WorkspaceResourceType.Dashboard =>
      dashboardService.findById(DashboardId(id), user).flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(d) =>
          for {
            entry  <- workspaceContextService.toDashboardEntry(d, user)
            panels <- workspaceContextService.dashboardPanels(d, user)
          } yield Right(WorkspaceResourceDetail.DashboardDetail(entry, panels))
      }

  }

  /** `PipelineService.findSummaryById` is sharing-aware (owner, editor, and viewer grantees can
   *  read — its own doc comment) — using it unfiltered would let a pipeline shared with, but not
   *  owned by, `user` succeed, contradicting `getResource`'s own owner-only contract for every other
   *  resource type (design.md D1b, design-gate round-1 REFUTE fix). Filter on
   *  `summary.ownerId.contains(user.id.value)` BEFORE building detail — `Left(NotFound)` otherwise,
   *  same "existence not leaked" semantics as every other branch above. */
  private def getPipelineResource(user: AuthenticatedUser, pipelineId: PipelineId): Future[Either[ServiceError, WorkspaceResourceDetail]] =
    pipelineService.findSummaryById(pipelineId, user).flatMap {
      case Left(err) =>
        Future.successful(Left(err))
      case Right(summary) if !summary.ownerId.contains(user.id.value) =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Right(summary) => pipelineDetail(summary, user).map(Right(_))
    }

  /** HEL-1639 D1: the pipeline detail the assistant needs to extend a pipeline -- `laneTree` populated (this pipeline's
   *  own steps, roots and root-of-step maps, the same batch helpers `assemble` uses, scoped to one id), every node with
   *  its config and the schema after it, and every Output with its node, kind and fieldMapping. */
  private def pipelineDetail(summary: PipelineSummaryResponse, user: AuthenticatedUser): Future[WorkspaceResourceDetail.PipelineDetail] = {
    val pid = PipelineId(summary.id)
    val ids = Set(pid)
    // ACL: `getPipelineResource` established that `user` owns this pipeline (the owner-only filter) before calling here, so the
    // `*Internal` reads below (batched steps/roots, the pipeline's Outputs and their configs) are scoped by that check.
    for {
      rootDs       <- pipelineService.listRootDataSourceIdsInternalBatch(ids)
      rootIdOfStep <- pipelineService.rootIdsOfBatch(ids)
      steps        <- pipelineService.listByPipelineInternalBatch(ids)
      entry        <- workspaceContextService.buildPipeline(summary, user, rootDs, rootIdOfStep, steps)
      analyzed     <- pipelineService.analyze(pid, user).map(_.toOption).recover { case _ => None }
      outputs      <- outputRepo.listByPipelineInternal(pid)
      configs      <- outputRepo.findConfigsByIdsInternal(outputs.map(_.id.value))
    } yield {
      val ownSteps  = steps.getOrElse(pid, Vector.empty)
      val schemaOf  = analyzed.map(_.steps.map(a => a.id -> a).toMap).getOrElse(Map.empty)
      val rootOf    = rootIdOfStep.getOrElse(pid, Map.empty)
      val ordered   = analyzed.map(_.steps.map(_.id)).getOrElse(ownSteps.map(_.id.value))
      val byId      = ownSteps.map(st => st.id.value -> st).toMap
      val nodes = ordered.flatMap(byId.get).map { st =>
        val a = schemaOf.get(st.id.value)
        ResourceNode(
          id = st.id.value,
          parentStepId = st.parentStepId.map(_.value),
          rootId = rootOf.get(st.id).map(_.value),
          `type` = st.kind,
          config = SecretRedaction.redact(PipelineStepConfigCodec.encode(st).parseJson),
          disabled = !st.enabled,
          outputSchema = a.map(_.outputSchema).getOrElse(Vector.empty),
          validationError = a.flatMap(_.validationError)
        )
      }
      val outputRefs = outputs.map { o =>
        ResourceOutputRef(o.id.value, o.name, OutputKind.asString(o.kind), o.node.stepId.map(_.value), configs.get(o.id.value).flatMap(_.fields.get("fieldMapping")))
      }
      WorkspaceResourceDetail.PipelineDetail(entry, nodes, outputRefs)
    }
  }
}

object WorkspaceSearchService {

  /** Words that carry no identity in a resource search ("my standings dashboard"). */
  private val StopWords: Set[String] = Set("my", "the", "a", "of", "for", "dashboard", "pipeline", "output", "source", "data")

  /** `whole` is the lower-cased query (the old contiguous-substring match); `tokens` are its lower-cased alphanumeric
   *  words of at least 2 characters that are not stop words. With no tokens left the query behaves exactly as before. */
  final case class Query(whole: String, tokens: Vector[String])

  object Query {
    def apply(raw: String): Query = {
      val whole = raw.toLowerCase
      Query(whole, whole.split("[^a-z0-9]+").toVector.filter(t => t.length >= 2 && !StopWords.contains(t)).distinct)
    }
  }
}
