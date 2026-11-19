package com.helio.services.dashboards

import com.helio.domain.model.{AuthenticatedUser, DashboardId, Output, Page, Pipeline}
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputHistoryRepository, OutputRepository, PipelineRepository, PipelineRunRepository}
import com.helio.services.pipelines.{AssertionStatusRule, ProvenanceService}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** One Output panel's status: when its pipeline last ran and how it ended, when the data the panel shows was stored, and
 *  whether the Output is data-invalid. No identifier of a pipeline, step, run or Output (HEL-1786). */
final case class PanelStatusItem(
    panelId: String,
    lastRunAt: Option[Instant],
    runStatus: Option[String],
    dataUpdatedAt: Option[Instant],
    invalid: Boolean
)

final case class DashboardPanelStatus(items: Vector[PanelStatusItem], sources: Vector[String])

/** `GET /api/dashboards/:id/panel-status` (HEL-1786): the dashboard-scoped source a dashboard-only grantee's client reads for
 *  the freshness line, the run-finish refresh trigger and the data-invalid badge, none of which it may read through the
 *  Output or pipeline routes (prod RLS `outputs_select`).
 *
 *  No ACL here: the route's `authorizeResourceWithSharing("dashboard", ...)` has admitted the caller before this runs, so every
 *  read below is an internal (system-context) read of the Outputs bound on THAT dashboard -- the same basis the per-panel
 *  routes (`PublicPanelOutputResolver`) read on. A panel on another dashboard never contributes.
 *
 *  Read budget per request, independent of row counts: 1 panel page, 1 Output batch, 1 pipeline batch, 1 history batch
 *  (LATERAL `LIMIT 1` per Output), per distinct pipeline with a step-bound Output 1 latest-real-run read plus at most 1
 *  assertions read, and the provenance source batch (steps and roots once per distinct pipeline, names in one lookup). No
 *  `count(*)` over `node_snapshots` and no snapshot row is read. `runRepo` may be null (fixtures): then `invalid` is false. */
final class DashboardPanelStatusService(
    panelRepo: PanelRepository,
    outputRepo: OutputRepository,
    pipelineRepo: PipelineRepository,
    runRepo: PipelineRunRepository,
    historyRepo: OutputHistoryRepository,
    provenanceOpt: Option[ProvenanceService]
)(implicit ec: ExecutionContext) {

  /** A pipeline's stored last-run status maps to exactly these two values; anything else (running, queued, dry_run) is null. */
  private val ReportedRunStatuses = Set("succeeded", "failed")

  private final case class Resolved(panelId: String, output: Output, pipeline: Pipeline)

  def status(dashboardId: String, user: AuthenticatedUser): Future[DashboardPanelStatus] =
    // One page at `Page.MaxLimit`, the panel list's own ceiling: a panel beyond the 500th in panel order is omitted from
    // `items` and contributes no source (the panel list itself would not return it either).
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), Some(user), Page(0, Page.MaxLimit), accessAlreadyGranted = true).flatMap { paged =>
      val bound = paged.items.collect { case op: OutputPanel => op.outputId.map(outputId => op.id.value -> outputId.value) }.flatten
      for {
        outputs   <- outputRepo.findByIdsInternal(bound.map(_._2).distinct)
        pipelines <- pipelineRepo.findByIdsInternal(outputs.map(_.node.pipelineId).distinct)
        resolved   = resolve(bound, outputs, pipelines)
        distinctOutputs = resolved.map(_.output).distinctBy(_.id.value)
        history   <- historyRepo.latestCapturedAtInternal(distinctOutputs.map(_.id.value))
        failures  <- failedErrorCounts(distinctOutputs)
        sources   <- sourceNames(resolved, distinctOutputs)
      } yield DashboardPanelStatus(
        items = resolved.map { r =>
          PanelStatusItem(
            panelId       = r.panelId,
            lastRunAt     = r.pipeline.lastRunAt,
            runStatus     = r.pipeline.lastRunStatus.filter(ReportedRunStatuses.contains),
            dataUpdatedAt = history.get(r.output.id.value),
            invalid       = failures.getOrElse(r.output.id.value, 0) > 0
          )
        },
        sources = sources
      )
    }

  /** The panels whose Output and pipeline both resolve, in panel order; every other panel is omitted. */
  private def resolve(bound: Vector[(String, String)], outputs: Vector[Output], pipelines: Map[String, Pipeline]): Vector[Resolved] = {
    val outputById = outputs.map(o => o.id.value -> o).toMap
    bound.flatMap { case (panelId, outputId) =>
      for {
        output   <- outputById.get(outputId)
        pipeline <- pipelines.get(output.node.pipelineId.value)
      } yield Resolved(panelId, output, pipeline)
    }
  }

  /** The error-severity failure count of each step-bound Output's own step, by Output id, through [[AssertionStatusRule]] (the
   *  rule `GET /api/outputs/:id/assertion-status` also uses). The latest real run's assertions are read once per pipeline. */
  private def failedErrorCounts(outputs: Vector[Output]): Future[Map[String, Int]] =
    if (runRepo == null) Future.successful(Map.empty)
    else {
      val stepBound = outputs.filter(_.node.stepId.isDefined)
      Future
        .traverse(stepBound.map(_.node.pipelineId).distinct)(pid => AssertionStatusRule.latestRealRunAssertions(runRepo, pid).map(pid.value -> _))
        .map { byPipeline =>
          val assertionsOf = byPipeline.toMap
          stepBound.map(o => o.id.value -> AssertionStatusRule.failedErrorCount(o, assertionsOf.getOrElse(o.node.pipelineId.value, Vector.empty))).toMap
        }
    }

  /** The distinct source names per-panel provenance would show for some panel of this dashboard, in first-seen panel order. */
  private def sourceNames(resolved: Vector[Resolved], outputs: Vector[Output]): Future[Vector[String]] =
    provenanceOpt match {
      case None => Future.successful(Vector.empty)
      case Some(provenance) =>
        provenance.sourcesFor(outputs).map { byOutput =>
          resolved.flatMap(r => byOutput.getOrElse(r.output.id.value, Vector.empty).map(_.name)).distinct
        }
    }
}
