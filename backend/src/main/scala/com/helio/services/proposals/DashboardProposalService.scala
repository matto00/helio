package com.helio.services.proposals

import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{LayoutBreakpointScaling, PanelService}
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{DashboardLayoutItemPayload, DashboardLayoutPayload, UpdateDashboardRequest}
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel}
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, Panel}
import com.helio.infrastructure.persistence.pipelines.OutputRepository

import scala.concurrent.{ExecutionContext, Future}

/** Applies a reviewed dashboard proposal (HEL-225).
 *
 *  Turns a `DashboardProposal` (name + panels, no ids) into a real dashboard by
 *  composing the EXISTING services — `DashboardService.create`,
 *  `PanelService.create`, `DashboardService.update` for layout. It holds no
 *  persistence logic of its own and never touches the DB directly, so every
 *  write runs under the caller's RLS context and the V41 pipeline-only binding
 *  rule is enforced by `PanelService` exactly as for any other panel create.
 *
 *  Atomicity: all panel bindings are validated up front, so a bad proposal
 *  creates nothing. If a later panel create still fails unexpectedly, the
 *  partially-created dashboard is deleted (cascade) before returning the error.
 *  This "create fresh, delete-the-whole-thing-on-failure" pattern is safe ONLY
 *  because `apply` always mints a brand-new dashboard — see `design.md` D1 in
 *  the HEL-363 change for why `DashboardContentsService`'s atomic
 *  replace-contents path (which mutates an EXISTING dashboard) cannot reuse
 *  this pattern and uses a real repository-layer transaction instead.
 *
 *  Panel validation/construction (`validatePanel`, `preValidateBindings`,
 *  `buildCreateRequest`) is shared with `DashboardContentsService` via
 *  [[ProposalPanelSupport]] (HEL-363) — see that object for the
 *  implementation.
 */
