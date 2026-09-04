package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, DataSource, Pipeline, PipelineRootId, PipelineStep, PipelineStepId, TruncationSink}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-330 (design.md Decision 1); HEL-905 (design.md Decision 2) upgrades this from a flat fold
 *  to [[InProcessPipelineEngine.executeTree]] -- the tree walk, using `stepRepo`'s parent-keyed
 *  `childrenOf` to find each node's trunk continuation and tail roots. `pipeline` is accepted per
 *  the trait's signature but unused here -- the in-process engine's row-source loading dispatches
 *  entirely off each root's own `DataSource`.
 *
 *  HEL-913 (design.md R4/R9/R10, task 5.4): loads N root frames instead of one -- `roots` is
 *  ordered by `position` ascending (R3's tiebreak) by every caller (`PipelineRunService`'s
 *  `resolveAllRootDataSourcesInternal`), so `roots.head` is always the lowest-positioned root,
 *  matching R10's "primary stats come from the lowest-positioned root" rule and the parity
 *  requirement that a single-root pipeline's `primaryStats` is unchanged from before this
 *  ticket. R9: every root's source is loaded via `Future.sequence` -- a failure loading ANY
 *  root's source fails the whole run atomically, naming that root via the failed `Future`. */
final class InProcessExecutionBackend(engine: InProcessPipelineEngine, stepRepo: PipelineStepRepository) extends PipelineExecutionBackend {

  def execute(
      pipeline: Pipeline,
      roots: Vector[(String, DataSource)],
      steps: Vector[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      onNodeProgress: (NodeKey, Long) => Unit = (_, _) => ()
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
    require(roots.nonEmpty, "InProcessExecutionBackend.execute requires at least one root (design.md R1)")
    // With exactly one root (today's overwhelmingly common case, and every fixture that
    // constructs steps directly rather than via a persisted, DB-backed repository), every
    // parentless step trivially belongs to THAT root -- no `rootIdsOf` DB round-trip needed, and
    // no dependency on `stepRepo` actually being backed by a live connection (several existing
    // unit tests construct `PipelineStepRepository(null)` and steps directly). Only a genuine
    // multi-root pipeline needs the real per-step lookup.
    val rootIdOfStepF: Future[Map[PipelineStepId, PipelineRootId]] =
      if (roots.size == 1) {
        val onlyRootId = PipelineRootId(roots.head._1)
        Future.successful(steps.filter(_.parentStepId.isEmpty).map(_.id -> onlyRootId).toMap)
      } else stepRepo.rootIdsOf(pipeline.id)
    for {
      rootIdOfStep <- rootIdOfStepF
      loaded       <- Future.sequence(roots.map { case (rootId, dataSource) =>
                        engine.loadRowsWithStats(dataSource, dataSourceRepo).map { case (rows, stats) => (rootId, rows, stats) }
                      })
      rootFrames    = loaded.map { case (rootId, rows, _) => (rootId, rows) }
      // R10: primaryStats/sourceRowCount are reported from the LOWEST-positioned root (`roots`
      // is position-ordered by the caller) -- the same tiebreak `TreeWalkResult.rows` uses, so a
      // single-root pipeline's behavior is byte-identical to before this ticket.
      (_, primaryRows, primaryStats) = loaded.head
      result       <- engine.executeTree(rootFrames, steps, stepRepo, rootIdOfStep, dataSourceRepo, assertionSink, truncationSink, onNodeProgress)
    } yield PipelineExecutionOutcome(result.rows, result.stepCounts, primaryRows.size.toLong, primaryStats, result.nodeOutcomes)
  }
}
