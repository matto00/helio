import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { updateDashboardAppearance } from "../features/dashboards/dashboardsSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import {
  dashboardAppearanceEditorFallback,
  dashboardGridAppearanceEditorFallback,
  getColorInputValue,
} from "../theme/appearance";
import type { Dashboard } from "../types/models";
import "./Popover.css";
import "./DashboardAppearanceEditor.css";
import { InlineError } from "./InlineError";
import { useOverlay } from "./OverlayProvider";

interface DashboardAppearanceEditorProps {
  dashboard: Dashboard | null;
}

export function DashboardAppearanceEditor({ dashboard }: DashboardAppearanceEditorProps) {
  const dispatch = useAppDispatch();
  const { isActive: isOpen, open, close } = useOverlay();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const [background, setBackground] = useState(dashboardAppearanceEditorFallback);
  const [gridBackground, setGridBackground] = useState(dashboardGridAppearanceEditorFallback);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBackground(
      getColorInputValue(
        dashboard?.appearance.background ?? "transparent",
        dashboardAppearanceEditorFallback,
      ),
    );
    setGridBackground(
      getColorInputValue(
        dashboard?.appearance.gridBackground ?? "transparent",
        dashboardGridAppearanceEditorFallback,
      ),
    );
    setError(null);
    close();
  }, [dashboard, close]);

  if (dashboard === null) {
    return null;
  }

  const dashboardId = dashboard.id;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await dispatch(
        updateDashboardAppearance({
          dashboardId,
          appearance: {
            background,
            gridBackground,
          },
        }),
      ).unwrap();
      close();
    } catch {
      setError("Failed to save dashboard appearance.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleOpen() {
    if (isOpen) {
      close();
      return;
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    open();
  }

  const panel =
    isOpen && panelPos
      ? createPortal(
          <>
            <button type="button" className="popover__scrim" onClick={close} />
            <form
              className="popover__panel"
              onSubmit={handleSubmit}
              style={{ position: "fixed", top: panelPos.top, right: panelPos.right, left: "auto" }}
            >
              <div className="dashboard-appearance-editor__header">
                <div>
                  <span className="dashboard-appearance-editor__label">Dashboard appearance</span>
                  <strong>{dashboard.name}</strong>
                </div>
                <div className="dashboard-appearance-editor__swatches" aria-hidden="true">
                  <span
                    className="dashboard-appearance-editor__swatch"
                    style={{ backgroundColor: background }}
                  />
                  <span
                    className="dashboard-appearance-editor__swatch"
                    style={{ backgroundColor: gridBackground }}
                  />
                </div>
              </div>
              <label className="dashboard-appearance-editor__field">
                <span>Window background</span>
                <input
                  type="color"
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                  aria-label="Dashboard background color"
                />
              </label>
              <label className="dashboard-appearance-editor__field">
                <span>Grid background</span>
                <input
                  type="color"
                  value={gridBackground}
                  onChange={(event) => setGridBackground(event.target.value)}
                  aria-label="Dashboard grid background color"
                />
              </label>
              <button
                type="submit"
                className="dashboard-appearance-editor__save"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save dashboard style"}
              </button>
              <InlineError error={error} />
            </form>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="popover dashboard-appearance-editor">
      <button
        ref={triggerRef}
        type="button"
        className="popover__trigger dashboard-appearance-editor__trigger"
        onClick={handleOpen}
        aria-expanded={isOpen}
        aria-label="Customize dashboard appearance"
      >
        <span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>
      </button>
      {panel}
    </div>
  );
}
