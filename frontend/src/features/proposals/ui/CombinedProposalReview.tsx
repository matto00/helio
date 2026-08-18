import { Modal } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/chrome/InlineError";
import { PipelineProposalSummary } from "../../pipelines/ui/PipelineProposalSummary";
import type { ProposalPanel } from "../../dashboards/types/proposal";
import type { CombinedProposal } from "../types/combinedProposal";
import "./CombinedProposalReview.css";

/** The reserved sentinel a combined proposal's dashboard panels may bind to,
 *  standing in for the pipeline's not-yet-created output DataType
 *  (`CombinedProposalService.OutputRefSentinel` on the backend, design.md
 *  Risk 1). Must never be resolved/displayed as a real DataType id. */
const PIPELINE_OUTPUT_SENTINEL = "$pipelineOutput";

const DATA_PANEL_TYPES = new Set(["metric", "chart", "table", "collection", "timeline"]);

function boundDataTypeLabel(panel: ProposalPanel): string | null {
  if (!DATA_PANEL_TYPES.has(panel.type)) return null;
  if (!panel.dataTypeId) return "—";
  if (panel.dataTypeId === PIPELINE_OUTPUT_SENTINEL) return "This pipeline's own output";
  return panel.dataTypeId;
}

function DashboardPanelRow({ panel }: { panel: ProposalPanel }) {
  const boundName = boundDataTypeLabel(panel);
  return (
    <li className="combined-proposal-review__panel">
      <div className="combined-proposal-review__panel-head">
        <span className="combined-proposal-review__panel-title">{panel.title}</span>
        <span className="combined-proposal-review__type">{panel.type}</span>
      </div>
      <dl className="combined-proposal-review__meta">
        {boundName && (
          <div className="combined-proposal-review__meta-row">
            <dt>Data type</dt>
            <dd className="mono">{boundName}</dd>
          </div>
        )}
        {panel.fieldMapping && Object.keys(panel.fieldMapping).length > 0 && (
          <div className="combined-proposal-review__meta-row">
            <dt>Mapping</dt>
            <dd className="mono">
              {Object.entries(panel.fieldMapping)
                .map(([k, v]) => `${k} → ${v}`)
                .join(", ")}
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

interface CombinedProposalReviewProps {
  proposal: CombinedProposal;
  applying: boolean;
  error?: string | null;
  /** Called on accept — a single action covering BOTH halves. Nothing is
   *  written until this fires. */
  onAccept: () => void;
  /** Called on reject / close — nothing is written. */
  onReject: () => void;
}

/** Combined Proposal Review UI (HEL-739). Renders the nested pipeline
 *  proposal via the unmodified `PipelineProposalSummary` (design.md D3/D8)
 *  alongside NEW, dedicated, READ-ONLY JSX for the nested dashboard proposal
 *  (dashboard name + one row per panel) — not a reuse of `ProposalReview.tsx`,
 *  which owns its own Modal chrome/footer and cannot be embedded footer-less
 *  (design.md D8, skeptic round 1 CR2). A single Accept/Reject pair covers
 *  both halves atomically. */
export function CombinedProposalReview({
  proposal,
  applying,
  error,
  onAccept,
  onReject,
}: CombinedProposalReviewProps) {
  const { pipeline, dashboard } = proposal;

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
      title="Review combined proposal"
      description="Nothing is created until you accept. One Accept creates both the pipeline and the dashboard."
      footer={footer}
      className="combined-proposal-review"
    >
      <div className="combined-proposal-review__body">
        <section aria-label="Proposed pipeline">
          <p className="eyebrow combined-proposal-review__section-label">
            Pipeline — {pipeline.pipelineName}
          </p>
          <PipelineProposalSummary proposal={pipeline} />
        </section>

        <section aria-label="Proposed dashboard">
          <p className="eyebrow combined-proposal-review__section-label">
            Dashboard — {dashboard.dashboardName}
          </p>
          {dashboard.panels.length === 0 ? (
            <p className="combined-proposal-review__empty">No panels proposed.</p>
          ) : (
            <ul className="combined-proposal-review__panels">
              {dashboard.panels.map((panel, index) => (
                <DashboardPanelRow key={index} panel={panel} />
              ))}
            </ul>
          )}
        </section>

        <InlineError error={error} />
      </div>
    </Modal>
  );
}
