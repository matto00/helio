// PipelineDraftNotices -- HEL-1631: what the page says about a draft that is not (yet) saved, rendered under the header by
// both layouts. One notice at a time: the base changed under the draft (only "Reload the saved pipeline": owner ruling
// `reload-only`, there is no overwrite), edits that no longer apply after a reload, a refused save (naming the step when the
// server named one), an Undo the server refused (naming the panels and alert rules that block it), and an Undo that would
// drop a newer draft.

import type { PipelinePageState } from "./spine/PipelineSpineLayout";
import "./PipelineDraftNotices.css";

export function PipelineDraftNotices({ page }: { page: PipelinePageState }) {
  const { notice, reload, dismissNotice, confirmUndoWithDraft } = page.draftSave;
  if (notice === null) return null;

  switch (notice.kind) {
    case "stale":
      return (
        <div className="draft-notice draft-notice--warning" role="alert">
          <p className="draft-notice__text">This pipeline changed since you started editing.</p>
          <div className="draft-notice__actions">
            <button type="button" className="draft-notice__btn" onClick={() => void reload()}>
              Reload the saved pipeline
            </button>
          </div>
        </div>
      );
    case "dropped":
      return (
        <div className="draft-notice" role="status">
          <p className="draft-notice__text">
            {notice.count} of your edits no longer apply: their steps are gone from the saved
            pipeline.
          </p>
          <div className="draft-notice__actions">
            <button type="button" className="draft-notice__btn" onClick={dismissNotice}>
              Dismiss
            </button>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="draft-notice draft-notice--error" role="alert">
          <p className="draft-notice__text">
            {notice.stepName !== null
              ? `Couldn't save step "${notice.stepName}": `
              : "Couldn't save: "}
            {notice.message} Your draft is still here.
          </p>
          <div className="draft-notice__actions">
            <button type="button" className="draft-notice__btn" onClick={dismissNotice}>
              Dismiss
            </button>
          </div>
        </div>
      );
    case "undoBlocked":
      return (
        <div className="draft-notice draft-notice--error" role="alert">
          <p className="draft-notice__text">Undo was refused, nothing changed: {notice.message}</p>
          <div className="draft-notice__actions">
            <button type="button" className="draft-notice__btn" onClick={dismissNotice}>
              Dismiss
            </button>
          </div>
        </div>
      );
    case "undoNeedsDiscard":
      return (
        <div className="draft-notice draft-notice--warning" role="alert">
          <p className="draft-notice__text">
            Undoing restores the earlier saved pipeline, which replaces your unsaved draft.
          </p>
          <div className="draft-notice__actions">
            <button
              type="button"
              className="draft-notice__btn"
              onClick={() => confirmUndoWithDraft(notice.applicationId)}
            >
              Discard draft and undo
            </button>
            <button type="button" className="draft-notice__btn" onClick={dismissNotice}>
              Keep editing
            </button>
          </div>
        </div>
      );
  }
}
