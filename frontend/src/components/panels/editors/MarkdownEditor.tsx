import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { Textarea } from "../../ui";
import { updatePanelContent } from "../../../features/panels/panelsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { MarkdownPanel } from "../../../types/models";
import { InlineError } from "../../InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

interface MarkdownEditorProps {
  panel: MarkdownPanel;
  onDirtyChange: DirtyChangeCallback;
}

export const MarkdownEditor = forwardRef<PanelEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const initialContent = panel.config.content;
    const [content, setContent] = useState(initialContent);
    const [saveError, setSaveError] = useState<string | null>(null);

    const dirty = content !== initialContent;

    useEffect(() => {
      onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          setContent(initialContent);
          setSaveError(null);
        },
        save: async () => {
          if (!dirty) return { ok: true };
          try {
            await dispatch(updatePanelContent({ panelId: panel.id, content })).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save content.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [content, dirty, dispatch, initialContent, panel.id],
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Content</h3>
        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="markdown-content">
            Markdown content
          </label>
          <Textarea
            id="markdown-content"
            className="panel-detail-modal__markdown-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Markdown content"
            placeholder="# Hello&#10;Write your markdown here…"
            rows={12}
          />
        </div>
        <InlineError error={saveError} />
      </>
    );
  },
);
