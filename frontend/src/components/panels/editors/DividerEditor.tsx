import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { Select, TextField } from "../../ui";
import { updatePanelDivider } from "../../../features/panels/panelsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { DividerOrientation, DividerPanel } from "../../../types/models";
import { InlineError } from "../../InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

interface DividerEditorProps {
  panel: DividerPanel;
  onDirtyChange: DirtyChangeCallback;
}

function coerceOrientation(value: string): DividerOrientation {
  return value === "vertical" ? "vertical" : "horizontal";
}

export const DividerEditor = forwardRef<PanelEditorHandle, DividerEditorProps>(
  function DividerEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const initialOrientation: DividerOrientation = coerceOrientation(panel.config.orientation);
    const initialWeight = panel.config.weight ?? 1;
    const initialColor = panel.config.color ?? "#cccccc";
    const initialColorStored = panel.config.color ?? null;

    const [orientation, setOrientation] = useState<DividerOrientation>(initialOrientation);
    const [weight, setWeight] = useState(initialWeight);
    const [color, setColor] = useState(initialColor);
    const [saveError, setSaveError] = useState<string | null>(null);

    const dirty =
      orientation !== initialOrientation || weight !== initialWeight || color !== initialColor;

    useEffect(() => {
      onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          setOrientation(initialOrientation);
          setWeight(initialWeight);
          setColor(initialColor);
          setSaveError(null);
        },
        save: async () => {
          if (!dirty) return { ok: true };
          // Preserve the null-color sentinel so the CSS design-token default
          // is kept in the DB on a no-op color edit (the picker can't render
          // null so we infer "still default" via equality with #cccccc when
          // the stored value is null).
          const resolvedColor = initialColorStored === null && color === "#cccccc" ? null : color;
          try {
            await dispatch(
              updatePanelDivider({
                panelId: panel.id,
                dividerOrientation: orientation,
                dividerWeight: weight,
                dividerColor: resolvedColor,
              }),
            ).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save divider settings.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [
        color,
        dirty,
        dispatch,
        initialColor,
        initialColorStored,
        initialOrientation,
        initialWeight,
        orientation,
        panel.id,
        weight,
      ],
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Divider</h3>
        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="divider-orientation">
            Orientation
          </label>
          <Select
            ariaLabel="Divider orientation"
            value={orientation}
            onChange={(v) => setOrientation(coerceOrientation(v))}
            options={[
              { value: "horizontal", label: "Horizontal" },
              { value: "vertical", label: "Vertical" },
            ]}
          />
        </div>
        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="divider-weight">
            Weight (px)
          </label>
          <TextField
            id="divider-weight"
            type="number"
            min={1}
            max={100}
            value={weight}
            onChange={(e) => setWeight(Math.max(1, Number(e.target.value)))}
            aria-label="Divider weight"
          />
        </div>
        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="divider-color">
            Color
          </label>
          <input
            id="divider-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Divider color"
          />
        </div>
        <InlineError error={saveError} />
      </>
    );
  },
);