final class DashboardProposalService(
    dashboardService: DashboardService,
    panelService: PanelService,
    // HEL-904 task 3.8/3.9: validates an "output"-kind panel's binding
    // against a real Output. Nullable-optional for the many test call sites
    // that never construct an output-kind panel.
    outputRepo: OutputRepository = null
)(implicit ec: ExecutionContext) {

  import DashboardProposalService._

  /** Structural + binding validation only — no side effects, nothing created either way
   *  (HEL-392 design.md D1). Extracted out of `apply` (behavior-preserving: `apply` below calls
   *  this first, then proceeds exactly as before on `Right`) so `DashboardAuthoringService` can
   *  reject an NL-authored proposal via the EXACT SAME checks `apply` uses — one shared code path,
   *  not a divergent copy. */
  def validate(proposal: DashboardProposal, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    validateStructure(proposal) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_)  => ProposalPanelSupport.preValidateBindings(proposal.panels, user, outputRepo)
    }

  def apply(
      proposal: DashboardProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    validate(proposal, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => createAll(proposal, user)
    }

  /** Structural validation — no side effects; fails on the first bad panel so a
   *  malformed proposal creates nothing. */
  private def validateStructure(proposal: DashboardProposal): Either[String, Unit] =
    if (proposal.dashboardName.trim.isEmpty) Left("dashboardName is required")
    else
      proposal.panels.zipWithIndex.foldLeft[Either[String, Unit]](Right(())) {
        case (Left(e), _) => Left(e)
        case (Right(_), (panel, idx)) =>
          ProposalPanelSupport.validatePanel(s"panel ${idx + 1} ('${panel.title}')", panel)
      }

  private def createAll(
      proposal: DashboardProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    dashboardService.create(DashboardService.CreateDashboardInput(Some(proposal.dashboardName)), user).flatMap {
      case (dashboard, _) =>
        createPanels(dashboard.id, proposal.panels, user, Vector.empty).flatMap {
          case Left(err) =>
            // HEL-477 design.md Decision 10: `deleteInternal`, not the public
            // `delete` — this rollback is internal cleanup of a dashboard the
            // same call already failed to successfully create, not an
            // actor-initiated deletion; the public `delete` would otherwise
            // write a false `dashboard.delete` for a dashboard that, from
            // the caller's perspective, never existed.
            dashboardService.deleteInternal(dashboard.id, user).map(_ => Left(err))
          case Right(panels) =>
            // HEL-904: the chart-panel appearance follow-up (`applyAppearance`)
            // was removed here — `ChartPanel` no longer exists, so
            // `created.kind == ChartPanel.Kind` could never fire again.
            applyLayout(dashboard, proposal.panels, panels, user).map(Right(_))
        }
    }

  /** Create panels in proposal order, short-circuiting on the first failure.
   *  `buildCreateRequest` is shared with `DashboardContentsService` via
   *  [[ProposalPanelSupport]] (HEL-363). */
  private def createPanels(
      dashboardId: DashboardId,
      remaining: Vector[ProposalPanel],
      user: AuthenticatedUser,
      acc: Vector[Panel]
  ): Future[Either[ServiceError, Vector[Panel]]] =
    remaining.headOption match {
      case None => Future.successful(Right(acc))
      case Some(panel) =>
        panelService.create(ProposalPanelSupport.buildCreateRequest(dashboardId, panel), user).flatMap {
          case Left(err)    => Future.successful(Left(err))
          case Right((panel0, _)) => createPanels(dashboardId, remaining.tail, user, acc :+ panel0)
        }
    }

  /** Persist per-panel layout (all four breakpoints) for panels that specify
   *  one. Panels without a layout are omitted and the frontend auto-places
   *  them. Returns the updated dashboard (or the original if no layout given). */
  private def applyLayout(
      dashboard: Dashboard,
      proposalPanels: Vector[ProposalPanel],
      createdPanels: Vector[Panel],
      user: AuthenticatedUser
  ): Future[(Dashboard, Vector[Panel])] = {
    val items = proposalPanels.zip(createdPanels).flatMap { case (proposal, created) =>
      proposal.layout.map(l => DashboardLayoutItemPayload(created.id.value, l.x, l.y, l.w, l.h))
    }
    if (items.isEmpty) Future.successful((dashboard, createdPanels))
    else {
      val lgCols = LayoutBreakpointScaling.breakpointCols("lg")
      def scaled(targetCols: Int): Vector[DashboardLayoutItemPayload] =
        items.map { item =>
          val (x, w) = LayoutBreakpointScaling.scaleWidthAndX(item.x, item.w, lgCols, targetCols)
          item.copy(x = x, w = w)
        }
      val layout = DashboardLayoutPayload(
        lg = items,
        md = scaled(LayoutBreakpointScaling.breakpointCols("md")),
        sm = scaled(LayoutBreakpointScaling.breakpointCols("sm")),
        xs = scaled(LayoutBreakpointScaling.breakpointCols("xs"))
      )
      dashboardService
        .update(dashboard.id, UpdateDashboardRequest(None, None, Some(layout)), user)
        .map {
          case Right(updated) => (updated, createdPanels)
          case Left(_)        => (dashboard, createdPanels) // layout is best-effort; panels already exist
        }
    }
  }

}

object DashboardProposalService {
  // package-private (not `private`) so `ProposalPanelSupport` (HEL-363) can
  // reference this without redefining it — see scripts/check-schema-drift.mjs,
  // which parses `DataPanelKinds` directly out of THIS file by name; keep the
  // constant here rather than moving it to ProposalPanelSupport.
  //
  // HEL-904 task 3.10: retargeted from the old five-visualization-kind
  // enumeration to the ONE panel *kind* that requires an Output binding
  // (round-4 finding — this is a live validation predicate, not a passive
  // list; retargeting it to the wrong set would silently re-require
  // `dataTypeId` on every proposal panel or silently stop requiring it on
  // any). `MetricKind`/`TimelineKind`/`MetricIdSupportedKinds` (task 3.10a)
  // were deleted outright along with the code paths they guarded — metrics,
  // and the bound panel kinds that could carry a `metricId`, no longer exist.
  private[services] val DataPanelKinds: Set[String] = Set("output")
}
