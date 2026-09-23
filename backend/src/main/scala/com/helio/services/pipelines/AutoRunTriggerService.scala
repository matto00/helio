package com.helio.services.pipelines

import com.helio.domain.engine.PipelineCostEstimator
import com.helio.domain.model.{DataSourceId, PipelineId}
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.slf4j.LoggerFactory

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1093 (design.md Decision 2): the write-time half of the dataset-write auto-run trigger.
 *  Called fire-and-forget from `DataSourceService`'s five row-mutation methods
 *  (`appendRows`/`appendFormRow`/`replaceRows`/`patchRow`/`deleteRow`) on their successful-write
 *  branch, alongside each method's existing `audit(...)` call.
 *
 *  Never submits a run synchronously -- the entire effect of a dataset write on auto-run is an
 *  UPSERT into `pipeline_auto_run_debounce` (V110) for each eligible pipeline. Firing is owned
 *  entirely by `PipelineSchedulerService.tick`'s claim-and-fire pass (design.md Decision 3), which
 *  is what actually calls `PipelineRunService.submit`.
 *
 *  Every pipeline lookup here is privileged (`*Internal` methods, no `AuthenticatedUser` in this
 *  class's own signature) -- the writer has already proven ownership of `dataSourceId` itself at
 *  the `DataSourceService` call site above this class; the eligible downstream pipelines may be
 *  owned by a DIFFERENT user (design.md Context), and the auto-run itself is entirely
 *  pipeline-owner-attributed, never dependent on the writer's own access to the pipeline. */
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
   *  within the same write. */
  def triggerAutoRun(dataSourceId: DataSourceId, now: Instant): Future[Unit] =
    pipelineRootRepo.listPipelineIdsForDataSourceInternal(dataSourceId).flatMap { pipelineIds =>
      Future.traverse(pipelineIds)(pid => evaluateOne(pid, dataSourceId, now)).map(_ => ())
    }

  private def evaluateOne(pipelineId: PipelineId, dataSourceId: DataSourceId, now: Instant): Future[Unit] =
    evaluateAndSchedule(pipelineId, dataSourceId, now).recover { case ex =>
      log.error(s"AutoRunTriggerService: unexpected failure evaluating pipeline ${pipelineId.value} " +
        s"for data source ${dataSourceId.value}", ex)
      ()
    }

  private def evaluateAndSchedule(pipelineId: PipelineId, dataSourceId: DataSourceId, now: Instant): Future[Unit] =
    for {
      allSteps        <- pipelineStepRepo.listByPipelineInternal(pipelineId)
      enabledSteps     = allSteps.filter(_.enabled)
      lastRunRowCount <- pipelineRepo.findLastRunRowCountInternal(pipelineId)
      // HEL-1093 design.md Decision 2a (design-gate round 1 fix): PRIVILEGED resolveRoot
      // (`findByIdInternal`, NOT `findByIdOwned`) -- there is no `AuthenticatedUser` in this
      // class's own signature, and the writer's ACL is irrelevant to the pipeline's OTHER roots
      // (a co-root the writer doesn't own must still resolve, not silently deny the pipeline --
      // see PipelineCostInputGathering's own doc).
      costInput       <- costInputGathering.gather(pipelineId, enabledSteps, lastRunRowCount, resolveRoot = dataSourceRepo.findByIdInternal)
      verdict          = PipelineCostEstimator.estimate(costInput)
      _               <- if (verdict.autoRunnable)
                            debounceRepo.upsertDebounce(pipelineId, now.plusSeconds(debounceSeconds))
                          else {
                            // Denial reason is logged, never silently dropped (ticket AC #2) --
                            // HEL-1096 owns surfacing it in UI, not this ticket.
                            val reasonsText = verdict.reasons.map(r => s"${r.code}: ${r.detail}").mkString("; ")
                            log.info(
                              "AutoRunTriggerService: pipeline {} denied auto-run for data source {}: {}",
                              pipelineId.value, dataSourceId.value, reasonsText
                            )
                            Future.successful(())
                          }
    } yield ()
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
