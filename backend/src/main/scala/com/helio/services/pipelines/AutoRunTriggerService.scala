package com.helio.services.pipelines

import com.helio.domain.engine.PipelineCostEstimator
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, Pipeline, PipelineId}
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.slf4j.LoggerFactory

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1093 (design.md Decision 2): the write-time half of the dataset-write auto-run trigger.
 *  Called from `DataSourceService`'s five row-mutation methods (`appendRows`/`appendFormRow`/
 *  `replaceRows`/`patchRow`/`deleteRow`) on their successful-write branch, alongside each method's
 *  existing `audit(...)` call. HEL-1096 (design.md D1): AWAITED (no longer fire-and-forget) by
 *  FOUR of those five -- `appendRows`/`appendFormRow`/`replaceRows`/`patchRow` -- so their denied
 *  entries can be folded into the write response; `deleteRow` keeps the original fire-and-forget
 *  call unchanged (owner ruling, see design.md Non-Goals -- its `204`/no-body contract must not
 *  change).
 *
 *  Never submits a run synchronously -- the entire effect of a dataset write on auto-run is an
 *  UPSERT into `pipeline_auto_run_debounce` (V110) for each eligible pipeline. Firing is owned
 *  entirely by `PipelineSchedulerService.tick`'s claim-and-fire pass (design.md Decision 3), which
 *  is what actually calls `PipelineRunService.submit`.
 *
 *  Every pipeline lookup here is privileged (`*Internal` methods) -- the writer has already proven
 *  ownership of `dataSourceId` itself at the `DataSourceService` call site above this class; the
 *  eligible downstream pipelines may be owned by a DIFFERENT user (design.md Context), and the
 *  auto-run itself is entirely pipeline-owner-attributed, never dependent on the writer's own
 *  access to the pipeline. `triggerAutoRun`'s `user` parameter (HEL-1096) is used ONLY to compute
 *  the RESPONSE-facing `visible`/`canRun` gates on a denied entry -- evaluation and debounce
 *  scheduling for the ALLOWED branch remain entirely unaffected by it. */
