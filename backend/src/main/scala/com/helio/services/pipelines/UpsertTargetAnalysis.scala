package com.helio.services.pipelines

import com.helio.domain.engine.PipelineAnalyzeService.AnalyzedStep
import com.helio.domain.model.AuthenticatedUser
import com.helio.domain.steps.{UpsertSourceConfig, UpsertSourceStep, UpsertTarget, UpsertTargetCheck}
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** HEL-1265: analyze's view of `upsertsource` existing-source targets. `PipelineAnalyzeService`
 *  is pure (no repository access) and never looks at a target, so the service pre-resolves every
 *  upsert step's target as the pipeline owner and overlays the problem onto that step's
 *  `validationError` afterwards. Resolution uses the same [[UpsertTargetCheck]] as step save and
 *  execution, so analyze cannot report a target as fine that either of them refuses. */
private[pipelines] object UpsertTargetAnalysis {

  /** `(stepId, op, rawConfig)` for every step considered; returns `stepId -> problem` for each
   *  `upsertsource` step whose existing-source target is unknown, foreign or not a dataset. */
  def problems(steps: Seq[(String, String, String)], owner: AuthenticatedUser, repo: DataSourceRepository)(implicit
      ec: ExecutionContext
  ): Future[Map[String, String]] = {
    val targets = steps.collect {
      case (stepId, op, raw) if op == UpsertSourceStep.Kind =>
        Try(UpsertSourceConfig.decode(raw)).toOption.map(_.target).collect {
          case UpsertTarget.ExistingSource(id) if id.trim.nonEmpty => stepId -> id
        }
    }.flatten
    Future.traverse(targets) { case (stepId, targetId) =>
      UpsertTargetCheck.checkExisting(targetId, owner, repo).map {
        case UpsertTargetCheck.Writable         => None
        case UpsertTargetCheck.NotFound(msg)    => Some(stepId -> msg)
        case UpsertTargetCheck.NotWritable(msg) => Some(stepId -> msg)
      }
    }.map(_.flatten.toMap)
  }

  /** Keeps a step's own, earlier `validationError` when it already has one. */
  def overlay(projections: Map[String, AnalyzedStep], problems: Map[String, String]): Map[String, AnalyzedStep] =
    if (problems.isEmpty) projections
    else projections.map { case (id, step) =>
      id -> (if (step.validationError.isEmpty) step.copy(validationError = problems.get(id)) else step)
    }
}
