package com.helio.services

import com.helio.api.protocols.{EditOutcome, PatchSet, PatchSetApplyResponse}
import com.helio.domain.AuthenticatedUser
import com.helio.infrastructure.{
  DashboardRepository,
  DataSourceRepository,
  DataTypeRepository,
  MetricRepository,
  PanelRepository,
  PipelineRepository,
  PipelineStepRepository
}

import scala.concurrent.{ExecutionContext, Future}

/** Applies a reviewed `PatchSet` (HEL-403's schema/protocol) atomically — N
 *  targeted edits (update/delete/create) across EXISTING resources either
 *  all succeed or none do (ticket.md). The mutation analogue of
 *  `DashboardProposalService`/`PipelineProposalService`'s compose-existing-
 *  services-then-rollback-on-failure shape, extended to `update`/`delete`
 *  edits that mutate resources predating this call (design.md Context).
 *
 *  Two phases, no direct repository writes anywhere in this ticket:
 *
 *   1. Pre-validation ([[PatchSetApplyResolvers]], design.md D2/D2a) —
 *      every edit's target, AND any embedded cross-resource reference inside
 *      its `patch`/`createPatch`, is authorized and decoded BEFORE any
 *      mutation, using each kind's REAL per-op access rule (not merely a
 *      same-named repo lookup). A single failure here fails the whole call;
 *      nothing changes (ticket.md AC2).
 *   2. Forward-apply ([[PatchSetApplyForward]], design.md D1) in the
 *      caller's given order, via the matching EXISTING per-resource service
 *      method only. On a mid-set failure, the edits already applied are
 *      compensated in reverse order ([[PatchSetApplyRollback]], design.md
 *      D3/D3a) and the response reports each edit's outcome honestly —
 *      never silently overclaiming a rollback that couldn't fully restore
 *      the resource (design.md D1's "unrecoverable"/"recreated" tiers). */
final class PatchSetApplyService(
    panelService: PanelService,
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    dataTypeService: DataTypeService,
    pipelineService: PipelineService,
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    // Nullable-optional wiring mirrors `PanelService`'s own convention for
    // `metricRepo` — only touched when an edit's config patch actually
    // carries a `metricId` (design.md D2a).
    metricRepo: MetricRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  private val context: PatchSetApplyContext =
    PatchSetApplyContext(panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo, metricRepo, accessChecker)

  private val services: PatchSetApplyServices =
    PatchSetApplyServices(panelService, dashboardService, dataSourceService, dataTypeService, pipelineService)

  def apply(patchSet: PatchSet, user: AuthenticatedUser): Future[Either[ServiceError, PatchSetApplyResponse]] =
    PatchSetApplyResolvers.resolveAll(patchSet.edits, user, context).flatMap {
      case Left(err)       => Future.successful(Left(err))
      case Right(resolved) => applyResolved(resolved, user)
    }

  /** Applies every resolved edit in order, short-circuiting the walk (not
   *  the whole call) on the first failure so [[PatchSetApplyRollback]] can
   *  compensate exactly the edits that already succeeded. Unlike
   *  pre-validation's failure (a plain `Left(ServiceError)`, mapped to an
   *  HTTP error status by the route), a MID-SET failure still returns
   *  `Right` — the request's atomicity guarantee was honored (nothing was
   *  left partially applied) even though the caller's requested changes
   *  didn't take effect, so the caller gets a normal response body
   *  reporting exactly what was rolled back and why (design.md D4). */
  private def applyResolved(
      resolved: Vector[ResolvedEdit],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PatchSetApplyResponse]] = {
    def loop(
        remaining: Vector[ResolvedEdit],
        applied: Vector[(ResolvedEdit, EditOutcome)]
    ): Future[Either[(ServiceError, Vector[(ResolvedEdit, EditOutcome)]), Vector[EditOutcome]]] =
      remaining.headOption match {
        case None => Future.successful(Right(applied.map(_._2)))
        case Some(edit) =>
          PatchSetApplyForward.applyOne(edit, user, services).flatMap {
            case Left(err)      => Future.successful(Left((err, applied)))
            case Right(outcome) => loop(remaining.tail, applied :+ (edit -> outcome))
          }
      }

    loop(resolved, Vector.empty).flatMap {
      case Right(outcomes) =>
        Future.successful(Right(PatchSetApplyResponse(outcomes, failure = None)))
      case Left((err, appliedSoFar)) =>
        PatchSetApplyRollback.rollback(appliedSoFar, user, services).map { rolledBack =>
          Right(PatchSetApplyResponse(rolledBack, failure = Some(err.message)))
        }
    }
  }
}
