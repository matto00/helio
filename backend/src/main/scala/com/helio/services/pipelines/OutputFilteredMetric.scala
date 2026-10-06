package com.helio.services.pipelines

import com.helio.domain.history.OutputSummaryReducer
import com.helio.domain.model.{Output, OutputKind}
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1326 design.md D2/D3 -- the metric value over the FULL filtered set of a metric Output,
 *  returned beside the first rows page so the panel headline does not aggregate only the loaded
 *  page. Shared by `OutputService.rows` and `PublicPanelRowsResolver.resolveRows`, always called
 *  AFTER their ACL steps and `OutputRowsQuery.resolveFilter`, so the aggregate and the page use
 *  the same resolved filter.
 *
 *  `None` (key absent on the wire) unless the Output is a metric, a filter resolved, and the page
 *  starts at offset 0 -- an unfiltered or later-page request issues no extra statement. `Some(JsNull)`
 *  is a metric whose config resolves to no field (present, null -- like the stored summary). */
object OutputFilteredMetric {

  def compute(
      output: Output,
      resolvedFilter: Option[NodeSnapshotRepository.FilterSpec],
      offset: Int,
      outputRepo: OutputRepository,
      nodeSnapshotRepo: NodeSnapshotRepository
  )(implicit ec: ExecutionContext): Future[Option[JsValue]] =
    if (output.kind != OutputKind.Metric || resolvedFilter.isEmpty || offset != 0) Future.successful(None)
    else
      outputRepo.findConfigsByIdsInternal(Vector(output.id.value)).flatMap { configs =>
        val config = configs.getOrElse(output.id.value, JsObject())
        OutputSummaryReducer.metricField(config) match {
          case None => Future.successful(Some(JsNull))
          case Some((field, _)) =>
            nodeSnapshotRepo
              .listFieldCells(output.node.pipelineId.value, output.node.stepId.map(_.value), output.node.rootId.map(_.value), field, resolvedFilter)
              .map(cells => Some(OutputSummaryReducer.metricOf(cells, config)))
        }
      }
}
