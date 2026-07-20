import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { DashboardProposal, ProposalPanel } from "../types/proposal";
import "./ProposalReview.css";

/** Minimal DataType info the review needs to name a binding and flag a
 *  non-pipeline-output (unbindable) reference. */
export interface ReviewDataType {
  name: string;
  sourceId: string | null;
}

interface ProposalReviewProps {
  proposal: DashboardProposal;
  /** id → DataType, for resolving binding names + flagging invalid bindings. */
  dataTypesById: Record<string, ReviewDataType>;
  applying: boolean;
  error?: string | null;
  /** Called with the (possibly edited) proposal on accept. */
  onAccept: (edited: DashboardProposal) => void;
  /** Called on reject / close — nothing is written. */
  onReject: () => void;
}

const DATA_PANEL_TYPES = new Set(["metric", "chart", "table", "collection", "timeline"]);
const PREVIEW_COLS = 12;
const PREVIEW_ROW_PX = 16;

/** Proposal Review UI (HEL-224). Renders a proposed dashboard — name + panel
 *  list (type / bound DataType / field mapping / layout) + a small preview —
 *  and lets the reviewer edit panel titles, remove panels, or reject. Nothing
 *  is written until Accept, which calls the apply-proposal endpoint. */
export function ProposalReview({
  proposal,
  dataTypesById,
  applying,
  error,
  onAccept,
  onReject,
}: ProposalReviewProps) {
  const [name, setName] = useState(proposal.dashboardName);
  const [panels, setPanels] = useState<ProposalPanel[]>(proposal.panels);

  const updateTitle = (index: number, title: string) =>
    setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, title } : p)));

  const removePanel = (index: number) => setPanels((prev) => prev.filter((_, i) => i !== index));

  const positioned = useMemo(() => panels.filter((p) => p.layout), [panels]);
  const previewRows = useMemo(
    () => Math.max(1, ...positioned.map((p) => (p.layout ? p.layout.y + p.layout.h : 1))),
    [positioned],
  );

  const bindingIssue = (panel: ProposalPanel): string | null => {
    if (!DATA_PANEL_TYPES.has(panel.type)) return null;
    if (!panel.dataTypeId) return "No DataType bound";
    const dt = dataTypesById[panel.dataTypeId];
    if (!dt) return "Bound DataType not found in this workspace";
    if (dt.sourceId !== null) return "Bound to a source companion — not a pipeline output";
    return null;
  };

  const canAccept = name.trim().length > 0 && panels.length > 0 && !applying;

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
        onClick={() => onAccept({ dashboardName: name.trim(), panels })}
        disabled={!canAccept}
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
      title="Review dashboard proposal"
      description="Nothing is created until you accept. Edit titles, remove panels, or reject."
      footer={footer}
      className="proposal-review"
    >
      <div className="proposal-review__body">
        <label className="proposal-review__name-field">
          <span className="eyebrow">Dashboard name</span>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Dashboard name"
            placeholder="Dashboard name"
          />
        </label>

        <section aria-label="Proposed panels">
          <p className="eyebrow proposal-review__section-label">
            {panels.length} panel{panels.length === 1 ? "" : "s"}
          </p>
          {panels.length === 0 ? (
            <p className="proposal-review__empty">
              All panels removed — add panels or reject the proposal.
            </p>
          ) : (
            <ul className="proposal-review__panels">
              {panels.map((panel, index) => {
                const issue = bindingIssue(panel);
                const boundName = panel.dataTypeId
                  ? (dataTypesById[panel.dataTypeId]?.name ?? panel.dataTypeId)
                  : null;
                return (
                  <li key={index} className="proposal-review__panel">
                    <div className="proposal-review__panel-head">
                      <TextField
                        value={panel.title}
                        onChange={(e) => updateTitle(index, e.target.value)}
                        aria-label={`Panel ${index + 1} title`}
                      />
                      <span className="proposal-review__type">{panel.type}</span>
                      <button
                        type="button"
                        className="proposal-review__remove"
                        onClick={() => removePanel(index)}
                        aria-label={`Remove panel ${panel.title}`}
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>
                    <dl className="proposal-review__meta">
                      {DATA_PANEL_TYPES.has(panel.type) && (
                        <div className="proposal-review__meta-row">
                          <dt>DataType</dt>
                          <dd className="mono">{boundName ?? "—"}</dd>
                        </div>
                      )}
                      {panel.fieldMapping && Object.keys(panel.fieldMapping).length > 0 && (
                        <div className="proposal-review__meta-row">
                          <dt>Mapping</dt>
                          <dd className="mono">
                            {Object.entries(panel.fieldMapping)
                              .map(([k, v]) => `${k} → ${v}`)
                              .join(", ")}
                          </dd>
                        </div>
                      )}
                      {panel.layout && (
                        <div className="proposal-review__meta-row">
                          <dt>Layout</dt>
                          <dd className="mono">
                            x{panel.layout.x} y{panel.layout.y} · {panel.layout.w}×{panel.layout.h}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {issue && (
                      <p className="proposal-review__issue" role="status">
                        {issue}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {positioned.length > 0 && (
          <section aria-label="Layout preview">
            <p className="eyebrow proposal-review__section-label">Preview</p>
            <div
              className="proposal-review__preview"
              style={{ height: `${previewRows * PREVIEW_ROW_PX}px` }}
            >
              {positioned.map((panel, i) => {
                const l = panel.layout!;
                return (
                  <div
                    key={i}
                    className="proposal-review__preview-cell"
                    style={{
                      left: `${(l.x / PREVIEW_COLS) * 100}%`,
                      width: `${(l.w / PREVIEW_COLS) * 100}%`,
                      top: `${l.y * PREVIEW_ROW_PX}px`,
                      height: `${l.h * PREVIEW_ROW_PX}px`,
                    }}
                    title={`${panel.title} (${panel.type})`}
                  >
                    <span className="proposal-review__preview-label">{panel.title}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <InlineError error={error} />
      </div>
    </Modal>
  );
}
