import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleInfo, faTableColumns } from "@fortawesome/free-solid-svg-icons";

import "./ProposalHandoff.css";
import type { AssistantProposalExtraction } from "../proposalExtraction";
import type { DashboardProposal } from "../../dashboards/types/proposal";
import type { PatchSet } from "../../patchSets/types/patchSet";

interface ProposalHandoffProps {
  extraction: AssistantProposalExtraction;
}

/** "Proposal ready" card (design.md D4) — offers a "Review proposal" action for the two kinds that
 *  have an existing review destination, reusing the *exact* `navigate(..., {state: {...}})`
 *  mechanism `AuthoringChatDrawer`/`RefinementChatDrawer` already use (no new hand-off machinery).
 *  `propose_pipeline`/`propose_combined` have no review page anywhere in the frontend — an honest
 *  informational notice, not a broken or invented link. */
export function ProposalHandoff({ extraction }: ProposalHandoffProps) {
  const navigate = useNavigate();

  if (extraction.kind === "dashboard") {
    const proposal = extraction.input as DashboardProposal;
    return (
      <div className="proposal-handoff">
        <FontAwesomeIcon
          icon={faTableColumns}
          className="proposal-handoff__icon"
          aria-hidden="true"
        />
        <div className="proposal-handoff__body">
          <p className="proposal-handoff__title">Proposal ready</p>
          <p className="proposal-handoff__description">
            {proposal.dashboardName} · {proposal.panels.length} panel
            {proposal.panels.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          className="proposal-handoff__action"
          onClick={() => navigate("/proposals/review", { state: { proposal } })}
        >
          Review proposal
        </button>
      </div>
    );
  }

  if (extraction.kind === "patch") {
    const patchSet = extraction.input as PatchSet;
    return (
      <div className="proposal-handoff">
        <FontAwesomeIcon
          icon={faTableColumns}
          className="proposal-handoff__icon"
          aria-hidden="true"
        />
        <div className="proposal-handoff__body">
          <p className="proposal-handoff__title">Proposal ready</p>
          <p className="proposal-handoff__description">
            {patchSet.edits.length} edit{patchSet.edits.length === 1 ? "" : "s"} proposed
          </p>
        </div>
        <button
          type="button"
          className="proposal-handoff__action"
          onClick={() => navigate("/patch-sets/review", { state: { patchSet } })}
        >
          Review proposal
        </button>
      </div>
    );
  }

  // pipeline | combined — no review page exists anywhere in the frontend (confirmed, design.md
  // Context). An honest, disclosed scope limit: an informational notice, never a broken/invented link.
  return (
    <div className="proposal-handoff proposal-handoff--info">
      <FontAwesomeIcon icon={faCircleInfo} className="proposal-handoff__icon" aria-hidden="true" />
      <p className="proposal-handoff__description">
        This proposal type doesn&apos;t have a review page yet.
      </p>
    </div>
  );
}
