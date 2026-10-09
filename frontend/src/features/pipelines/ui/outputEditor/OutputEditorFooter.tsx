// The editor sheet's footer buttons (extracted verbatim from `OutputEditorSheet.tsx`).

import type { OutputPanelPlacement } from "../../types/output";

interface OutputEditorFooterProps {
  isCreate: boolean;
  confirmingDelete: boolean;
  onDeleteClick: () => void;
  placements: OutputPanelPlacement[] | null;
  saving: boolean;
  onClose: () => void;
  canAddTailWithAggregate: boolean;
  onAddTailWithAggregate: () => void;
  onSave: () => void;
}

export function OutputEditorFooter({
  isCreate,
  confirmingDelete,
  onDeleteClick,
  placements,
  saving,
  onClose,
  canAddTailWithAggregate,
  onAddTailWithAggregate,
  onSave,
}: OutputEditorFooterProps) {
  return (
    <div className="output-editor-sheet__footer">
      {!isCreate && (
        <button
          type="button"
          className="ui-modal-btn ui-modal-btn--danger output-editor-sheet__delete"
          onClick={onDeleteClick}
          disabled={saving}
        >
          {confirmingDelete
            ? `Confirm delete${placements && placements.length > 0 ? ` (removes from ${placements.length} dashboard${placements.length === 1 ? "" : "s"})` : ""}`
            : "Delete"}
        </button>
      )}
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--secondary"
        onClick={onClose}
        disabled={saving}
      >
        Cancel
      </button>
      {canAddTailWithAggregate && (
        <button
          type="button"
          className="ui-modal-btn ui-modal-btn--secondary output-editor-sheet__add-tail"
          onClick={onAddTailWithAggregate}
          disabled={saving}
        >
          {saving ? "Adding…" : "Add as tail with aggregate"}
        </button>
      )}
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--primary"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
