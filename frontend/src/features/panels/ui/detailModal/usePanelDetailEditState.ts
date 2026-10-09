import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isDividerPanel,
  isFormPanel,
  isImagePanel,
  isMarkdownPanel,
  isOutputPanel,
  isTextPanel,
} from "../../state/panelNarrowing";
import { clampTransparency } from "../../../../theme/appearance";
import type { ChartAppearance, Panel } from "../../types/panel";
import type { PanelEditorHandle } from "../editors/editorTypes";
import { buildInitialChart } from "./panelDetailChartState";

export function usePanelDetailEditState(panel: Panel, initialMode: "view" | "edit") {
  // Modal mode: "view" is the default on open; "edit" shows the unified settings form
  const [modalMode, setModalMode] = useState<"view" | "edit">(initialMode);

  // Background / color hold the RAW appearance value — which may be a sentinel
  // (`"transparent"` / `"inherit"`), not the display-fallback hex. They are only
  // resolved to a color-input-safe hex at the `<AppearanceEditor>` prop boundary.
  // The native `<input type="color">` onChange always emits a 6-digit hex, so an
  // untouched field keeps its raw sentinel while an edited field is overwritten
  // with the chosen hex — and the save payload is built from state directly. This
  // preserves an untouched sentinel through save (HEL-322).
  const initialTitle = panel.title;
  const initialBackground = panel.appearance.background;
  const initialColor = panel.appearance.color;
  const initialTransparency = Math.round(clampTransparency(panel.appearance.transparency) * 100);
  const initialChart = useMemo(() => buildInitialChart(panel), [panel]);

  const [title, setTitle] = useState(initialTitle);
  const [background, setBackground] = useState(initialBackground);
  const [color, setColor] = useState(initialColor);
  const [transparency, setTransparency] = useState(initialTransparency);
  const [chartAppearance, setChartAppearance] = useState<ChartAppearance>(initialChart);

  // ── Subtype editor refs (only one is mounted at a time, content-kind
  //    panels only — an output-kind panel has no CONTENT subtype editor, see
  //    `OutputPanelSection.tsx`; `form` is a content-kind panel too —
  //    HEL-1084 — and follows the same one-ref-per-kind pattern). HEL-1189:
  //    `controlsEditorRef` is a SIBLING slot, not part of this if-chain — an
  //    output panel has no content editor but DOES have the controls editor,
  //    rendered alongside `OutputPanelSection` in `PanelDetailModal.tsx`, so it needs its OWN ref
  //    threaded into save/reset independently of `activeEditorRef()`. ─
  const markdownEditorRef = useRef<PanelEditorHandle | null>(null);
  const textEditorRef = useRef<PanelEditorHandle | null>(null);
  const imageEditorRef = useRef<PanelEditorHandle | null>(null);
  const dividerEditorRef = useRef<PanelEditorHandle | null>(null);
  const formEditorRef = useRef<PanelEditorHandle | null>(null);
  const controlsEditorRef = useRef<PanelEditorHandle | null>(null);

  function activeEditorRef(): RefObject<PanelEditorHandle | null> | null {
    if (isMarkdownPanel(panel)) return markdownEditorRef;
    if (isTextPanel(panel)) return textEditorRef;
    if (isImagePanel(panel)) return imageEditorRef;
    if (isDividerPanel(panel)) return dividerEditorRef;
    if (isFormPanel(panel)) return formEditorRef;
    if (isOutputPanel(panel)) return controlsEditorRef;
    return null;
  }

  const [isSaving, setIsSaving] = useState(false);
  const [subtypeDirty, setSubtypeDirty] = useState(false);
  const handleSubtypeDirtyChange = useCallback((d: boolean) => {
    setSubtypeDirty(d);
  }, []);

  const [showDiscardWarning, setShowDiscardWarning] = useState(false);

  const appearanceDirty =
    title !== initialTitle ||
    background !== initialBackground ||
    color !== initialColor ||
    transparency !== initialTransparency;

  const isAnyDirty = appearanceDirty || subtypeDirty;

  const resetFormToPanel = useCallback(() => {
    setTitle(panel.title);
    setBackground(panel.appearance.background);
    setColor(panel.appearance.color);
    setTransparency(Math.round(clampTransparency(panel.appearance.transparency) * 100));
    setChartAppearance(buildInitialChart(panel));
    activeEditorRef()?.current?.reset();
    // activeEditorRef is recomputed inside the effect; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // F-303/HEL-716 — the E-key edit-mode shortcut is unrelated to close
  // semantics, so it's a plain document-scoped listener gated on the
  // component's mounted lifetime (equivalent to the old dialog-scoped
  // listener, since focus is always trapped inside the open dialog).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (modalMode !== "view") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "e" || e.key === "E") {
        setModalMode("edit");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalMode]);
  return {
    modalMode,
    setModalMode,
    initialTitle,
    title,
    setTitle,
    background,
    setBackground,
    color,
    setColor,
    transparency,
    setTransparency,
    chartAppearance,
    setChartAppearance,
    markdownEditorRef,
    textEditorRef,
    imageEditorRef,
    dividerEditorRef,
    formEditorRef,
    controlsEditorRef,
    activeEditorRef,
    isSaving,
    setIsSaving,
    subtypeDirty,
    handleSubtypeDirtyChange,
    showDiscardWarning,
    setShowDiscardWarning,
    isAnyDirty,
    resetFormToPanel,
  };
}
