package com.helio.api.protocols.proposals

import com.helio.api.protocols.dashboards.{DashboardProtocol, DuplicateDashboardResponse}
import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalApplyResponse, PipelineProposalProtocol}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// Stitches PipelineProposalService's and DashboardProposalService's own
// apply paths into one atomic request/response — see CombinedProposalService
// for the sentinel-resolution logic that lets a dashboard panel bind to the
// pipeline this same proposal creates. Neither PipelineProposal nor
// DashboardProposal is modified here; both types are reused verbatim.

/** Carries no ids: applying it (POST /api/proposals/apply) mints the
 *  pipeline's resolved source (if inline)/pipeline/steps/run AND the
 *  dashboard/panels atomically. `dashboard`'s panels may bind to `pipeline`'s
 *  not-yet-created output DataType via the reserved `"$pipelineOutput"`
 *  sentinel — see [[com.helio.services.CombinedProposalService]]. */
final case class CombinedProposal(pipeline: PipelineProposal, dashboard: DashboardProposal)

/** Nests each sub-service's own existing response type verbatim (design.md
 *  D5) rather than a new flat shape — an agent who knows either standalone
 *  endpoint's response shape recognizes both halves immediately. */
final case class CombinedProposalApplyResponse(
    pipeline: PipelineProposalApplyResponse,
    dashboard: DuplicateDashboardResponse
)

trait CombinedProposalProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with PipelineProposalProtocol
    with DashboardProposalProtocol
    with DashboardProtocol {

  // Both nested types already have their own tolerant RootJsonFormat
  // (pipelineProposalFormat / dashboardProposalFormat) — no hand-written
  // reader needed here.
  implicit val combinedProposalFormat: RootJsonFormat[CombinedProposal] = jsonFormat2(
    CombinedProposal.apply
  )

  implicit val combinedProposalApplyResponseFormat: RootJsonFormat[CombinedProposalApplyResponse] =
    jsonFormat2(CombinedProposalApplyResponse.apply)
}
