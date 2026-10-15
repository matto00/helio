// SpineStatusStrip -- HEL-1579 (design.md D3): the slim strip under the header. Carries the cost-verdict
// denial with "Run to update" (right-aligned so it sits next to Run, owner ruling `spine-row-menu`; warning
// tokens, never the accent) and the run-truncation warning banner. Renders nothing when both are absent.

import { denyReasonCopy } from "../../services/denyReasonCopy";
import type { CostVerdict } from "../../types/pipelineStep";

// Static: one strip is ever mounted per page (HEL-1096 design.md D5).
const DENIAL_REASON_ID = "pipeline-spine-denial-reason";

export function SpineStatusStrip({
  costVerdict,
  onRunToUpdate,
  truncationNotice,
}: {
  costVerdict: CostVerdict | null;
  onRunToUpdate: () => void;
  truncationNotice: string | null;
}) {
  const denied = costVerdict !== null && !costVerdict.autoRunnable;
  if (!denied && truncationNotice === null) return null;
  return (
    <div className="spine-strip">
      {denied && (
        // role=status/aria-live gives the reason a computed accessible announcement; the action's
        // aria-describedby ties it back to the same text (HEL-1096 design.md D5 / C4).
        <div className="spine-strip__denial" role="status" aria-live="polite">
          <span id={DENIAL_REASON_ID} className="spine-strip__denial-text">
            {[...new Set(costVerdict.reasons.map(denyReasonCopy))].join(" ")}
          </span>
          {costVerdict.canRun && (
            <button
              type="button"
              className="spine-header__btn"
              aria-describedby={DENIAL_REASON_ID}
              onClick={onRunToUpdate}
            >
              Run to update
            </button>
          )}
        </div>
      )}
      {truncationNotice !== null && (
        <div className="spine-strip__banner" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{truncationNotice}</span>
        </div>
      )}
    </div>
  );
}
