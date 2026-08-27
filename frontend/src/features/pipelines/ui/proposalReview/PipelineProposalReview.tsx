import { Modal } from "../../../../shared/ui/Modal";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { InlineConnectorSetup } from "../../../connectors/ui/InlineConnectorSetup";
import type { UnresolvedConnectorRef } from "../../../proposals/utils/unresolvedConnectorRefs";
import { PipelineProposalSummary } from "./PipelineProposalSummary";
import type { PipelineProposal } from "../../types/pipelineProposal";
import "./PipelineProposalReview.css";

interface PipelineProposalReviewProps {
  proposal: PipelineProposal;
  applying: boolean;
  error?: string | null;
  /** HEL-829: unresolved connector references this proposal's REST source
   *  needs set up before it can be applied (design.md Decision 3). Empty for
   *  every proposal that doesn't need one. */
  unresolvedConnectorRefs?: UnresolvedConnectorRef[];
  onConnectorResolved?: (connectorId: string) => void;
  /** Called on accept — nothing is written until this fires. */
  onAccept: () => void;
  /** Called on reject / close — nothing is written. */
  onReject: () => void;
}

/** Pipeline Proposal Review UI (HEL-739) — the pipeline analogue of
 *  `ProposalReview`/`PatchSetReview`. Renders `PipelineProposalSummary` inside
 *  a `Modal` with an Accept/Reject footer; nothing is written until Accept,
 *  which calls `POST /api/pipelines/apply-proposal`. HEL-829: when the
 *  proposal's REST source needs a Connector the workspace doesn't have yet,
 *  renders `InlineConnectorSetup` inline and disables Accept until every
 *  reference resolves. */
export function PipelineProposalReview({
  proposal,
  applying,
  error,
  unresolvedConnectorRefs = [],
  onConnectorResolved = () => {},
  onAccept,
  onReject,
}: PipelineProposalReviewProps) {
  const blocked = unresolvedConnectorRefs.length > 0;

  const footer = (
    <>
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--secondary"
        onClick={onReject}
        disabled={applying}
      >
        Reject
      </button>
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--primary"
        onClick={onAccept}
        disabled={applying || blocked}
      >
        {applying ? "Creating…" : "Accept & create"}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onReject}
      size="lg"
      title="Review pipeline proposal"
      description="Nothing is created until you accept."
      footer={footer}
      className="pipeline-proposal-review"
    >
      <div className="pipeline-proposal-review__body">
        <p className="pipeline-proposal-review__pipeline-name">{proposal.pipelineName}</p>
        <PipelineProposalSummary proposal={proposal} />
        {unresolvedConnectorRefs.map((ref) => (
          <InlineConnectorSetup key={ref.key} reference={ref} onResolved={onConnectorResolved} />
        ))}
        <InlineError error={error} />
      </div>
    </Modal>
  );
}
