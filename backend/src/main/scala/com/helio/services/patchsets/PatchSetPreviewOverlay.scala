package com.helio.services.patchsets

import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import com.helio.services.panels.{CreatePlacement, PlacementSizes}
import spray.json.JsObject

/** One change an earlier edit made to a dashboard's stored layout, replayed in order over the dashboard as resolved
 *  (`PatchSetPreviewOverlay.dashboard`). Each op that changes the layout bumps `layoutVersion` by one, as V127's
 *  trigger does for the statement apply would run. */
private[patchsets] sealed trait LayoutOp
private[patchsets] object LayoutOp {
  /** V122: deleting panels removes their items from every breakpoint. */
  final case class Strip(panelIds: Set[String]) extends LayoutOp
  /** `PanelService.create`'s placement: one item appended per breakpoint below the existing items. */
  final case class Append(panelId: String, sizes: PlacementSizes) extends LayoutOp
}

/** The state a patch set's EARLIER edits leave behind, as apply would execute them in order (HEL-1498, design.md
 *  D4). Immutable: each edit's projection reads it (`panel`/`dashboard`/... overlay the resolved prior with what
 *  earlier edits changed) and returns an extended copy. It models only what later edits' `after`, impact and
 *  rejections can observe; `before` and fingerprints stay the resolve-time (pre-apply) state, exactly as apply's
 *  `priorState`, undo journal and stale check do.
 *
 *  `removed` holds (kind, id) pairs deleted by an earlier edit, directly or by cascade; a later edit that reads one
 *  fails the whole preview. Created panels are tracked under a per-edit placeholder id `(pending:<editIndex>)`, so
 *  two creates in one set stay distinct.
 *
 *  Residuals, not modelled: step-create re-parenting of existing children, the promoted head child of a step
 *  delete, and the data-source-delete cascade into root-attached steps/outputs/panels. */
private[patchsets] final case class PatchSetPreviewOverlay(
    panels: Map[String, Panel] = Map.empty,
    dashboards: Map[String, Dashboard] = Map.empty,
    dataSources: Map[String, DataSource] = Map.empty,
    pipelines: Map[String, PipelineSummary] = Map.empty,
    steps: Map[String, PipelineStep] = Map.empty,
    outputs: Map[String, (Output, JsObject)] = Map.empty,
    removed: Set[(String, String)] = Set.empty,
    layoutOps: Map[String, Vector[LayoutOp]] = Map.empty,
    createdPanels: Map[String, Set[String]] = Map.empty,
    removedPanels: Map[String, Set[String]] = Map.empty
) {
  import PatchSetPreviewOverlay._

  def isRemoved(kind: String, id: String): Boolean = removed((kind, id))

  def panel(prior: Panel): Panel                 = panels.getOrElse(prior.id.value, prior)
  def dataSource(prior: DataSource): DataSource  = dataSources.getOrElse(prior.id.value, prior)
  def pipeline(prior: PipelineSummary): PipelineSummary = pipelines.getOrElse(prior.id, prior)
  def step(prior: PipelineStep): PipelineStep    = steps.getOrElse(prior.id.value, prior)
  def output(prior: Output, priorConfig: JsObject): (Output, JsObject) = outputs.getOrElse(prior.id.value, (prior, priorConfig))

  /** The dashboard as the earlier edits leave it: the last stored projection, or the resolved row, with the
   *  layout ops of earlier panel creates/deletes replayed over it. */
  def dashboard(prior: Dashboard): Dashboard =
    layoutOps.getOrElse(prior.id.value, Vector.empty).foldLeft(dashboards.getOrElse(prior.id.value, prior))(applyOp)

  def withPanel(p: Panel): PatchSetPreviewOverlay                  = copy(panels = panels + (p.id.value -> p))
  def withDataSource(d: DataSource): PatchSetPreviewOverlay        = copy(dataSources = dataSources + (d.id.value -> d))
  def withPipeline(p: PipelineSummary): PatchSetPreviewOverlay     = copy(pipelines = pipelines + (p.id -> p))
  def withStep(s: PipelineStep): PatchSetPreviewOverlay            = copy(steps = steps + (s.id.value -> s))
  def withOutput(o: Output, config: JsObject): PatchSetPreviewOverlay = copy(outputs = outputs + (o.id.value -> ((o, config))))

  /** Stores an update's projected dashboard (replay of the pending layout ops is already folded into it). */
  def withDashboard(d: Dashboard): PatchSetPreviewOverlay =
    copy(dashboards = dashboards + (d.id.value -> d), layoutOps = layoutOps - d.id.value)

  def withRemoved(kind: String, ids: Iterable[String]): PatchSetPreviewOverlay =
    copy(removed = removed ++ ids.map(kind -> _))

  /** Records deleted panels: removed, counted against their dashboards, and stripped from those layouts. */
  def withPanelsRemoved(deleted: Iterable[Panel]): PatchSetPreviewOverlay =
    deleted.groupBy(_.dashboardId.value).foldLeft(withRemoved("panel", deleted.map(_.id.value))) {
      case (acc, (dashboardId, group)) =>
        val ids = group.map(_.id.value).toSet
        acc.copy(
          removedPanels = acc.removedPanels.updated(dashboardId, acc.removedPanels.getOrElse(dashboardId, Set.empty) ++ ids),
          layoutOps     = acc.layoutOps.updated(dashboardId, acc.layoutOps.getOrElse(dashboardId, Vector.empty) :+ LayoutOp.Strip(ids))
        )
    }

  /** Records a panel created on `dashboardId` under the placeholder id `pendingId`. */
  def withPanelCreated(dashboardId: String, pendingId: String, sizes: PlacementSizes): PatchSetPreviewOverlay =
    copy(
      createdPanels = createdPanels.updated(dashboardId, createdPanels.getOrElse(dashboardId, Set.empty) + pendingId),
      layoutOps     = layoutOps.updated(dashboardId, layoutOps.getOrElse(dashboardId, Vector.empty) :+ LayoutOp.Append(pendingId, sizes))
    )

  /** The panel ids live on `dashboardId` after the earlier edits, given the ids stored at resolve time. */
  def livePanelIds(dashboardId: String, stored: Set[PanelId]): Set[PanelId] =
    stored.filterNot(p => removedPanels.getOrElse(dashboardId, Set.empty)(p.value)) ++
      createdPanels.getOrElse(dashboardId, Set.empty).map(PanelId(_))

  /** A dashboard-delete's panel count, given the count stored at resolve time. */
  def panelCount(dashboardId: String, stored: Int): Int =
    stored - removedPanels.getOrElse(dashboardId, Set.empty).size + createdPanels.getOrElse(dashboardId, Set.empty).size
}

private[patchsets] object PatchSetPreviewOverlay {
  val empty: PatchSetPreviewOverlay = PatchSetPreviewOverlay()

  private def applyOp(d: Dashboard, op: LayoutOp): Dashboard = {
    val before = d.layout
    val after = op match {
      case LayoutOp.Strip(ids) =>
        def keep(items: Vector[DashboardLayoutItem]) = items.filterNot(i => ids(i.panelId.value))
        DashboardLayout(keep(before.lg), keep(before.md), keep(before.sm), keep(before.xs))
      case LayoutOp.Append(id, sizes) => CreatePlacement.append(before, Vector(PanelId(id) -> sizes))._1
    }
    if (after == before) d else d.copy(layout = after, layoutVersion = d.layoutVersion + 1)
  }
}
