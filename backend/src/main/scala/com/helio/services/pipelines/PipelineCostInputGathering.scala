package com.helio.services.pipelines

import com.helio.domain.engine.PipelineCostEstimator
import com.helio.domain.model.{CsvSource, DataSource, DataSourceId, DataSourceKind, ImageSource, PdfSource, PipelineId, PipelineStep, TextSource}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1093 (design.md Decision 2a — design-gate round 1 fix): the ACL-*insensitive* half of
 *  `PipelineService.analyze`'s `CostInput` gathering (root-list resolution, per-root
 *  dataset-row-count lookup, `CostInput` assembly), factored out so `AutoRunTriggerService` can
 *  reuse it WITHOUT also reusing `analyze`'s ACL-*sensitive* root resolution
 *  (`dataSourceRepo.findByIdOwned`, scoped to the REQUESTING user). That resolution is safe in
 *  `analyze` only because its caller has already passed a pipeline-level ACL check — the auto-run
 *  trigger's caller is the dataset WRITER, who is only guaranteed to own the one `DataSourceId`
 *  they wrote to, not necessarily every other root on a multi-root pipeline reading it. Reusing
 *  `findByIdOwned` against the writer would resolve every co-root the writer doesn't own to
 *  `None` -> `unclassified-source` -> wrongly deny an otherwise-eligible pipeline on every write
 *  (`skeptic-design-1.md`, round 1 REFUTE).
 *
 *  The fix: root-to-`DataSource` resolution is supplied by the CALLER as `resolveRoot`, exactly
 *  like `PipelineRunService.resolveAllRootDataSourcesInternal` already does for the run-execution
 *  path (same file family, `dataSourceRepo.findByIdInternal`, privileged) —
 *  `PipelineService.analyze` passes `dsId => dataSourceRepo.findByIdOwned(dsId, user)` (unchanged
 *  behavior), `AutoRunTriggerService` passes `dsId => dataSourceRepo.findByIdInternal(dsId)`
 *  (privileged, matching `resolveAllRootDataSourcesInternal`'s own precedent for "the caller's ACL
 *  is irrelevant; the pipeline's own definition is what's being resolved"). */
final class PipelineCostInputGathering(
    pipelineRepo: PipelineRepository,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  def gather(
      pipelineId: PipelineId,
      enabledSteps: Vector[PipelineStep],
      lastRunRowCount: Option[Long],
      resolveRoot: DataSourceId => Future[Option[DataSource]]
  ): Future[PipelineCostEstimator.CostInput] =
    pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { rootDataSourceIds =>
      Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
        resolveRoot(dsId).map(dsOpt => (rootId.value, dsOpt))
      }.flatMap { rootDsOpts =>
        val datasetRootIds = rootDsOpts.collect { case (_, Some(ds)) if ds.kind == DataSourceKind.Dataset => ds.id }
        dataSourceRepo.countDatasetRows(datasetRootIds).map { datasetRowCounts =>
          val costRoots = rootDsOpts.map { case (rid, dsOpt) =>
            PipelineCostEstimator.RootCost(
              rootId          = rid,
              kind            = dsOpt.map(_.kind),
              hasSourceUrl    = dsOpt.exists(PipelineCostInputGathering.hasSourceUrl),
              datasetRowCount = dsOpt.filter(_.kind == DataSourceKind.Dataset).flatMap(ds => datasetRowCounts.get(ds.id))
            )
          }
          val costSteps = enabledSteps.map(s => PipelineCostEstimator.StepInput(s.id.value, s.kind))
          PipelineCostEstimator.CostInput(costSteps, costRoots, lastRunRowCount)
        }
      }
    }
}

object PipelineCostInputGathering {

  /** HEL-1092: `hasSourceUrl` is per-kind since `sourceUrl` lives on each source's typed config,
   *  not a common `DataSource` accessor -- rest_api/sql have no such field and always classify
   *  `remote-fetch` unconditionally (design.md D3 of HEL-1092). Moved here from
   *  `PipelineService` (HEL-1093 design.md Decision 2a) so both `analyze` and the auto-run
   *  trigger path use the same implementation. */
  def hasSourceUrl(source: DataSource): Boolean = source match {
    case s: CsvSource   => s.config.sourceUrl.isDefined
    case s: TextSource  => s.config.sourceUrl.isDefined
    case s: PdfSource   => s.config.sourceUrl.isDefined
    case s: ImageSource => s.config.sourceUrl.isDefined
    case _              => false
  }
}
