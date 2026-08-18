import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";

import "./ProposalHandoff.css";
import type { AssistantProposalExtraction } from "../proposalExtraction";
import type { DashboardProposal } from "../../dashboards/types/proposal";
import type { PatchSet } from "../../patchSets/types/patchSet";
import type { PipelineProposal } from "../../pipelines/types/pipelineProposal";
import type { CombinedProposal } from "../../proposals/types/combinedProposal";

interface ProposalHandoffProps {
  extraction: AssistantProposalExtraction;
}

/** "Proposal ready" card (design.md D4) — offers a "Review proposal" action for every kind,
 *  reusing the *exact* `navigate(..., {state: {...}})` mechanism `AuthoringChatDrawer`/
 *  `RefinementChatDrawer` already use (no new hand-off machinery). HEL-739 closed the last gap:
 *  `pipeline`/`combined` now navigate to their own review routes exactly like `dashboard`/`patch`
 *  already did, replacing the former informational-only fallback card. */
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

  if (extraction.kind === "pipeline") {
    const proposal = extraction.input as PipelineProposal;
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
            {proposal.pipelineName} · {proposal.steps.length} step
            {proposal.steps.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          className="proposal-handoff__action"
          onClick={() => navigate("/pipeline-proposals/review", { state: { proposal } })}
        >
          Review proposal
        </button>
      </div>
    );
  }

  // extraction.kind === "combined"
  const proposal = extraction.input as CombinedProposal;
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
          {proposal.pipeline.pipelineName} → {proposal.dashboard.dashboardName}
        </p>
      </div>
      <button
        type="button"
        className="proposal-handoff__action"
        onClick={() => navigate("/combined-proposals/review", { state: { proposal } })}
      >
        Review proposal
      </button>
    </div>
  );
}
