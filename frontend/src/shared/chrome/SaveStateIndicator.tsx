import { useAppSelector } from "../../hooks/reduxHooks";
import { useRelativeTime } from "../../hooks/useRelativeTime";
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

  return (
    <div className="save-state-indicator">
      <span className="save-state-indicator__label">
        {isDirty ? "Unsaved changes" : lastSavedAt !== null ? `Last saved ${relativeTime}` : null}
      </span>
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
