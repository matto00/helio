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
  def execute(
      pipeline: Pipeline,
      dataSource: DataSource,
      steps: Vector[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      // HEL-905 (design.md Decision 6): invoked once per node completed by a tree-walk
      // implementation, defaulted to a no-op so every existing call site (and every
      // implementation with no per-node concept, e.g. SparkJobSubmitter) keeps compiling
      // and is never required to call it.
      onNodeProgress: (Option[String], Long) => Unit = (_, _) => ()
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
    nodeOutcomes: Map[Option[String], NodeOutcome] = Map.empty
)
