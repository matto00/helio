import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { updateDashboardAppearance } from "../state/dashboardsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { usePortalPopover } from "../../../hooks/usePortalPopover";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  dashboardAppearanceEditorFallback,
  dashboardGridAppearanceEditorFallback,
  defaultDashboardAppearance,
  getDashboardBgContrastRatio,
  getColorInputValue,
  resolveDashboardBackground,
  resolveDashboardGridBackground,
} from "../../../theme/appearance";
import { DASHBOARD_APPEARANCE_PRESETS, type DashboardAppearancePreset } from "../../../theme/theme";
import type { Dashboard, DashboardAppearance } from "../types/dashboard";
import "../../../shared/chrome/Popover.css";
import "./DashboardAppearanceEditor.css";
import { InlineError } from "../../../shared/chrome/InlineError";

interface DashboardAppearanceEditorProps {
  dashboard: Dashboard | null;
  /** F-096: called with the in-popover draft appearance whenever it changes while the popover is
   *  open (preset pick or manual color edit alike), and with `null` on close/cancel — lets a
   *  parent (e.g. `App.tsx`'s shell background, `PanelList.tsx`'s grid background) live-preview an
   *  unsaved pick instead of only reflecting it after Save. */
  onPreviewChange?: (appearance: DashboardAppearance | null) => void;
}

const WCAG_AA_THRESHOLD = 4.5;

// F-098 — a synthetic "preset" that clears both fields back to the actual
// default a brand-new dashboard starts in ("transparent"), so there's a
// supported path back to no override. Deliberately local rather than added
// to `DASHBOARD_APPEARANCE_PRESETS` (theme.ts) — it isn't a color choice
// like the other 12, and this way it always renders first regardless of
// that list's own ordering.
const DEFAULT_APPEARANCE_PRESET: DashboardAppearancePreset = {
  label: "Default",
  background: defaultDashboardAppearance.background,
  gridBackground: defaultDashboardAppearance.gridBackground,
};

export function DashboardAppearanceEditor({
  dashboard,
  onPreviewChange,
}: DashboardAppearanceEditorProps) {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
  // Raw appearance values — may legitimately be "transparent", not always a
  // hex string. `getColorInputValue` is applied only where a value actually
  // feeds a native `<input type="color">` (which can't render "transparent"),
  // never to this state itself; collapsing "transparent" into a fallback hex
  // here is exactly what made F-098 impossible (Save always wrote a color).
  const [background, setBackground] = useState<string>(defaultDashboardAppearance.background);
  const [gridBackground, setGridBackground] = useState<string>(
    defaultDashboardAppearance.gridBackground,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Discards any unsaved preset/color pick and reverts to the dashboard's
  // actually-saved appearance.
  const resetDraftAppearance = useCallback(() => {
    setBackground(dashboard?.appearance.background ?? defaultDashboardAppearance.background);
    setGridBackground(
      dashboard?.appearance.gridBackground ?? defaultDashboardAppearance.gridBackground,
    );
    setError(null);
  }, [dashboard]);

  useEffect(() => {
    resetDraftAppearance();
    close();
  }, [resetDraftAppearance, close]);

  // F-030 — also reset on close itself (Escape, scrim click, or the trigger
  // toggle), not only when `dashboard` changes. Without this, dismissing the
  // popover without saving left the draft pick in place, so it reappeared as
  // "selected" the next time the popover reopened even though nothing had
  // actually been saved.
  useEffect(() => {
    if (!isOpen) {
      resetDraftAppearance();
    }
  }, [isOpen, resetDraftAppearance]);

  // F-096: live-preview the in-popover draft (preset pick or manual color edit) up to any parent
  // that wants to reflect it before Save — e.g. the app shell background, the panel grid
  // background. Reports `null` once the popover closes so the preview reverts to the dashboard's
  // actually-saved appearance.
  useEffect(() => {
    if (!onPreviewChange) return;
    onPreviewChange(isOpen ? { background, gridBackground } : null);
  }, [onPreviewChange, isOpen, background, gridBackground]);

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

  // Default first, then the 12 color presets (F-098).
  const presetsWithDefault = [DEFAULT_APPEARANCE_PRESET, ...DASHBOARD_APPEARANCE_PRESETS];

  const selectedPresetLabel =
    presetsWithDefault.find(
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
                {presetsWithDefault.map((preset) => {
                  const isSelected = selectedPresetLabel === preset.label;
                  const isDefault = preset === DEFAULT_APPEARANCE_PRESET;
                  // F-200: resolve each preset through the theme (the same functions the header
                  // preview swatches already use above) before painting the button swatch, so it
                  // agrees with the header preview and with what the dashboard actually renders
                  // after applying the preset, instead of showing the raw picker hex.
                  const resolvedPresetBg =
                    resolveDashboardBackground(theme, {
                      background: preset.background,
                      gridBackground: preset.gridBackground,
                    }) ?? preset.background;
                  const resolvedPresetGridBg =
                    resolveDashboardGridBackground(theme, {
                      background: preset.background,
                      gridBackground: preset.gridBackground,
                    }) ?? preset.gridBackground;
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
                        // The Default swatch is left unfilled (no gradient) so its
                        // ring border alone reads as "no color", instead of showing
                        // a gradient of the literal (invisible) "transparent" value.
                        style={
                          isDefault
                            ? undefined
                            : {
                                background: `linear-gradient(to right, ${resolvedPresetBg} 50%, ${resolvedPresetGridBg} 50%)`,
                              }
                        }
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
                  value={getColorInputValue(background, dashboardAppearanceEditorFallback)}
                  onChange={(event) => setBackground(event.target.value)}
                  aria-label="Dashboard background color"
                />
              </label>
              <label className="dashboard-appearance-editor__field">
                <span>Grid background</span>
                <input
                  type="color"
                  value={getColorInputValue(gridBackground, dashboardGridAppearanceEditorFallback)}
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
