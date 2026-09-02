// Text panel's Content editor (HEL-909: literal-only — the Source/bound
// mode was stripped along with the retired DataType-field-mapping model per
// design.md's explicit resolution; a Text panel is dashboard-native and
// carries no Output).

import { forwardRef, useImperativeHandle, useState } from "react";

import { updatePanelTextContent } from "../../state/panelsSlice";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import type { TextPanel } from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";
import { Textarea } from "../../../../shared/ui/index";

interface TextContentEditorProps {
  panel: TextPanel;
  onDirtyChange: DirtyChangeCallback;
}

export const TextContentEditor = forwardRef<PanelEditorHandle, TextContentEditorProps>(
  function TextContentEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const initialContent = panel.config.content;
    const [content, setContent] = useState(initialContent);
    const [saveError, setSaveError] = useState<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          setContent(initialContent);
          setSaveError(null);
        },
        save: async () => {
          if (content === initialContent) return { ok: true };
          try {
            await dispatch(updatePanelTextContent({ panelId: panel.id, content })).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save content.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [content, dispatch, initialContent, panel.id],
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Content</h3>
        <div className="panel-detail-modal__data-section">
          <Textarea
            aria-label="Content"
            value={content}
            onChange={(e) => {
              const v = e.target.value;
              setContent(v);
              onDirtyChange(v !== initialContent);
            }}
            placeholder="Write your text here…"
          />
        </div>
        <InlineError error={saveError} />
      </>
    );
  },
);
