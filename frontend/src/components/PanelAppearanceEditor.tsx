import type { FormEvent } from "react";
import { useEffect, useState } from "react";

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

interface PanelAppearanceEditorProps {
  panel: Panel;
}

export function PanelAppearanceEditor({ panel }: PanelAppearanceEditorProps) {
  const dispatch = useAppDispatch();
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(false);
  }, [panel]);

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
      setIsOpen(false);
    } catch {
      setError("Failed to save panel appearance.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="popover panel-appearance-editor">
      <button
        type="button"
        className="popover__trigger panel-appearance-editor__trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={`Customize ${panel.title} panel`}
      >
        <span className="panel-appearance-editor__trigger-icon" aria-hidden="true">
          ✎
        </span>
      </button>
      {isOpen ? (
        <button type="button" className="popover__scrim" onClick={() => setIsOpen(false)} />
      ) : null}
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
          {error ? <p className="panel-appearance-editor__error">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
