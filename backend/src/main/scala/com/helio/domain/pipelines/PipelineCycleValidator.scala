package com.helio.domain.pipelines

import com.helio.domain.model.{DataSourceId, PipelineId}

import scala.collection.mutable

/** HEL-1101: validation-time cycle detection for the pipeline write/read dependency graph
 *  (design spec `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`, epic
 *  HEL-1098: "a pipeline must not write to a source it reads").
 *
 *  Graph model (design.md Decision 1): NODES are data sources; an edge `S1 -> S2` means "some
 *  pipeline reads `S1` and writes `S2`", labelled with that pipeline's id/name. This is a
 *  MULTIGRAPH (Decision 6) -- more than one pipeline can produce the same `S1 -> S2` edge, so
 *  each [[Edge]] instance is kept distinct, never collapsed to a plain boolean adjacency.
 *
 *  A cycle in this graph is exactly a write/read loop that would run forever at run time; this
 *  validator answers "does adding one pending edge (a caller's in-flight write) to the caller's
 *  own currently-visible graph create a cycle?" via forward reachability FROM the pending
 *  write's target, searched through the EXISTING graph only (HEL-1101 skeptic-final-1.md CR2 --
 *  never a bare "does any cycle exist anywhere" scan, which would block unrelated writes on a
 *  standing cycle the pending edge had nothing to do with). A node reached via two disjoint
 *  paths (a diamond) is simply reachable once -- there is no cycle-specific ambiguity to
 *  resolve, since this asks "can X reach Y", not "is there a back-edge on the current path".
 *
 *  This is a pure, DB-free domain object: every caller (`PipelineRootRepository`,
 *  `PipelineStepRepository`, `PipelineService`) is responsible for fetching the caller-VISIBLE
 *  edge sets first (via the explicit, non-RLS-dependent queries documented on
 *  `PipelineRootRepository.findReadEdgesVisibleTo` / `PipelineStepRepository.findUpsertWriteEdges`
 *  -- design.md Decision 2) and for resolving [[CycleError.message]]'s data-source names
 *  according to the acting caller's own read access to each source (a data source is
 *  owner-only-readable, V35 -- see design.md's "Post-CONFIRM non-blocking fixes"). */
object PipelineCycleValidator {

  /** `pg_advisory_xact_lock` key used to serialize every edge-adding pipeline write
   *  tenant-wide (design.md Decision 4) -- this ticket's own Linear id, chosen simply to be a
   *  fixed, documented, collision-free constant; it carries no other significance. Referenced by
   *  name at every call site, never repeated as a literal (design.md "Post-CONFIRM non-blocking
   *  fixes"). */
  val AdvisoryLockKey: Long = 72901101L

  /** One `pipeline_roots` row, as fetched by `PipelineRootRepository.findReadEdgesVisibleTo`. */
  final case class ReadEdge(pipelineId: PipelineId, pipelineName: String, dataSourceId: DataSourceId)

  /** One `upsertsource`-with-`ExistingSource`-target `pipeline_steps` row, as fetched by
   *  `PipelineStepRepository.findUpsertWriteEdges`. */
  final case class WriteEdge(pipelineId: PipelineId, pipelineName: String, dataSourceId: DataSourceId)

  /** One graph edge `from -> to`, labelled with the pipeline whose read/write pairing produced
   *  it (Decision 1/6). */
  final case class Edge(from: DataSourceId, to: DataSourceId, pipelineId: PipelineId, pipelineName: String)

  /** The result of a failed check: the ordered chain of edges that closes the cycle, starting
   *  from the pending write's own closing back-edge. `edges.head.from` is the cycle's "start"
   *  node (Decision 3's message format opens with it). */
  final case class CycleError(edges: Vector[Edge]) {

    /** Builds `"<name> -> <pipeline> -> <name> -> ... -> <name>"` (Decision 3), resolving each
     *  data source's displayed name via `nameOf` -- the caller supplies this so the id-vs-name
     *  choice per source (owner sees the name, a non-owner sees the id -- the post-CONFIRM
     *  fix) is made by the service layer, which alone knows the acting caller's ownership of
     *  each source. Defaults to the raw id, for callers/tests with no naming policy. */
    def message(nameOf: DataSourceId => String = _.value): String = {
      val head = nameOf(edges.head.from)
      val rest = edges.map(e => s"${e.pipelineName} -> ${nameOf(e.to)}").mkString(" -> ")
      s"$head -> $rest"
    }
  }

