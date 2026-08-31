package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.patchsets.{EditOutcome, PatchSet, PatchSetApplyResponse}
import com.helio.domain.panels.PanelConfigCodec
import com.helio.domain.model.{AuthenticatedUser, PatchSetApplicationId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import PatchSetApplicationRepository.{JournaledEdit, PatchSetApplicationRecord}
import spray.json.JsValue

import java.time.Instant
import java.util.UUID
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
// HEL-904 task 3.3: `dataTypeService` REMOVED outright -- `dataType` is no
// longer a valid target.kind, so forward-apply/rollback never invoke it.
final class PatchSetApplyService(
    panelService: PanelService,
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    accessChecker: AccessChecker,
    // HEL-413 design.md D2: journals a successful (no `failure`) apply so a
    // later `PatchSetUndoService.undo` can restore it. Written synchronously,
    // inside this class's own terminal success branch — never fire-and-forget,
    // since the response's `applicationId` field depends on it.
    applicationRepo: PatchSetApplicationRepository
)(implicit ec: ExecutionContext) {

  private val context: PatchSetApplyContext =
    PatchSetApplyContext(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker)

  private val services: PatchSetApplyServices =
    PatchSetApplyServices(panelService, dashboardService, dataSourceService, pipelineService)

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
   *  reporting exactly what was rolled back and why (design.md D4).
   *
   *  Alongside `applied` (unchanged — the exact 2-tuple shape
   *  `PatchSetApplyRollback.rollback`'s failure-path call already expects,
   *  never widened), the loop also builds a SEPARATE, `edit.index`-keyed
   *  `rawConfigs` accumulator (design.md D2a) — populated only for a panel
   *  `update` edit's just-persisted raw config, via one bare
   *  `panelRepo.findByIdInternal` fetch right after that edit's `applyOne`
   *  call succeeds. Only the terminal SUCCESS branch reads it, to journal
   *  the application (design.md D2); the failure path never touches it. */
  private def applyResolved(
      resolved: Vector[ResolvedEdit],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PatchSetApplyResponse]] = {
    def loop(
        remaining: Vector[ResolvedEdit],
        applied: Vector[(ResolvedEdit, EditOutcome)],
        rawConfigs: Map[Int, JsValue]
    ): Future[Either[(ServiceError, Vector[(ResolvedEdit, EditOutcome)]), (Vector[(ResolvedEdit, EditOutcome)], Map[Int, JsValue])]] =
      remaining.headOption match {
        case None => Future.successful(Right((applied, rawConfigs)))
        case Some(edit) =>
          PatchSetApplyForward.applyOne(edit, user, services).flatMap {
            case Left(err) => Future.successful(Left((err, applied)))
            case Right(outcome) =>
              captureRawPanelConfig(edit).flatMap { rawConfigOpt =>
                val nextRawConfigs = rawConfigOpt.fold(rawConfigs)(json => rawConfigs + (edit.index -> json))
                loop(remaining.tail, applied :+ (edit -> outcome), nextRawConfigs)
              }
          }
      }

    loop(resolved, Vector.empty, Map.empty).flatMap {
      case Right((appliedAll, rawConfigs)) =>
        journalSuccess(appliedAll, rawConfigs, user).map { applicationId =>
          Right(PatchSetApplyResponse(appliedAll.map(_._2), failure = None, applicationId = Some(applicationId)))
        }
      case Left((err, appliedSoFar)) =>
        PatchSetApplyRollback.rollback(appliedSoFar, user, services).map { rolledBack =>
          Right(PatchSetApplyResponse(rolledBack, failure = Some(err.message), applicationId = None))
        }
    }
  }

  /** design.md D2a: a panel `update` edit's forward apply already persisted
   *  the RAW config (`PanelPatchApplier.apply`'s `panelRepo.replace`, ahead
   *  of `resolveSingleBinding`'s materialization) — this re-reads that SAME
   *  row via `findByIdInternal`, the identical unmaterialized path
   *  `priorState` already uses, so the captured snapshot is genuinely raw
   *  even for a bound `MetricPanel`. A `create` edit needs no fetch
   *  (`PanelService.create` never materializes); every other kind is `None`. */
  private def captureRawPanelConfig(edit: ResolvedEdit): Future[Option[JsValue]] =
    edit.action match {
      case ResolvedAction.PanelUpdate(id, _, _) =>
        panelRepo.findByIdInternal(id).map(_.map(PanelConfigCodec.encodeConfig))
      case _ => Future.successful(None)
    }

  /** design.md D2: journals the application ONLY once every edit has
   *  applied cleanly (this method is only ever reached from the loop's
   *  success branch) — a partially-rolled-back apply never reaches here.
   *  `targetKind`/`op` are threaded from each edit's own `ResolvedEdit`
   *  (`EditOutcome` itself doesn't carry them); `rawResultingConfig` comes
   *  from the separate accumulator, keyed by the same `edit.index`. */
  private def journalSuccess(
      appliedAll: Vector[(ResolvedEdit, EditOutcome)],
      rawConfigs: Map[Int, JsValue],
      user: AuthenticatedUser
  ): Future[String] = {
    val journaledEdits = appliedAll.map { case (edit, outcome) =>
      JournaledEdit(
        index              = edit.index,
        targetKind         = edit.kind,
        op                 = edit.op,
        priorState         = outcome.priorState,
        resultingState     = outcome.resultingState,
        newId              = outcome.newId,
        rawResultingConfig = rawConfigs.get(edit.index)
      )
    }
    val now = Instant.now()
    val record = PatchSetApplicationRecord(
      id        = PatchSetApplicationId(UUID.randomUUID().toString),
      ownerId   = user.id,
      appliedAt = now,
      edits     = journaledEdits,
      createdAt = now
    )
    applicationRepo.create(record).map(_.id.value)
  }
}