final class AutoRunTriggerService(
    pipelineRootRepo: PipelineRootRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    debounceRepo: PipelineAutoRunDebounceRepository,
    debounceSeconds: Long = AutoRunTriggerService.debounceSecondsFromEnv()
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val costInputGathering = new PipelineCostInputGathering(pipelineRepo, dataSourceRepo)

  /** Evaluates every pipeline whose root reads `dataSourceId` and schedules a debounced auto-run
   *  for each one whose `PipelineCostEstimator` verdict is `autoRunnable`. One pipeline's failure
   *  (a DB error, an unexpected exception) is logged and does not block its siblings -- mirrors
   *  `PipelineSchedulerService.processCandidate`'s own per-item isolation. The caller
   *  (`DataSourceService`) wraps this whole call in its own `.recover` (a debounce-scheduling
   *  failure must never fail the write itself), so this method's own per-pipeline isolation is a
   *  second, narrower layer: one pipeline's evaluation failing doesn't even cost its siblings
   *  within the same write.
   *
   *  HEL-1096 (design.md D1): `user` is the WRITER, threaded through only to compute each denied
   *  pipeline's `visible`/`canRun` gates for the RESPONSE -- it plays no role in evaluation
   *  itself, which remains fully privileged (every downstream pipeline is evaluated regardless of
   *  the writer's own relationship to it). The returned vector omits an entry entirely for a
   *  denied pipeline the writer has no grant on at all (`evaluateAndSchedule`'s own doc) -- this
   *  is where the cross-tenant-disclosure gate lives, not at any downstream caller. */
  def triggerAutoRun(dataSourceId: DataSourceId, user: AuthenticatedUser, now: Instant): Future[Vector[EvaluatedPipeline]] =
    pipelineRootRepo.listPipelineIdsForDataSourceInternal(dataSourceId).flatMap { pipelineIds =>
      Future.traverse(pipelineIds)(pid => evaluateOne(pid, dataSourceId, user, now)).map(_.flatten)
    }

  private def evaluateOne(pipelineId: PipelineId, dataSourceId: DataSourceId, user: AuthenticatedUser, now: Instant): Future[Option[EvaluatedPipeline]] =
    evaluateAndSchedule(pipelineId, dataSourceId, user, now).recover { case ex =>
      log.error(s"AutoRunTriggerService: unexpected failure evaluating pipeline ${pipelineId.value} " +
        s"for data source ${dataSourceId.value}", ex)
      None
    }

  private def evaluateAndSchedule(pipelineId: PipelineId, dataSourceId: DataSourceId, user: AuthenticatedUser, now: Instant): Future[Option[EvaluatedPipeline]] =
    for {
      pipelineOpt      <- pipelineRepo.findByIdInternal(pipelineId)
      allSteps        <- pipelineStepRepo.listByPipelineInternal(pipelineId)
      enabledSteps     = allSteps.filter(_.enabled)
      lastRunRowCount <- pipelineRepo.findLastRunRowCountInternal(pipelineId)
      // HEL-1093 design.md Decision 2a (design-gate round 1 fix): PRIVILEGED resolveRoot
      // (`findByIdInternal`, NOT `findByIdOwned`) -- the writer's ACL is irrelevant to the
      // pipeline's OTHER roots (a co-root the writer doesn't own must still resolve, not
      // silently deny the pipeline -- see PipelineCostInputGathering's own doc). Unrelated to
      // the `user`-gated visibility/canRun computation below, which only ever affects what is
      // RETURNED, never what is EVALUATED.
      costInput       <- costInputGathering.gather(pipelineId, enabledSteps, lastRunRowCount, resolveRoot = dataSourceRepo.findByIdInternal)
      verdict          = PipelineCostEstimator.estimate(costInput)
      result          <- if (verdict.autoRunnable)
                            debounceRepo.upsertDebounce(pipelineId, now.plusSeconds(debounceSeconds))
                              .map(_ => Some(EvaluatedPipeline.Allowed(pipelineId)))
                          else
                            handleDenied(pipelineId, dataSourceId, user, pipelineOpt, verdict)
    } yield result

  /** Denial reason is logged, never silently dropped (ticket AC #2), for EVERY denied pipeline --
   *  regardless of the writer's visibility into it (no regression from pre-HEL-1096 behavior).
   *  What varies by visibility is only what's RETURNED: design.md D1's two ACL checks, both
   *  computed against the WRITER (never the pipeline owner):
   *   - `visible` (owner OR any grant at all) gates whether an entry is returned AT ALL -- a
   *     writer with zero relationship to the pipeline learns nothing (`None`), matching that no
   *     existing API lets a data-source writer discover who reads their data today.
   *   - `canRun` (owner OR editor grant, mirroring `PipelineRunService.submit`'s own check) gates
   *     the run ACTION only, and is only meaningful on an entry that already passed `visible`. */
  private def handleDenied(
      pipelineId: PipelineId,
      dataSourceId: DataSourceId,
      user: AuthenticatedUser,
      pipelineOpt: Option[Pipeline],
      verdict: PipelineCostEstimator.CostVerdict
  ): Future[Option[EvaluatedPipeline]] = {
    val reasonsText = verdict.reasons.map(r => s"${r.code}: ${r.detail}").mkString("; ")
    log.info(
      "AutoRunTriggerService: pipeline {} denied auto-run for data source {}: {}",
      pipelineId.value, dataSourceId.value, reasonsText
    )
    pipelineOpt match {
      // The pipeline vanished between listing its id and evaluating it (deleted mid-flight) --
      // nothing to report, nothing to leak.
      case None => Future.successful(None)
      case Some(pipeline) if pipeline.ownerId.value == user.id.value =>
        Future.successful(Some(EvaluatedPipeline.Denied(pipelineId, pipeline.name, verdict.reasons, canRun = true)))
      case Some(pipeline) =>
        pipelineRepo.findGrantRole(pipelineId, user).map {
          case Some("editor") => Some(EvaluatedPipeline.Denied(pipelineId, pipeline.name, verdict.reasons, canRun = true))
          case Some(_)        => Some(EvaluatedPipeline.Denied(pipelineId, pipeline.name, verdict.reasons, canRun = false))
          case None           => None // no grant at all -- invisible to this writer, dropped (design.md D1)
        }
    }
  }
}

/** HEL-1096 (design.md D1): the per-pipeline result of one `triggerAutoRun` evaluation.
 *  `Allowed` carries no data beyond identity (the debounce upsert is `triggerAutoRun`'s whole
 *  effect for it); `Denied` carries everything a caller needs to fold into a write response --
 *  already filtered to pipelines the writer has at least a viewer grant on (see `handleDenied`). */
sealed trait EvaluatedPipeline
object EvaluatedPipeline {
  final case class Allowed(pipelineId: PipelineId) extends EvaluatedPipeline
  final case class Denied(
      pipelineId: PipelineId,
      name: String,
      reasons: Vector[PipelineCostEstimator.CostReason],
      canRun: Boolean
  ) extends EvaluatedPipeline
}

object AutoRunTriggerService {
  val DefaultDebounceSeconds: Long = 5L

  /** Reads `DATASET_WRITE_DEBOUNCE_SECONDS` (falls back to the documented default when unset or
   *  non-numeric) -- mirrors `PipelineRunGuardConfig.fromEnv`'s convention. The default (5s) is
   *  comfortably above the ticket AC's 2-second burst window so timing jitter in a real
   *  multi-instance test never straddles two windows (design.md Decision 2). */
  def debounceSecondsFromEnv(): Long =
    sys.env.get("DATASET_WRITE_DEBOUNCE_SECONDS").flatMap(_.toLongOption).getOrElse(DefaultDebounceSeconds)
}
