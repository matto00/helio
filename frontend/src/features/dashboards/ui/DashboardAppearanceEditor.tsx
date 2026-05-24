import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { updateDashboardAppearance } from "../state/dashboardsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { usePortalPopover } from "../../../hooks/usePortalPopover";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  dashboardAppearanceEditorFallback,
  dashboardGridAppearanceEditorFallback,
  getDashboardBgContrastRatio,
  getColorInputValue,
  resolveDashboardBackground,
  resolveDashboardGridBackground,
} from "../../../theme/appearance";
import { DASHBOARD_APPEARANCE_PRESETS, type DashboardAppearancePreset } from "../../../theme/theme";
import type { Dashboard } from "../types/dashboard";
import "../../../shared/chrome/Popover.css";
import "./DashboardAppearanceEditor.css";
import { InlineError } from "../../../shared/chrome/InlineError";

interface DashboardAppearanceEditorProps {
  dashboard: Dashboard | null;
}

const WCAG_AA_THRESHOLD = 4.5;

export function DashboardAppearanceEditor({ dashboard }: DashboardAppearanceEditorProps) {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
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
  const appearance = { background, gridBackground };

  // Live-preview swatches: show the resolved (blended) color for the current theme.
  // Falls back to the raw hex when the result is undefined (transparent).
  const resolvedBgPreview = resolveDashboardBackground(theme, appearance) ?? background;
  const resolvedGridBgPreview = resolveDashboardGridBackground(theme, appearance) ?? gridBackground;

  const contrastRatio = getDashboardBgContrastRatio(theme, appearance);
  const showContrastWarning = contrastRatio !== null && contrastRatio < WCAG_AA_THRESHOLD;

  const selectedPresetLabel =
    DASHBOARD_APPEARANCE_PRESETS.find(
      (p) => p.background === background && p.gridBackground === gridBackground,
    )?.label ?? null;

  function applyPreset(preset: DashboardAppearancePreset) {
    setBackground(preset.background);
    setGridBackground(preset.gridBackground);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await dispatch(
        updateDashboardAppearance({
          dashboardId,
          appearance,
        }),
      ).unwrap();
      close();
    } catch {
      setError("Failed to save dashboard appearance.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleToggle() {
    if (isOpen) {
      close();
      return;
    }
    handleOpen((rect) => ({ top: rect.bottom + 8, right: window.innerWidth - rect.right }));
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
                    style={{ backgroundColor: resolvedBgPreview }}
                  />
                  <span
                    className="dashboard-appearance-editor__swatch"
                    style={{ backgroundColor: resolvedGridBgPreview }}
                  />
                </div>
              </div>
              <div
                className="dashboard-appearance-editor__presets"
                role="group"
                aria-label="Dashboard appearance presets"
              >
                {DASHBOARD_APPEARANCE_PRESETS.map((preset) => {
                  const isSelected = selectedPresetLabel === preset.label;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`appearance-preset${isSelected ? " appearance-preset--selected" : ""}`}
                      aria-label={preset.label}
                      aria-pressed={isSelected}
                      onClick={() => applyPreset(preset)}
                    >
                      <span
                        className="appearance-preset__swatch"
                        aria-hidden="true"
                        style={{
                          background: `linear-gradient(to right, ${preset.background} 50%, ${preset.gridBackground} 50%)`,
                        }}
                      />
                      <span className="appearance-preset__label">{preset.label}</span>
                    </button>
                  );
                })}
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
              {showContrastWarning && (
                <p className="dashboard-appearance-editor__contrast-warning" role="alert">
                  Low contrast: text may be hard to read on this background.
                </p>
              )}
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
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-label="Customize dashboard appearance"
      >
        <span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>
      </button>
      {panel}
    </div>
  );
}
