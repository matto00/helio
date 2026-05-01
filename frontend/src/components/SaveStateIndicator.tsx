import { useAppSelector } from "../hooks/reduxHooks";
import { useRelativeTime } from "../hooks/useRelativeTime";
import "./SaveStateIndicator.css";

interface SaveStateIndicatorProps {
  onSaveNow: () => void;
}

export function SaveStateIndicator({ onSaveNow }: SaveStateIndicatorProps) {
  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  const lastSavedAt = useAppSelector((state) => state.panels.lastSavedAt);
  const relativeTime = useRelativeTime(lastSavedAt);

  const isDirty = Object.keys(pendingPanelUpdates).length > 0;

  function handleSaveNow() {
    if (!isDirty) return;
    onSaveNow();
  }

  return (
    <div className="save-state-indicator">
      <span className="save-state-indicator__label">
        {isDirty ? "Unsaved changes" : lastSavedAt !== null ? `Last saved ${relativeTime}` : null}
      </span>
      <button
        type="button"
        className="save-state-indicator__save-now"
        onClick={handleSaveNow}
        aria-label="Save now"
      >
        Save now
      </button>
    </div>
  );
}
