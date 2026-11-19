package com.helio.services.pipelines

import com.helio.domain.model.{Output, PipelineId, PipelineRunId}
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository.PipelineRunAssertionRow

import scala.concurrent.{ExecutionContext, Future}

/** The one rule for "data-invalid" (HEL-906 task 2.5, shared by HEL-1786): an Output is invalid iff its OWN node
 *  (`node.stepId`; a root-bound Output has no `assert` step and is never invalid) has at least one error-severity failed
 *  assertion on the pipeline's most recent NON-DRY run.
 *
 *  The `status != "dry_run"` filter is load-bearing: a preview (dry) run writes a real `pipeline_runs` row, with its own
 *  assertions, into the same table, and must never be reported as the pipeline's real last-run outcome. Both
 *  `GET /api/outputs/:id/assertion-status` and `GET /api/dashboards/:id/panel-status` call this object, so the rule lives
 *  in exactly one place. No ACL here: callers have authorized the Output or the dashboard it is bound on. */
object AssertionStatusRule {

  /** The assertions of the pipeline's latest non-dry run; empty when it has no real run. One run read plus at most one
   *  assertions read, however many Outputs the caller then evaluates against them. */
  def latestRealRunAssertions(runRepo: PipelineRunRepository, pipelineId: PipelineId)(implicit
      ec: ExecutionContext
  ): Future[Vector[PipelineRunAssertionRow]] =
    runRepo.latestNonDryRunInternal(pipelineId).flatMap {
      case None      => Future.successful(Vector.empty)
      case Some(run) => runRepo.listAssertionsByRunInternal(PipelineRunId(run.id))
    }

  /** How many error-severity assertions on `output`'s own step failed in `assertions`; 0 for a root-bound Output. */
  def failedErrorCount(output: Output, assertions: Seq[PipelineRunAssertionRow]): Int =
    output.node.stepId.fold(0)(stepId => assertions.count(a => a.stepId == stepId.value && a.severity == "error" && !a.passed))
}
