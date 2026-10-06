package com.helio.services.proposals

import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{ItemSize, OutputControlsValidator, PanelService}
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{DashboardLayoutItemPayload, DashboardLayoutPatchPayload, UpdateDashboardRequest}
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel}
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DashboardLayoutItem, Panel}
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository

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
    // against a real Output. HEL-1295: required, never null (enforced by the `require` below).
    outputRepo: OutputRepository,
    // HEL-1193: the same validator PanelService uses for a panel's controls, run at propose time
    // too; nullable-optional like the other collaborators (null skips the control check).
    controlsValidator: OutputControlsValidator = null,
    // HEL-1148: validates a source-bound (`form`) panel's `dataSourceId` through the shared
    // `FormBindingValidator`; nullable-optional like the other collaborators (null skips the
    // ownership/dataset/schema check — the structural "a form requires a dataSourceId" rule in
    // `ProposalPanelSupport.validatePanel` never depends on it).
    dataSourceRepo: DataSourceRepository = null
)(implicit ec: ExecutionContext) {

  require(outputRepo != null, "DashboardProposalService requires an OutputRepository")

  import DashboardProposalService._

  /** Structural + binding validation only — no side effects, nothing created either way
   *  (HEL-392 design.md D1). Extracted out of `apply` (behavior-preserving: `apply` below calls
   *  this first, then proceeds exactly as before on `Right`) so `DashboardAuthoringService` can
   *  reject an NL-authored proposal via the EXACT SAME checks `apply` uses — one shared code path,
   *  not a divergent copy. */
  def validate(proposal: DashboardProposal, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    validateStructure(proposal) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_)  => validateBindingsAndControls(proposal.panels, user)
    }

  /** Shared by `validate` and the combined-proposal path: bindings first (a missing Output is the
   *  clearer error), then the same control validator `PanelService` runs on write. */
  private[services] def validateBindingsAndControls(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    ProposalPanelSupport.preValidateBindings(panels, user, outputRepo, dataSourceRepo).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => ProposalPanelSupport.preValidateControls(panels, user, controlsValidator)
    }

  /** Combined proposals: panels already bound to a real Output id get the same control check at
   *  propose time; sentinel-bound panels only exist after the pipeline is applied, so they are
   *  validated at apply by `PanelService.create` (combined rolls the pipeline back on failure). */
  private[services] def validateControlsExcludingSentinel(
      panels: Vector[ProposalPanel],
      sentinel: String,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    ProposalPanelSupport.preValidateControls(panels, user, controlsValidator, Some(sentinel))

  /** HEL-1148: only the source-bound (`form`) panels' `dataSourceId` check (existence, ownership,
   *  dataset kind, schema consistency), read-only. The combined-proposal path runs it BEFORE the
   *  pipeline phase writes anything, since a form's source does not depend on the pipeline's
   *  not-yet-created Output. */
  private[services] def validateSourceBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    ProposalPanelSupport.preValidateSourceBindings(panels, user, dataSourceRepo)

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
      }.flatMap(_ => ProposalLayoutSupport.validate(proposal.panels))

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
          case Right(created) =>
            // HEL-904: the chart-panel appearance follow-up (`applyAppearance`)
            // was removed here — `ChartPanel` no longer exists, so
            // `created.kind == ChartPanel.Kind` could never fire again.
            applyLayout(dashboard, proposal.panels, created, user).flatMap {
              case Left(err) => dashboardService.deleteInternal(dashboard.id, user).map(_ => Left(err))
              case right     => Future.successful(right)
            }
        }
    }

  /** Create panels in proposal order, short-circuiting on the first failure. Each is paired with the lg
   *  size it was created at, which a panel with no authored placement keeps in [[applyLayout]].
   *  `buildCreateRequest` is shared with `DashboardContentsService` via
   *  [[ProposalPanelSupport]] (HEL-363). */
  private def createPanels(
      dashboardId: DashboardId,
      remaining: Vector[ProposalPanel],
      user: AuthenticatedUser,
      acc: Vector[(Panel, ItemSize)]
  ): Future[Either[ServiceError, Vector[(Panel, ItemSize)]]] =
    remaining.headOption match {
      case None => Future.successful(Right(acc))
      case Some(panel) =>
        panelService.create(ProposalPanelSupport.buildCreateRequest(dashboardId, panel), user).flatMap {
          case Left(err)    => Future.successful(Left(err))
          case Right((panel0, placed)) =>
            createPanels(dashboardId, remaining.tail, user, acc :+ (panel0 -> ItemSize(placed.lg.w, placed.lg.h)))
        }
    }

  /** Persist the layout of every created panel (all four breakpoints): the authored `lg` items were
   *  validated before anything was created, a panel with no authored placement is appended below them
   *  at the size it was created at, md/sm/xs are reflowed (valid by construction),
   *  and the write still goes through `DashboardService.update`'s validation. A failure is surfaced
   *  (HEL-1071: it used to be swallowed as "best-effort") and the caller rolls the dashboard back. */
  private def applyLayout(
      dashboard: Dashboard,
      proposalPanels: Vector[ProposalPanel],
      created: Vector[(Panel, ItemSize)],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] = {
    val createdPanels = created.map(_._1)
    val layout        = ProposalLayoutSupport.buildLayout(proposalPanels, createdPanels.map(_.id), created.map(_._2))
    if (layout.lg.isEmpty) Future.successful(Right((dashboard, createdPanels)))
    else {
      def payloads(items: Vector[DashboardLayoutItem]) = Some(items.map(i => DashboardLayoutItemPayload(i.panelId.value, i.x, i.y, i.w, i.h)))
      val patch = DashboardLayoutPatchPayload(payloads(layout.lg), payloads(layout.md), payloads(layout.sm), payloads(layout.xs))
      dashboardService
        .update(dashboard.id, UpdateDashboardRequest(None, None, Some(patch)), user)
        .map(_.map(updated => (updated, createdPanels)))
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
  // `outputId` (formerly `dataTypeId`) on every proposal panel or silently stop requiring it on
  // any). `MetricKind`/`TimelineKind`/`MetricIdSupportedKinds` (task 3.10a)
  // were deleted outright along with the code paths they guarded — metrics,
  // and the bound panel kinds that could carry a `metricId`, no longer exist.
  private[services] val DataPanelKinds: Set[String] = Set("output")

  // HEL-1148: the panel kinds that bind to a dataset SOURCE (flat `dataSourceId`) rather than an
  // Output, declared beside `DataPanelKinds` so the two binding tables live in one place;
  // scripts/check-schema-drift.mjs parses this by name (and fails loudly if it cannot) to assert
  // every agent-facing kind's required binding field is expressible on the proposal wire.
  private[services] val SourceBoundKinds: Set[String] = Set("form")
}
