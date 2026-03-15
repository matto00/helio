import type { FormEvent } from "react";
import { useEffect, useState } from "react";

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

interface DashboardAppearanceEditorProps {
  dashboard: Dashboard | null;
}

export function DashboardAppearanceEditor({ dashboard }: DashboardAppearanceEditorProps) {
  const dispatch = useAppDispatch();
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(false);
  }, [dashboard]);

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
      setIsOpen(false);
    } catch {
      setError("Failed to save dashboard appearance.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="popover dashboard-appearance-editor">
      <button
        type="button"
        className="popover__trigger dashboard-appearance-editor__trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label="Customize dashboard appearance"
      >
        <span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>
      </button>
      {isOpen ? (
        <button type="button" className="popover__scrim" onClick={() => setIsOpen(false)} />
      ) : null}
      {isOpen ? (
        <form className="popover__panel" onSubmit={handleSubmit}>
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
          <button type="submit" className="dashboard-appearance-editor__save" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save dashboard style"}
          </button>
          <InlineError error={error} />
        </form>
      ) : null}
    </div>
  );
}
