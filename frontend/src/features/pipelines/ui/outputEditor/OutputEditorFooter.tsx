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
  /** True while an unusable draft blocks Save: a conditional-format rule the server would reject (HEL-1307),
   *  a histogram bin-count draft (HEL-1311), or a reference-mark draft. */
  saveBlocked?: boolean;
  /** HEL-1794: a viewer sees "Close" only (no Delete, Add as tail, Save). */
  readOnly?: boolean;
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
  saveBlocked = false,
  readOnly = false,
}: OutputEditorFooterProps) {
  if (readOnly) {
    // HEL-1794: a viewer can only leave the sheet.
    return (
      <div className="output-editor-sheet__footer">
        <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
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
        disabled={saving || saveBlocked}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
