package com.helio.services.dashboards

import com.helio.services.proposals.ProposalPanelSupport
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.PanelService
import com.helio.services.ServiceError
import com.helio.api.protocols.proposals.{ProposalPanel, ReplaceDashboardContentsRequest}
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DashboardLayout, DashboardLayoutItem, Panel, ResourceAccess}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository

import scala.concurrent.{ExecutionContext, Future}

/** `PUT /api/dashboards/:id/contents` (HEL-363) — atomic, all-or-nothing
 *  replace of an EXISTING dashboard's panel set.
 *
 *  Composes the same panel construction the create path and apply-proposal
 *  use ([[PanelService.buildForCreate]] / [[ProposalPanelSupport]]), but with
 *  a critical difference from `DashboardProposalService` (design.md D1): the
 *  target dashboard already exists, so there is no "delete the whole thing
 *  on failure" fallback — that would destroy a real user's dashboard. Every
 *  panel is structurally validated and V41-binding-validated up front (zero
 *  DB writes); only once every panel in the batch is known-good does this
 *  call the repository's single-transaction `replaceContents`
 *  ([[com.helio.infrastructure.DashboardContentsOps]]).
 *
 *  design.md D4: overlapping replace-contents calls for the same dashboard
 *  are last-writer-wins at the repository transaction layer — see
 *  `DashboardContentsOps.replaceContents`'s scaladoc; not re-litigated here. */
final class DashboardContentsService(
    dashboardRepo: DashboardRepository,
    panelService: PanelService,
    dataTypeRepo: DataTypeRepository,
    accessChecker: AccessChecker,
    // HEL-549: mirrors DashboardProposalService's nullable-optional wiring
    // convention (design.md D5) — only touched when a panel actually
    // carries a metricId.
    metricRepo: MetricRepository
)(implicit ec: ExecutionContext) {

  def replaceContents(
      dashboardId: DashboardId,
      request: ReplaceDashboardContentsRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    authorizeEditor(dashboardId, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        validatePanels(request.panels) match {
          case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(_) =>
            ProposalPanelSupport.preValidateBindings(request.panels, user, dataTypeRepo, metricRepo).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  => buildAndReplace(dashboardId, request.panels, user)
            }
        }
    }

  /** Mirrors `DashboardProposalService.validateStructure`'s per-panel loop
   *  (same 1-indexed `panel N ('title')` message shape via
   *  `ProposalPanelSupport.validatePanel`) — minus the proposal's
   *  `dashboardName` check, which has no equivalent here (the dashboard
   *  already exists). Zero side effects — fails on the first bad panel so a
   *  malformed payload replaces nothing. */
  private def validatePanels(panels: Vector[ProposalPanel]): Either[String, Unit] =
    panels.zipWithIndex.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(e), _) => Left(e)
      case (Right(_), (panel, idx)) =>
        ProposalPanelSupport.validatePanel(s"panel ${idx + 1} ('${panel.title}')", panel)
    }

  private def buildAndReplace(
      dashboardId: DashboardId,
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    buildPanels(dashboardId, panels, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(built) =>
        val layout = remapLayout(panels, built)
        dashboardRepo.replaceContents(dashboardId, built, Some(layout)).map {
          case None         => Left(ServiceError.NotFound("Dashboard not found"))
          case Some(result) => Right(result)
        }
    }

  /** Map every proposal panel to a `CreatePanelRequest` up front, then
   *  delegate the "validate every item before any write" recursion to
   *  `PanelService.buildAllForCreate` (HEL-370 D2, behavior-preserving
   *  extraction) — passing NO `itemLabel` so error messages stay
   *  byte-for-byte unchanged (this class's own indexed "panel N ('title')"
   *  errors come entirely from `validatePanels`/`preValidateBindings`, which
   *  run BEFORE this method; see `buildAllForCreate`'s scaladoc). */
  private def buildPanels(
      dashboardId: DashboardId,
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[Panel]]] = {
    val requests = panels.map(panel => ProposalPanelSupport.buildCreateRequest(dashboardId, panel))
    panelService.buildAllForCreate(dashboardId, requests, user)
  }

  /** Remap each proposal panel's optional layout item onto its freshly minted
   *  panel id (design.md D2 — mirrors `DashboardProposalService.applyLayout`'s
   *  id-remap, done pre-transaction here instead of via a follow-up PATCH).
   *  Panels with no layout are simply omitted — the frontend auto-places
   *  them, same convention as apply-proposal. The resulting `DashboardLayout`
   *  (possibly empty) is ALWAYS passed to `replaceContents`, wholesale
   *  replacing the dashboard's stored layout — any prior layout entries
   *  referenced the now-deleted old panel ids, so leaving them would dangle. */
  private def remapLayout(proposalPanels: Vector[ProposalPanel], builtPanels: Vector[Panel]): DashboardLayout = {
    val items = proposalPanels.zip(builtPanels).flatMap { case (proposal, built) =>
      proposal.layout.map(l => DashboardLayoutItem(built.id, l.x, l.y, l.w, l.h))
    }
    DashboardLayout(lg = items, md = items, sm = items, xs = items)
  }

  /** Owner or editor grantee may replace contents — mirrors
   *  `DashboardService.update`'s exact two-step ACL pattern (NOT a direct
   *  `accessChecker.requireAccess` call, which is deliberately AclDirective-
   *  shaped and returns 403 for ANY authenticated no-grant caller on an
   *  existing resource — see `AccessCheckerImpl.requireAccess`). Step 1: the
   *  sharing-aware `dashboardRepo.findById` — `None` (no grant at all) → 404,
   *  no existence leak. Step 2: only once the caller is a KNOWN grantee
   *  (existence already visible to them) does role tier matter — owner
   *  proceeds directly; a non-owner grantee's role is checked via
   *  `accessChecker.requireAccess` (Viewer → 403, Editor → proceed). */
  private def authorizeEditor(dashboardId: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dashboardRepo.findById(dashboardId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(existing) if existing.ownerId == user.id =>
        Future.successful(Right(()))
      case Some(_) =>
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
          case Left(err)                    => Left(err)
          case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())
          case Right(_)                     => Right(())
        }
    }
}
