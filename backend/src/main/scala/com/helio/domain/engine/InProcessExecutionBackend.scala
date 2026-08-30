package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, DataSource, Pipeline, PipelineStep, TruncationSink}
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-330 (design.md Decision 1): wraps [[InProcessPipelineEngine.loadRowsWithStats]] +
 *  `.executeWithStepCounts` verbatim -- no logic change, just re-shaping the existing two-call
 *  chain into one [[PipelineExecutionBackend.execute]] call. `pipeline` is accepted per the
 *  trait's signature but unused here -- the in-process engine's row-source loading dispatches
 *  entirely off `dataSource`. */
final class InProcessExecutionBackend(engine: InProcessPipelineEngine) extends PipelineExecutionBackend {

  def execute(
      pipeline: Pipeline,
      dataSource: DataSource,
      steps: Vector[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] =
    engine.loadRowsWithStats(dataSource, dataSourceRepo).flatMap { case (sourceRows, primaryStats) =>
      engine
        .executeWithStepCounts(sourceRows, steps, dataSourceRepo, assertionSink, truncationSink)
        .map { case (rows, stepCounts) =>
          PipelineExecutionOutcome(rows, stepCounts, sourceRows.size.toLong, primaryStats)
        }
    }
}
