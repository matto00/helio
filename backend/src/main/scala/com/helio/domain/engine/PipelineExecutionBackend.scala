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
      truncationSink: TruncationSink
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome]
}

/** The row/step-count/stats outcome `PipelineRunService`'s two execution call sites
 *  (`executeRun`, `previewStep`) already compute today, unified behind [[PipelineExecutionBackend]]. */
final case class PipelineExecutionOutcome(
    rows: Seq[Row],
    stepCounts: Map[String, Long],
    sourceRowCount: Long,
    primaryStats: SourceReadStats
)
