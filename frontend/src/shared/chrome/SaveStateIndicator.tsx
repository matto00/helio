import { Check } from "lucide-react";

import { useAppSelector } from "../../hooks/reduxHooks";
import { useRelativeTime } from "../../hooks/useRelativeTime";
import "../motion/motion.css";
import { useOneShotOnChange } from "../motion/useOneShot";
import { ICON_SIZE } from "../ui/iconSize";
import "./SaveStateIndicator.css";

interface SaveStateIndicatorProps {
  onSaveNow: () => void;
}

export function SaveStateIndicator({ onSaveNow }: SaveStateIndicatorProps) {
  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  const hasPendingLayout = useAppSelector((state) => state.dashboards.hasPendingLayout);
  const lastSavedAt = useAppSelector((state) => state.panels.lastSavedAt);
  const relativeTime = useRelativeTime(lastSavedAt);

  const isDirty = Object.keys(pendingPanelUpdates).length > 0 || hasPendingLayout;

  // HEL-1584 D11a: a check pops in beside the state when a save SUCCEEDS while this indicator is on screen. It is keyed to
  // the success counters, not to "became clean": an undo back to the saved layout, a server re-baseline and a discarded
  // staged drag all clear the dirty state without a save and must not claim one. It stays until the next unsaved change
  // (no timer, so no literal duration). The counters are global: a flush save of dashboard A that settles after a switch to B
  // shows the check on B's indicator, which is accepted (a save did just succeed).
  const saves = useAppSelector(
    (state) => (state.dashboards.layoutSaveSeq ?? 0) + (state.panels.panelSaveSeq ?? 0),
  );
  const { active: saved, done } = useOneShotOnChange(saves, (next, previous) => next > previous);
  // The next unsaved change ends the cue, so becoming clean again without a save (an undo) cannot bring the check back.
  if (isDirty && saved) done();

  return (
    <div className="save-state-indicator">
      <span className="save-state-indicator__label">
        {isDirty ? "Unsaved changes" : lastSavedAt !== null ? `Last saved ${relativeTime}` : null}
      </span>
      {saved && !isDirty && (
        <span className="save-state-indicator__check motion-pop" role="img" aria-label="Saved">
          <Check size={ICON_SIZE.sm} aria-hidden="true" />
        </span>
      )}
      {/* F-054/F-077: "Save now" used to always render at opacity:0, revealed
          only on hover — an invisible first Tab stop, unreachable on touch,
          and it still reserved ~90px in the phone command bar (crowding out
          the dashboard-switcher title down to "Reve…"). It's only rendered
          — visible and reachable — when there's actually something to save. */}
      {isDirty && (
        <button
          type="button"
          className="save-state-indicator__save-now cmd-btn"
          onClick={onSaveNow}
          aria-label="Save now"
        >
          Save now
        </button>
      )}
    </div>
  );
}
