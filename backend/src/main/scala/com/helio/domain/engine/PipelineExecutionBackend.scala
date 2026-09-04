package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, DataSource, Pipeline, PipelineStep, TruncationSink}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import PipelineRowJson.Row

import scala.concurrent.{ExecutionContext, Future}

/** HEL-330 (design.md Decision 1): the submit-run -> status -> read-result seam a second
 *  execution engine (Dataproc Serverless, HEL-331) plugs into. A single `Future`-returning
 *  `execute` models all three of the ticket's phrase's steps at once -- a `Future` already IS an
 *  async submit-then-read-result value; a literal three-method submit/status/read API would force
 *  `PipelineRunService` to poll, which is a behavioral change this refactor explicitly rules out.
 *
 *  `assertionSink`/`truncationSink` are in-process-engine-specific output parameters
 *  (HEL-509/HEL-861). An implementation with no equivalent concept (e.g. `SparkJobSubmitter`,
 *  which supports neither `assert` steps nor truncation tracking) MUST leave them untouched --
 *  never populate or clear them -- silently ignoring both. */
trait PipelineExecutionBackend {
  /** HEL-913 (design.md R4/R9): `roots` replaces the single `dataSource` argument -- one
   *  `(rootId, DataSource)` pair per pipeline root, ORDERED by `position` ascending (R3's
   *  cross-root tiebreak). R9: one run loads every root's source and refreshes every Output,
   *  atomically -- a failure loading ANY root's source fails the whole run. Non-empty by
   *  construction (R1: every pipeline has at least one root). */
  def execute(
      pipeline: Pipeline,
      roots: Vector[(String, DataSource)],
      steps: Vector[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      // HEL-905 (design.md Decision 6): invoked once per node completed by a tree-walk
      // implementation, defaulted to a no-op so every existing call site (and every
      // implementation with no per-node concept, e.g. SparkJobSubmitter) keeps compiling
      // and is never required to call it. HEL-913 R15: keyed by NodeKey -- a root reports its
      // own root id, never `null`/`None` standing in for "the" root.
      onNodeProgress: (NodeKey, Long) => Unit = (_, _) => ()
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome]
}

/** HEL-905 (design.md Decision 1): one materialized node's terminal frame from a tree walk --
 *  either a trunk node or a tail's terminal node. */
final case class NodeOutcome(rows: Seq[Row], rowCount: Long)

/** The row/step-count/stats outcome `PipelineRunService`'s two execution call sites
 *  (`executeRun`, `previewStep`) already compute today, unified behind [[PipelineExecutionBackend]]. */
final case class PipelineExecutionOutcome(
    rows: Seq[Row],
    stepCounts: Map[String, Long],
    sourceRowCount: Long,
    primaryStats: SourceReadStats,
    // HEL-905 (design.md Decision 1): NEW, additive -- every evaluated node's frame, keyed by
    // step id string (`None` = pipeline root, mirrors `outputs.node_step_id`'s NULL = root
    // convention). Defaults to empty so every existing construction site (SparkJobSubmitter,
    // test fixtures) keeps compiling unmodified.
    // HEL-913 R4/R15: keyed by [[NodeKey]] -- supersedes the `Option[String]`/`None`-means-root
    // encoding above (kept for historical context; no longer accurate).
    nodeOutcomes: Map[NodeKey, NodeOutcome] = Map.empty
)
