import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { updatePanelAppearance } from "../features/panels/panelsSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import {
  clampTransparency,
  getColorInputValue,
  panelAppearanceEditorFallback,
  panelTextEditorFallback,
} from "../theme/appearance";
import type { Panel } from "../types/models";
import "./Popover.css";
import "./PanelAppearanceEditor.css";
import { InlineError } from "./InlineError";
import { useOverlay } from "./OverlayProvider";

interface PanelAppearanceEditorProps {
  panel: Panel;
  isOpenExternal?: boolean;
  onClose?: () => void;
}

export function PanelAppearanceEditor({
  panel,
  isOpenExternal,
  onClose,
}: PanelAppearanceEditorProps) {
  const isControlled = isOpenExternal !== undefined;
  const dispatch = useAppDispatch();
  const overlay = useOverlay();
  const isOpen = isControlled ? isOpenExternal : overlay.isActive;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  function close() {
    if (isControlled) {
      onClose?.();
    } else {
      overlay.close();
    }
  }

  const [background, setBackground] = useState(panelAppearanceEditorFallback);
  const [color, setColor] = useState(panelTextEditorFallback);
  const [transparency, setTransparency] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBackground(getColorInputValue(panel.appearance.background, panelAppearanceEditorFallback));
    setColor(getColorInputValue(panel.appearance.color, panelTextEditorFallback));
    setTransparency(Math.round(clampTransparency(panel.appearance.transparency) * 100));
    setError(null);
    overlay.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  useEffect(() => {
    if (!isControlled || !isOpenExternal) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current?.();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isControlled, isOpenExternal]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await dispatch(
        updatePanelAppearance({
          panelId: panel.id,
          appearance: {
            background,
            color,
            transparency: clampTransparency(transparency / 100),
          },
        }),
      ).unwrap();
      close();
    } catch {
      setError("Failed to save panel appearance.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="popover panel-appearance-editor">
      {!isControlled ? (
        <button
          type="button"
          className="popover__trigger panel-appearance-editor__trigger"
          onClick={() => (overlay.isActive ? overlay.close() : overlay.open())}
          aria-expanded={isOpen}
          aria-label={`Customize ${panel.title} panel`}
        >
          <span className="panel-appearance-editor__trigger-icon" aria-hidden="true">
            ✎
          </span>
        </button>
      ) : null}
      {isOpen ? <button type="button" className="popover__scrim" onClick={close} /> : null}
      {isOpen ? (
        <form className="popover__panel panel-appearance-editor__panel" onSubmit={handleSubmit}>
          <div className="panel-appearance-editor__header">
            <strong>{panel.title}</strong>
            <span>Panel appearance</span>
          </div>
          <div className="panel-appearance-editor__row">
            <label className="panel-appearance-editor__field">
              <span>Background</span>
              <input
                type="color"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
                aria-label={`${panel.title} background color`}
              />
            </label>
            <label className="panel-appearance-editor__field">
              <span>Text</span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                aria-label={`${panel.title} text color`}
              />
            </label>
          </div>
          <label className="panel-appearance-editor__slider">
            <span>Transparency</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={transparency}
              onChange={(event) => setTransparency(Number(event.target.value))}
              aria-label={`${panel.title} transparency`}
            />
            <strong>{transparency}%</strong>
          </label>
          <button type="submit" className="panel-appearance-editor__save" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save panel style"}
          </button>
          <InlineError error={error} />
        </form>
      ) : null}
    </div>
  );
}
