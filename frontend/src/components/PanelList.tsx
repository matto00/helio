import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import "./PanelList.css";
import { defaultDashboardLayout } from "../features/dashboards/dashboardLayout";
import { updateUserPreferences } from "../features/auth/authSlice";
import { createPanel } from "../features/panels/panelsSlice";
import { PanelGrid } from "./PanelGrid";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { InlineError } from "./InlineError";
import { StatusMessage } from "./StatusMessage";
import { resolveDashboardGridBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import type { PanelType } from "../types/models";

const PANEL_TYPES: { value: PanelType; label: string }[] = [
  { value: "metric", label: "Metric" },
  { value: "chart", label: "Chart" },
  { value: "text", label: "Text" },
  { value: "table", label: "Table" },
  { value: "markdown", label: "Markdown" },
  { value: "image", label: "Image" },
];
export function PanelList() {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const { items: dashboards, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { items, status, error } = useAppSelector((state) => state.panels);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [title, setTitle] = useState("");
  const [panelType, setPanelType] = useState<PanelType>("metric");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDashboard =
    dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;

  // Restore zoom level from user preferences when dashboard changes
  useEffect(() => {
    if (selectedDashboardId && currentUser?.preferences?.zoomLevels) {
      const savedZoom = currentUser.preferences.zoomLevels[selectedDashboardId];
      setZoomLevel(savedZoom ?? 1.0);
    } else {
      setZoomLevel(1.0);
    }
  }, [selectedDashboardId, currentUser?.preferences?.zoomLevels]);

  async function handleCreatePanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedDashboardId === null) {
      return;
    }

    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await dispatch(
        createPanel({ dashboardId: selectedDashboardId, title: normalizedTitle, type: panelType }),
      ).unwrap();
      setTitle("");
      setPanelType("metric");
      setIsCreateMode(false);
    } catch {
      setCreateError("Failed to create panel.");
    } finally {
      setIsCreating(false);
    }
  }

  const handleZoomChange = useCallback(
    (delta: number) => {
      if (!selectedDashboardId) {
        return;
      }
      const newZoom = Math.min(2.0, Math.max(0.5, zoomLevel + delta));
      setZoomLevel(newZoom);
      dispatch(
        updateUserPreferences({
          fields: ["zoomLevel"],
          user: { zoomLevel: newZoom, dashboardId: selectedDashboardId },
        }),
      );
    },
    [selectedDashboardId, zoomLevel, dispatch],
  );

  function handleZoomReset() {
    if (!selectedDashboardId) {
      return;
    }
    setZoomLevel(1.0);
    dispatch(
      updateUserPreferences({
        fields: ["zoomLevel"],
        user: { zoomLevel: 1.0, dashboardId: selectedDashboardId },
      }),
    );
  }

  // Ctrl+scroll and trackpad-pinch zoom gesture handler.
  // React registers onWheel as passive since React 17, so a native listener
  // with { passive: false } is required to call preventDefault() and suppress
  // OS/browser default zoom behaviour.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      // Normalize for deltaMode: DOM_DELTA_PIXEL=0, DOM_DELTA_LINE=1, DOM_DELTA_PAGE=2
      const normalizedDelta =
        event.deltaMode === 1
          ? event.deltaY * 24
          : event.deltaMode === 2
            ? event.deltaY * 600
            : event.deltaY;

      // Snap to nearest 0.1 zoom step (100 px ≡ 1 step of 0.1).
      // Positive deltaY = scroll down = zoom out, so negate.
      const snappedDelta = -(Math.round(normalizedDelta / 100) / 10);

      if (snappedDelta !== 0) {
        handleZoomChange(snappedDelta);
      }
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleZoomChange]);

  return (
    <section
      className="panel-list"
      aria-label="panels"
      style={
        selectedDashboard?.appearance.gridBackground &&
        selectedDashboard.appearance.gridBackground !== "transparent"
          ? ({
              "--dashboard-grid-background-override": resolveDashboardGridBackground(
                theme,
                selectedDashboard.appearance,
              ),
            } as CSSProperties)
          : undefined
      }
    >
      <header className="panel-list__header">
        <div className="panel-list__header-actions">
          <span className="panel-list__count">
            {items.length} panel{items.length === 1 ? "" : "s"}
          </span>
          {selectedDashboardId ? (
            <div className="panel-list__zoom-controls">
              <button
                type="button"
                className="panel-list__zoom-button"
                aria-label="Zoom out"
                onClick={() => handleZoomChange(-0.1)}
                disabled={zoomLevel <= 0.5}
              >
                −
              </button>
              <span className="panel-list__zoom-level">{Math.round(zoomLevel * 100)}%</span>
              <button
                type="button"
                className="panel-list__zoom-button"
                aria-label="Zoom in"
                onClick={() => handleZoomChange(0.1)}
                disabled={zoomLevel >= 2.0}
              >
                +
              </button>
              <button
                type="button"
                className="panel-list__zoom-reset"
                aria-label="Reset zoom"
                onClick={handleZoomReset}
                disabled={zoomLevel === 1.0}
              >
                Reset
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="panel-list__add"
            aria-label={isCreateMode ? "Cancel panel create" : "Add panel"}
            onClick={() => {
              setIsCreateMode((open) => !open);
              setCreateError(null);
              setPanelType("metric");
            }}
            disabled={selectedDashboardId === null}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>
      {isCreateMode ? (
        <form className="panel-list__create" onSubmit={handleCreatePanel}>
          <label className="panel-list__create-label" htmlFor="panel-create-title">
            Panel title
          </label>
          <input
            id="panel-create-title"
            className="panel-list__create-input"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Revenue Pulse"
            aria-label="Panel title"
            autoFocus
          />
          <fieldset className="panel-list__type-selector">
            <legend className="panel-list__create-label">Panel type</legend>
            {PANEL_TYPES.map(({ value, label }) => (
              <label key={value} className="panel-list__type-option">
                <input
                  type="radio"
                  name="panel-type"
                  value={value}
                  checked={panelType === value}
                  onChange={() => setPanelType(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            className="panel-list__create-submit"
            disabled={isCreating || selectedDashboardId === null || title.trim().length === 0}
          >
            {isCreating ? "Creating..." : "Create panel"}
          </button>
          <InlineError error={createError} />
        </form>
      ) : null}
      <StatusMessage
        status={status}
        message={status === "loading" ? "Loading panels..." : (error ?? undefined)}
      />
      {status !== "loading" && status !== "failed" && selectedDashboardId === null ? (
        <p className="panel-list__state">Select a dashboard to view panels.</p>
      ) : null}
      {status === "succeeded" && items.length === 0 && !isCreateMode ? (
        <div className="panel-list__empty-state">
          <img
            className="panel-list__empty-icon"
            src="/empty-panel-grid.svg"
            alt=""
            aria-hidden="true"
          />
          <h3 className="panel-list__empty-heading">No panels yet</h3>
          <p className="panel-list__empty-subtext">Add a panel to start building your dashboard</p>
          <button
            type="button"
            className="panel-list__empty-cta"
            onClick={() => setIsCreateMode(true)}
            disabled={selectedDashboardId === null}
          >
            Add panel
          </button>
        </div>
      ) : null}
      {items.length > 0 && selectedDashboardId !== null ? (
        <div
          ref={containerRef}
          className="panel-list__zoom-container"
          style={
            {
              "--zoom-level": zoomLevel,
              transform: `scale(${zoomLevel})`,
              transformOrigin: "top left",
              height: `${100 / zoomLevel}%`,
              width: `${100 / zoomLevel}%`,
            } as CSSProperties
          }
        >
          <PanelGrid
            key={selectedDashboardId}
            dashboardId={selectedDashboardId}
            layout={selectedDashboard?.layout ?? defaultDashboardLayout}
            panels={items}
            zoomLevel={zoomLevel}
          />
        </div>
      ) : null}
    </section>
  );
}
