package com.helio.services

import com.helio.api.protocols.{
  CombinedProposal,
  CombinedProposalApplyResponse,
  DashboardResponse,
  DashboardProposalProtocol,
  DuplicateDashboardResponse,
  PanelResponse,
  ProposalPanel
}
import com.helio.domain.AuthenticatedUser
import spray.json.{JsObject, JsString}

import scala.concurrent.{ExecutionContext, Future}

/** Orchestrates `PipelineProposalService.apply` + `DashboardProposalService.apply`
 *  into one atomic combined proposal (HEL-387, design.md). Holds no
 *  persistence logic of its own — every write runs through the two composed,
 *  COMPLETELY UNMODIFIED services. The only new logic here is a pure,
 *  in-memory sentinel-position validation/substitution pass (no I/O) that
 *  lets a dashboard panel reference the pipeline this same proposal creates:
 *
 *   1. `validateOutputRefPositions` (design.md D2) rejects, before the
 *      pipeline is ever applied, any panel where the reserved sentinel
 *      `"$pipelineOutput"` appears anywhere other than the ONE "blessed
 *      slot" [[ProposalPanelSupport.bindingCandidate]] would actually read
 *      for that panel's kind and flat-field state.
 *   2. On success, `pipelineProposalService.apply` runs.
 *   3. `resolveOutputRefs` (design.md D3) substitutes the pipeline's real
 *      `outputDataTypeId` for the sentinel at that same one blessed slot,
 *      then `dashboardProposalService.apply` runs on the resolved copy.
 *   4. A dashboard-phase failure rolls back the already-applied pipeline
 *      (and its inline source, if any) via `pipelineProposalService.rollback`
 *      (design.md D4) before the error is returned. */
final class CombinedProposalService(
    pipelineProposalService: PipelineProposalService,
    dashboardProposalService: DashboardProposalService
)(implicit ec: ExecutionContext) {

  import CombinedProposalService._

  def apply(
      combined: CombinedProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, CombinedProposalApplyResponse]] =
    validateOutputRefPositions(combined.dashboard.panels) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        pipelineProposalService.apply(combined.pipeline, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(pipelineResp) =>
            val resolvedDashboard = combined.dashboard.copy(
              panels = resolveOutputRefs(combined.dashboard.panels, pipelineResp.outputDataTypeId)
            )
            dashboardProposalService.apply(resolvedDashboard, user).flatMap {
              case Right((dashboard, panels)) =>
                Future.successful(Right(CombinedProposalApplyResponse(
                  pipeline = pipelineResp,
                  dashboard = DuplicateDashboardResponse(
                    dashboard = DashboardResponse.fromDomain(dashboard),
                    panels    = panels.map(p => PanelResponse.fromDomain(p))
                  )
                )))
              case Left(err) =>
                pipelineProposalService.rollback(pipelineResp, user).map(_ => Left(err))
            }
        }
    }
}

object CombinedProposalService {

  /** Reserved sentinel a dashboard panel's flat `dataTypeId`/`config.dataTypeId`
   *  may carry to mean "bind to the pipeline this same combined proposal
   *  creates" (design.md D1). `$` is never legal in a UUID, so collision with
   *  a real id is not a practical concern. */
  val OutputRefSentinel: String = "$pipelineOutput"

  /** design.md D2/D3's shared precedence, mirroring
   *  [[ProposalPanelSupport.bindingCandidate]]'s exact `Option.orElse`
   *  short-circuit: the flat `dataTypeId` is the blessed slot if it literally
   *  equals the sentinel. */
  private def flatIsBlessed(panel: ProposalPanel): Boolean =
    panel.dataTypeId.contains(OutputRefSentinel)

  /** `config.dataTypeId` is the blessed slot ONLY when BOTH (a) `panel.type`
   *  is outside `DashboardProposalService.DataPanelKinds`, AND (b) the flat
   *  `dataTypeId` is `isEmpty` (true absence, never merely "not the
   *  sentinel") — `orElse` only falls through when the flat field is absent
   *  entirely, so a non-`DataPanelKinds` panel whose flat `dataTypeId`
   *  already holds some OTHER real value never has `config.dataTypeId`
   *  consulted at all. */
  private def configIsBlessed(panel: ProposalPanel): Boolean =
    !DashboardProposalService.DataPanelKinds.contains(panel.`type`) &&
      panel.dataTypeId.isEmpty &&
      panel.config.exists(_.fields.get("dataTypeId").contains(JsString(OutputRefSentinel)))

  /** Returns a copy of `panel` with the ONE legitimate blessed occurrence (if
   *  any) removed: the flat `dataTypeId` cleared to `None` if it holds the
   *  sentinel; else, only when `configIsBlessed`, the `config` object's
   *  `"dataTypeId"` key removed. Otherwise returns `panel` unchanged — in
   *  particular, a shadowed or kind-mismatched `config.dataTypeId` sentinel
   *  is left in place so `validateOutputRefPositions`'s re-serialization
   *  check still finds it (task 4.2). */
  private def clearBlessedSlot(panel: ProposalPanel): ProposalPanel =
    if (flatIsBlessed(panel)) panel.copy(dataTypeId = None)
    else if (configIsBlessed(panel))
      panel.copy(config = panel.config.map(cfg => JsObject(cfg.fields - "dataTypeId")))
    else panel

  /** design.md D2: for each panel, clear its one blessed occurrence (if any)
   *  and re-serialize — if the sentinel still appears anywhere in that
   *  cleared panel's JSON, the panel has a kind-mismatched occurrence, a
   *  flat-field-shadowed `config.dataTypeId` occurrence, or a duplicate
   *  alongside a legitimate one. Pure, no I/O; runs before
   *  `pipelineProposalService.apply` is ever called. */
  private def validateOutputRefPositions(panels: Vector[ProposalPanel]): Either[ServiceError, Unit] =
    panels.zipWithIndex.foldLeft[Either[ServiceError, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), (panel, idx)) =>
        val clearedJson = CombinedProposalServiceJson.proposalPanelFormat.write(clearBlessedSlot(panel))
        if (clearedJson.toString.contains(OutputRefSentinel))
          Left(ServiceError.BadRequest(
            s"panel ${idx + 1} ('${panel.title}'): \"$OutputRefSentinel\" is not in a resolvable binding position"
          ))
        else Right(())
    }

  /** design.md D3: substitutes `outputDataTypeId` for the sentinel at the
   *  same one blessed slot `validateOutputRefPositions` already confirmed is
   *  the panel's only occurrence — an unconditional substitution, never an
   *  ambiguous choice between two candidate slots. Every other panel is
   *  returned untouched. */
  private def resolveOutputRefs(panels: Vector[ProposalPanel], outputDataTypeId: String): Vector[ProposalPanel] =
    panels.map { panel =>
      if (flatIsBlessed(panel)) panel.copy(dataTypeId = Some(outputDataTypeId))
      else if (configIsBlessed(panel))
        panel.copy(config = panel.config.map(cfg => JsObject(cfg.fields + ("dataTypeId" -> JsString(outputDataTypeId)))))
      else panel
    }
}

/** Spray-JSON helper import surface (mirrors `DashboardProposalServiceJson`)
 *  — gives `validateOutputRefPositions` access to `proposalPanelFormat` so a
 *  cleared panel can be re-serialized to check for a lingering sentinel
 *  occurrence, without duplicating `DashboardProposalProtocol`'s field
 *  encoding. */
private[services] object CombinedProposalServiceJson extends DashboardProposalProtocol
