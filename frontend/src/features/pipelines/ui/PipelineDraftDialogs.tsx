// PipelineDraftDialogs -- HEL-1631: the two dialogs a draft can open, rendered as a sibling of the layout (like the other page
// dialogs) so crossing the phone boundary does not lose them. The cascade confirmation lists everything the save would remove
// (steps, Outputs, bound panels and alert rules) and saves only on confirm; the leave guard asks before an in-app link drops
// the draft.

import { Modal } from "../../../shared/ui/Modal";
import { useDraftLeaveGuard } from "../hooks/useDraftLeaveGuard";
import type { PipelinePageState } from "./spine/PipelineSpineLayout";
import "./PipelineDraftNotices.css";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PipelineDraftDialogs({ page }: { page: PipelinePageState }) {
  const { cascade, confirmCascade, cancelCascade, saving } = page.draftSave;
  const { hasDraft, discard } = page.draft;
  const { leaveRequested, confirmLeave, stay } = useDraftLeaveGuard(hasDraft, discard);

  return (
    <>
      {cascade !== null && (
        <Modal
          open
          size="sm"
          title="This save removes other things"
          description="Confirm to save the draft and remove everything listed here."
          ariaLabel="Confirm removals"
          onClose={cancelCascade}
          footer={
            <>
              <button
                type="button"
                className="ui-modal-btn ui-modal-btn--secondary"
                onClick={cancelCascade}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="ui-modal-btn ui-modal-btn--danger"
                disabled={saving}
                onClick={() => void confirmCascade()}
              >
                Remove and save
              </button>
            </>
          }
        >
          <ul className="draft-cascade__list">
            {cascade.stepNames.map((name, i) => (
              <li key={`step-${cascade.impact.stepIds[i]}`}>Step: {name}</li>
            ))}
            {cascade.outputNames.map((name, i) => (
              <li key={`output-${cascade.impact.outputIds[i]}`}>Output: {name}</li>
            ))}
            {cascade.impact.panelIds.length > 0 && (
              <li>
                {count(cascade.impact.panelIds.length, "panel", "panels")} bound to those Outputs
              </li>
            )}
            {cascade.impact.alertRuleIds.length > 0 && (
              <li>
                {count(cascade.impact.alertRuleIds.length, "alert rule", "alert rules")} on those
                Outputs
              </li>
            )}
          </ul>
        </Modal>
      )}

      {leaveRequested && (
        <Modal
          open
          size="sm"
          title="Discard your draft?"
          description="Your unsaved changes to this pipeline will be lost."
          ariaLabel="Discard your draft"
          onClose={stay}
          footer={
            <>
              <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={stay}>
                Keep editing
              </button>
              <button
                type="button"
                className="ui-modal-btn ui-modal-btn--danger"
                onClick={confirmLeave}
              >
                Discard draft
              </button>
            </>
          }
        >
          <p className="draft-cascade__hint">Save &amp; run keeps them.</p>
        </Modal>
      )}
    </>
  );
}
