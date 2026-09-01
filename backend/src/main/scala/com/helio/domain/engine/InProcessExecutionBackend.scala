package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, DataSource, Pipeline, PipelineStep, TruncationSink}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-330 (design.md Decision 1); HEL-905 (design.md Decision 2) upgrades this from a flat fold
 *  to [[InProcessPipelineEngine.executeTree]] -- the tree walk, using `stepRepo`'s parent-keyed
 *  `childrenOf` to find each node's trunk continuation and tail roots. `pipeline` is accepted per
 *  the trait's signature but unused here -- the in-process engine's row-source loading dispatches
 *  entirely off `dataSource`. */
final class InProcessExecutionBackend(engine: InProcessPipelineEngine, stepRepo: PipelineStepRepository) extends PipelineExecutionBackend {

  def execute(
      pipeline: Pipeline,
      dataSource: DataSource,
      steps: Vector[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      onNodeProgress: (Option[String], Long) => Unit = (_, _) => ()
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] =
    engine.loadRowsWithStats(dataSource, dataSourceRepo).flatMap { case (sourceRows, primaryStats) =>
      engine
        .executeTree(sourceRows, steps, stepRepo, dataSourceRepo, assertionSink, truncationSink, onNodeProgress)
        .map { result =>
          PipelineExecutionOutcome(result.rows, result.stepCounts, sourceRows.size.toLong, primaryStats, result.nodeOutcomes)
        }
    }
}
