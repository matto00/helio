package com.helio.services.patchsets

import com.helio.domain.model._

import scala.concurrent.{ExecutionContext, Future}

/** What a DELETE edit removes, directly and by foreign-key cascade, recorded into the overlay so a later edit that
 *  reads any of it fails the preview (apply would fail it too) and a later dashboard edit sees the panels' layout
 *  items stripped (V122). Reads only; mirrors the cascades apply's deletes trigger:
 *  dashboard -> panels, output -> panels, pipeline -> steps, outputs -> panels, step (tail subtrees + itself,
 *  `PipelineStepRepository.deleteInternal`'s splice) -> outputs -> panels. The data-source-delete cascade into
 *  root-attached steps/outputs/panels is a documented residual (only the source is recorded). */
private[patchsets] object PatchSetPreviewRemovals {

  def record(edit: ResolvedEdit, ctx: PatchSetApplyContext, overlay: PatchSetPreviewOverlay)(
      implicit ec: ExecutionContext
  ): Future[PatchSetPreviewOverlay] =
    edit.action match {
      case ResolvedAction.PanelDelete(_, prior) =>
        Future.successful(overlay.withPanelsRemoved(Seq(prior)))
      case ResolvedAction.DashboardDelete(id, _) =>
        ctx.dashboardRepo.panelIdsInternal(id).map { ids =>
          overlay.withRemoved("dashboard", Seq(id.value)).withRemoved("panel", ids.map(_.value))
        }
      case ResolvedAction.OutputDelete(id, _) =>
        outputsRemoved(ctx, Seq(id), overlay)
      case ResolvedAction.DataSourceDelete(id, _) =>
        Future.successful(overlay.withRemoved("dataSource", Seq(id.value)))
      case ResolvedAction.PipelineDelete(id, _) =>
        for {
          outputs <- ctx.outputRepo.listByPipelineInternal(id)
          steps   <- ctx.pipelineStepRepo.listByPipelineInternal(id)
          next    <- outputsRemoved(ctx, outputs.map(_.id), overlay)
        } yield next.withRemoved("pipeline", Seq(id.value)).withRemoved("pipelineStep", steps.map(_.id.value))
      case ResolvedAction.PipelineStepDelete(id, prior) =>
        for {
          rows    <- ctx.pipelineStepRepo.listByPipelineInternal(prior.pipelineId)
          outputs <- ctx.outputRepo.listByPipelineInternal(prior.pipelineId)
          doomed   = removedStepIds(id, rows)
          gone     = outputs.filter(_.node.stepId.exists(s => doomed(s.value))).map(_.id)
          next    <- outputsRemoved(ctx, gone, overlay)
        } yield next.withRemoved("pipelineStep", doomed)
      case _ => Future.successful(overlay)
    }

  /** The deleted step and its tail subtrees (every child but the lowest-positioned, which `deleteInternal` promotes). */
  private def removedStepIds(id: PipelineStepId, rows: Vector[PipelineStep]): Set[String] = {
    val children      = rows.filter(_.parentStepId.contains(id)).sortBy(_.position).drop(1)
    val childrenOf    = rows.groupBy(_.parentStepId.map(_.value))
    def subtree(root: PipelineStep): Vector[String] = root.id.value +: childrenOf.getOrElse(Some(root.id.value), Vector.empty).flatMap(subtree)
    children.flatMap(subtree).toSet + id.value
  }

  private def outputsRemoved(ctx: PatchSetApplyContext, outputIds: Seq[OutputId], overlay: PatchSetPreviewOverlay)(
      implicit ec: ExecutionContext
  ): Future[PatchSetPreviewOverlay] =
    Future.traverse(outputIds)(o => ctx.panelRepo.findByOutputIdInternal(o.value)).map { bound =>
      overlay.withRemoved("output", outputIds.map(_.value)).withPanelsRemoved(bound.flatten)
    }
}
