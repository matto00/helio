package com.helio.services.proposals

import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{DashboardLayoutItemPayload, DashboardLayoutPayload, UpdateDashboardRequest}
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel}
import com.helio.api.protocols.panels.UpdatePanelRequest
import com.helio.api.protocols.panels.PanelProtocol
import com.helio.domain.model.{AuthenticatedUser, ChartAppearance, Dashboard, DashboardId, Panel}
import com.helio.domain.panels.ChartPanel
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import spray.json.JsObject

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
    dataTypeRepo: DataTypeRepository,
    // HEL-549: mirrors PanelService's nullable-optional wiring convention
    // (design.md D5) — only touched when a panel actually carries a
    // metricId, so a test fixture that never sets one never exercises it.
    metricRepo: MetricRepository
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
      case Right(_)  => ProposalPanelSupport.preValidateBindings(proposal.panels, user, dataTypeRepo, metricRepo)
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
            applyAppearance(proposal.panels, panels, user).flatMap { panelsWithAppearance =>
              applyLayout(dashboard, proposal.panels, panelsWithAppearance, user).map(Right(_))
            }
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
          case Right(panel0) => createPanels(dashboardId, remaining.tail, user, acc :+ panel0)
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
      val layout = DashboardLayoutPayload(lg = items, md = items, sm = items, xs = items)
      dashboardService
        .update(dashboard.id, UpdateDashboardRequest(None, None, Some(layout)), user)
        .map {
          case Right(updated) => (updated, createdPanels)
          case Left(_)        => (dashboard, createdPanels) // layout is best-effort; panels already exist
        }
    }
  }

  /** True when the proposal panel carries at least one chart-appearance
   *  field — the trigger for the best-effort follow-up below. */
  private def hasChartAppearanceFields(panel: ProposalPanel): Boolean =
    panel.chartType.isDefined || panel.xAxisLabel.isDefined ||
    panel.yAxisLabel.isDefined || panel.seriesColors.isDefined

  /** Overrides [[ChartAppearance.Default]] field-by-field with whatever the
   *  proposal specifies. Only called after `validateStructure` has already
   *  confirmed `chartType` (if set) is valid (Decision 6), so this performs
   *  no validation of its own. */
  private def buildChartAppearance(panel: ProposalPanel): ChartAppearance = {
    val default = ChartAppearance.Default
    default.copy(
      chartType    = panel.chartType.orElse(default.chartType),
      seriesColors = panel.seriesColors.getOrElse(default.seriesColors),
      axisLabels = default.axisLabels.copy(
        x = default.axisLabels.x.copy(label = panel.xAxisLabel.orElse(default.axisLabels.x.label)),
        y = default.axisLabels.y.copy(label = panel.yAxisLabel.orElse(default.axisLabels.y.label))
      )
    )
  }

  /** Best-effort follow-up (Decision 2): for each created chart panel whose
   *  proposal specifies at least one chart-appearance field, PATCH the
   *  panel's appearance via the existing `PanelService.update`. Mirrors
   *  `applyLayout`'s swallow-on-failure contract — the panel already exists,
   *  so a failure here just leaves it with the default appearance rather than
   *  rejecting the whole proposal. Performs NO validation: by the time this
   *  runs, `chartType` has already been checked in `validateStructure`. */
  private def applyAppearance(
      proposalPanels: Vector[ProposalPanel],
      createdPanels: Vector[Panel],
      user: AuthenticatedUser
  ): Future[Vector[Panel]] =
    proposalPanels.zip(createdPanels).foldLeft(Future.successful(Vector.empty[Panel])) {
      case (accF, (proposal, created)) =>
        accF.flatMap { acc =>
          if (created.kind == ChartPanel.Kind && hasChartAppearanceFields(proposal)) {
            val appearance = buildChartAppearance(proposal)
            // HEL-362: `appearance` is now a raw JsValue merge patch (mirroring
            // `config`); background/color/transparency are omitted (absent =
            // preserve, harmless here since the panel was just created with
            // `PanelAppearance.Default`) and only `chart` is set, wholesale.
            val request = UpdatePanelRequest(
              title      = None,
              appearance = Some(JsObject("chart" -> DashboardProposalServiceJson.chartAppearanceFormat.write(appearance))),
              `type`     = None,
              config     = None
            )
            panelService.update(created.id, request, user).map {
              case Right(updated) => acc :+ updated
              case Left(_)        => acc :+ created // appearance is cosmetic; panel already exists
            }
          } else Future.successful(acc :+ created)
        }
    }
}

object DashboardProposalService {
  // package-private (not `private`) so `ProposalPanelSupport` (HEL-363) can
  // reference these without redefining them — see scripts/check-schema-drift.mjs,
  // which parses `DataPanelKinds` directly out of THIS file by name; keep the
  // constant here rather than moving it to ProposalPanelSupport.
  private[services] val DataPanelKinds: Set[String] = Set("metric", "chart", "table", "collection", "timeline")
  private[services] val MetricKind: String          = "metric"
  private[services] val TimelineKind: String        = "timeline"
  // HEL-549: the exact panel-type set HEL-500 added `metricId` support to on
  // MetricPanelConfig/ChartPanelConfig/TablePanelConfig — collection/timeline
  // never got a metricId slot, so a proposal panel of those types carrying a
  // metricId is rejected by `preValidateBindings` rather than silently
  // dropped (design.md D4).
  private[services] val MetricIdSupportedKinds: Set[String] = Set("metric", "chart", "table")
}

/** Spray-JSON helper import surface for the service layer (mirrors
 *  `SourceConfigParsing`) — gives `applyAppearance` access to
 *  `chartAppearanceFormat` to serialize a domain `ChartAppearance` into the
 *  raw `JsValue` merge-patch shape `UpdatePanelRequest.appearance` now
 *  expects (HEL-362), without duplicating `PanelProtocol`'s field encoding. */
private[services] object DashboardProposalServiceJson extends PanelProtocol
