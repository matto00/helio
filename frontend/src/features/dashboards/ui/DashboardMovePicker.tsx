import type { DashboardFolder } from "../types/dashboardFolder";

interface DashboardMovePickerProps {
  folders: DashboardFolder[];
  /** The folder the dashboard is in now, or null when unfiled. */
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onCancel: () => void;
}

/** "Move to..." for one dashboard: every folder plus Unfiled, as plain buttons under the row so it is operable by
 *  keyboard. The current location is marked and disabled. */
export function DashboardMovePicker({
  folders,
  currentFolderId,
  onPick,
  onCancel,
}: DashboardMovePickerProps) {
  const targets: { id: string | null; label: string }[] = [
    ...folders.map((folder) => ({ id: folder.id, label: folder.name })),
    { id: null, label: "Unfiled" },
  ];
  return (
    <div className="dashboard-list__move" role="group" aria-label="Move to">
      <span className="dashboard-list__move-title">Move to</span>
      {targets.map((target) => (
        <button
          key={target.id ?? "unfiled"}
          type="button"
          className="dashboard-list__move-option"
          aria-pressed={target.id === currentFolderId}
          disabled={target.id === currentFolderId}
          onClick={() => onPick(target.id)}
        >
          {target.label}
        </button>
      ))}
      <button type="button" className="dashboard-list__delete-cancel-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
