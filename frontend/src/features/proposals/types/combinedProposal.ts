import type {
  PipelineProposal,
  PipelineProposalApplyResponse,
} from "../../pipelines/types/pipelineProposal";
import type { AppliedProposal, DashboardProposal } from "../../dashboards/types/proposal";

/** `CombinedProposal`/apply-response types (HEL-739 design.md D3). Mirrors
 *  `CombinedProposalProtocol.scala`'s wire shape for `POST /api/proposals/apply`
 *  (HEL-387, unmodified). Lives under `features/proposals/`, not
 *  `features/dashboards/` or `features/pipelines/`, mirroring the backend's
 *  own package-neutral placement — a combined proposal is neither exclusively
 *  a pipeline nor a dashboard concern. */

/** Carries no ids: applying it (`POST /api/proposals/apply`) mints the
 *  pipeline's resolved source (if inline)/pipeline/steps/run AND the
 *  dashboard/panels atomically. `dashboard`'s panels may bind to `pipeline`'s
 *  not-yet-created output DataType via the reserved `"$pipelineOutput"`
 *  sentinel. */
export interface CombinedProposal {
  pipeline: PipelineProposal;
  dashboard: DashboardProposal;
}

/** Response of `POST /api/proposals/apply`. `dashboard` reuses the existing
 *  `AppliedProposal` type verbatim — `DuplicateDashboardResponse`
 *  (`{dashboard, panels}`, `DashboardProtocol.scala`) is byte-shape-identical
 *  to it (design.md D3). */
export interface CombinedProposalApplyResponse {
  pipeline: PipelineProposalApplyResponse;
  dashboard: AppliedProposal;
}