  /** Checks whether adding one pending edge -- a pipeline named `writingPipelineId`/
   *  `writingPipelineName` reading every source in `readSources` and writing `writeTarget` --
   *  to the graph built from `readEdges`/`writeEdges` (already caller-visibility-scoped by the
   *  repository queries that produced them, per design.md Decision 2) introduces a cycle.
   *
   *  `readSources`/`writeTarget`/`writingPipelineId`/`writingPipelineName` describe the PENDING
   *  write under validation -- not necessarily yet present in `readEdges`/`writeEdges` (e.g. a
   *  brand-new pipeline being created has no existing rows at all). This lets every call site
   *  (create, addRoot, addStep, updateStep) describe its own pending change uniformly, including
   *  the same-request self-cycle case (`readSources` and `writeTarget` both belong to the SAME
   *  not-yet-persisted pipeline).
   *
   *  '''HEL-1101 skeptic-final-1.md CR2 (round-1 REFUTE):''' this ONLY reports a cycle that the
   *  PENDING edge itself closes -- never a bare "does any cycle exist anywhere in the visible
   *  graph" scan. A standing cycle that already exists among OTHER pipelines (however it got
   *  there -- design.md accepts that one can exist through resources outside a caller's
   *  visibility until a later share makes it visible) must never block an unrelated write. This
   *  is implemented as forward reachability FROM `writeTarget`, through the EXISTING graph only
   *  (never through other pending edges), to any node in `readSources`: if `writeTarget` can
   *  reach a read source, then adding the pending edge(s) `readSources -> writeTarget` closes
   *  exactly that path into a loop; if it can't, the pending write is safe regardless of what
   *  else exists in the graph. Returns `Right(())` when no cycle is introduced, else
   *  `Left(CycleError(...))` naming the closing chain -- the reachability path from
   *  `writeTarget` back to the reached read source, followed by the pending edge that closes it
   *  (Decision 6's tie-break: among several existing edges that could continue the same path,
   *  prefer the edge belonging to `writingPipelineId`, else break ties by ascending pipeline
   *  id). */
  def checkNoCycle(
      readEdges: Vector[ReadEdge],
      writeEdges: Vector[WriteEdge],
      readSources: Set[DataSourceId],
      writeTarget: DataSourceId,
      writingPipelineId: PipelineId,
      writingPipelineName: String
  ): Either[CycleError, Unit] = {
    val readsByPipeline: Map[PipelineId, Set[DataSourceId]] =
      readEdges.groupBy(_.pipelineId).view.mapValues(_.map(_.dataSourceId).toSet).toMap

    // Every EXISTING write edge, expanded against its OWN pipeline's read sources -- Decision
    // 1's "S1 -> S2 means some pipeline reads S1 and writes S2" definition, applied per
    // already-persisted `upsertsource` step. Deliberately excludes the pending edge itself --
    // reachability is searched through this existing graph only (see scaladoc above).
    val existingEdges: Vector[Edge] =
      writeEdges.flatMap { w =>
        readsByPipeline.getOrElse(w.pipelineId, Set.empty).toVector.sortBy(_.value).map { r =>
          Edge(r, w.dataSourceId, w.pipelineId, w.pipelineName)
        }
      }

    // Deterministic adjacency ordering (Decision 6): among parallel existing edges out of the
    // same node reaching the same target, the edge belonging to the pending write's own
    // pipeline sorts first; remaining ties break by ascending pipeline id.
    val adjacency: Map[DataSourceId, Vector[Edge]] =
      existingEdges
        .groupBy(_.from)
        .view
        .mapValues(_.sortBy(e => (e.to.value, e.pipelineId != writingPipelineId, e.pipelineId.value)))
        .toMap

    findReachablePath(writeTarget, readSources, adjacency) match {
      case Some(path) =>
        val closingEdge = Edge(path.lastOption.map(_.to).getOrElse(writeTarget), writeTarget, writingPipelineId, writingPipelineName)
        Left(CycleError(path :+ closingEdge))
      case None => Right(())
    }
  }

  /** Forward DFS from `start`, through `adjacency` (the EXISTING graph only -- see
   *  `checkNoCycle`'s scaladoc), stopping at the first node in `targets` reached. `start` itself
   *  counts as reached with a zero-length path when `targets.contains(start)` -- this is the
   *  direct self-cycle case (a pipeline's write target is one of its own read sources).
   *  Deterministic: nodes are visited in the adjacency's own fixed (Decision-6-sorted) edge
   *  order, and a node is never revisited once explored (ordinary reachability DFS -- no
   *  three-colour distinction is needed here, since this only asks "can X reach Y", not "is
   *  there a cycle at X"). */
  private def findReachablePath(
      start: DataSourceId,
      targets: Set[DataSourceId],
      adjacency: Map[DataSourceId, Vector[Edge]]
  ): Option[Vector[Edge]] = {
    if (targets.contains(start)) Some(Vector.empty)
    else {
      val visited = mutable.Set.empty[DataSourceId]
      def dfs(node: DataSourceId, path: Vector[Edge]): Option[Vector[Edge]] = {
        visited += node
        adjacency.getOrElse(node, Vector.empty).iterator.flatMap { e =>
          if (targets.contains(e.to)) Some(path :+ e)
          else if (visited.contains(e.to)) None
          else dfs(e.to, path :+ e)
        }.nextOption()
      }
      dfs(start, Vector.empty)
    }
  }
}
