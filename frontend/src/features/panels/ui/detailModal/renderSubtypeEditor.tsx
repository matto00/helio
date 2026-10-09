import type { RefObject } from "react";

import {
  isDividerPanel,
  isFormPanel,
  isImagePanel,
  isMarkdownPanel,
  isTextPanel,
} from "../../state/panelNarrowing";
import type { Panel } from "../../types/panel";
import { DividerEditor } from "../editors/DividerEditor";
import { FormEditor } from "../editors/FormEditor";
import { ImageEditor } from "../editors/ImageEditor";
import { MarkdownEditor } from "../editors/MarkdownEditor";
import { TextContentEditor } from "../editors/TextContentEditor";
import type { PanelEditorHandle } from "../editors/editorTypes";

export function renderSubtypeEditor({
  panel,
  markdownEditorRef,
  textEditorRef,
  imageEditorRef,
  dividerEditorRef,
  formEditorRef,
  handleSubtypeDirtyChange,
}: {
  panel: Panel;
  markdownEditorRef: RefObject<PanelEditorHandle | null>;
  textEditorRef: RefObject<PanelEditorHandle | null>;
  imageEditorRef: RefObject<PanelEditorHandle | null>;
  dividerEditorRef: RefObject<PanelEditorHandle | null>;
  formEditorRef: RefObject<PanelEditorHandle | null>;
  handleSubtypeDirtyChange: (d: boolean) => void;
}) {
  if (isMarkdownPanel(panel)) {
    return (
      <MarkdownEditor
        ref={markdownEditorRef}
        panel={panel}
        onDirtyChange={handleSubtypeDirtyChange}
      />
    );
  }
  if (isTextPanel(panel)) {
    return (
      <TextContentEditor
        ref={textEditorRef}
        panel={panel}
        onDirtyChange={handleSubtypeDirtyChange}
      />
    );
  }
  if (isImagePanel(panel)) {
    return (
      <ImageEditor ref={imageEditorRef} panel={panel} onDirtyChange={handleSubtypeDirtyChange} />
    );
  }
  if (isDividerPanel(panel)) {
    return (
      <DividerEditor
        ref={dividerEditorRef}
        panel={panel}
        onDirtyChange={handleSubtypeDirtyChange}
      />
    );
  }
  if (isFormPanel(panel)) {
    return (
      <FormEditor ref={formEditorRef} panel={panel} onDirtyChange={handleSubtypeDirtyChange} />
    );
  }
  // Output-kind panels: no subtype editor — see OutputPanelSection instead;
  // every other panel kind (text/markdown/image/divider/form) renders one
  // via its own arm above.
  return null;
}
