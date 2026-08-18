import { Modal } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/chrome/InlineError";
import { PipelineProposalSummary } from "./PipelineProposalSummary";
import type { PipelineProposal } from "../types/pipelineProposal";
import "./PipelineProposalReview.css";

interface PipelineProposalReviewProps {
  proposal: PipelineProposal;
  applying: boolean;
  error?: string | null;
  /** Called on accept — nothing is written until this fires. */
  onAccept: () => void;
  /** Called on reject / close — nothing is written. */
  onReject: () => void;
}

/** Pipeline Proposal Review UI (HEL-739) — the pipeline analogue of
 *  `ProposalReview`/`PatchSetReview`. Renders `PipelineProposalSummary` inside
 *  a `Modal` with an Accept/Reject footer; nothing is written until Accept,
 *  which calls `POST /api/pipelines/apply-proposal`. */
export function PipelineProposalReview({
  proposal,
  applying,
  error,
  onAccept,
  onReject,
}: PipelineProposalReviewProps) {
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
        disabled={applying}
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
        <InlineError error={error} />
      </div>
    </Modal>
  );
}
