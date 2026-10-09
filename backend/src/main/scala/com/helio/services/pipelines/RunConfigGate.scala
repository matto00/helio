package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.engine.{PipelineAnalyzeService, PipelineCostEstimator}
import com.helio.domain.model.PipelineStep

/** HEL-1384 (design.md D1): the ONE definition of "misconfigured for gating" -- used by the
 *  write-time auto-run trigger (HEL-1279) and by both fire-time checks in `PipelineSchedulerService`.
 *
 *  Reads only `(kind, raw config)` of ENABLED steps through analyze's own `stepConfigProblem`, never
 *  a schema, so analyze's schema-derived errors (HEL-1280's false-positive class) can never gate. */
object RunConfigGate {

  /** Fixed prefix of the `error_log` of a scheduled run recorded-but-not-attempted by the gate. */
  val ScheduledSkipPrefix: String = "Step configuration invalid; scheduled run not attempted: "

  /** One `step-config-invalid` reason per enabled step whose raw config is not runnable. */
  def stepConfigReasons(steps: Vector[PipelineStep]): Vector[PipelineCostEstimator.CostReason] =
    steps.filter(_.enabled).flatMap { s =>
      PipelineAnalyzeService.stepConfigProblem(s.kind, PipelineStepConfigCodec.encode(s)).map { msg =>
        PipelineCostEstimator.CostReason(PipelineAnalyzeService.StepConfigInvalidCode, msg, Some(s.id.value))
      }
    }

  /** The `error_log` text of a skipped scheduled run: the fixed prefix then each offending step. */
  def scheduledSkipReason(reasons: Vector[PipelineCostEstimator.CostReason]): String =
    ScheduledSkipPrefix + reasons.map(r => s"step ${r.stepId.getOrElse("?")}: ${r.detail}").mkString("; ")
}
