import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import "./PanelList.css";
import { defaultDashboardLayout } from "../features/dashboards/dashboardLayout";
import { updateUserPreferences } from "../features/auth/authSlice";
import { PanelGrid } from "./PanelGrid";
import { PanelCreationModal } from "./PanelCreationModal";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { StatusMessage } from "./StatusMessage";
import { resolveDashboardGridBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";

export function PanelList() {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const { items: dashboards, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { items, status, error } = useAppSelector((state) => state.panels);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDashboard =
    dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;

  const savedZoomLevel =
    selectedDashboardId && currentUser?.preferences?.zoomLevels
      ? (currentUser.preferences.zoomLevels[selectedDashboardId] ?? 1.0)
      : 1.0;

  const [localZoomOverride, setLocalZoomOverride] = useState<{
    dashboardId: string | null;
    value: number;
  } | null>(null);

  const zoomLevel =
    localZoomOverride?.dashboardId === selectedDashboardId
      ? localZoomOverride.value
      : savedZoomLevel;

  const handleZoomChange = useCallback(
    (delta: number) => {
      if (!selectedDashboardId) {
        return;
      }
      const newZoom = Math.min(2.0, Math.max(0.5, zoomLevel + delta));
      setLocalZoomOverride({ dashboardId: selectedDashboardId, value: newZoom });
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
    setLocalZoomOverride({ dashboardId: selectedDashboardId, value: 1.0 });
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
            aria-label="Add panel"
            onClick={() => setIsModalOpen(true)}
            disabled={selectedDashboardId === null}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>
      {isModalOpen ? <PanelCreationModal onClose={() => setIsModalOpen(false)} /> : null}
      <StatusMessage
        status={status}
        message={status === "loading" ? "Loading panels..." : (error ?? undefined)}
      />
      {status !== "loading" && status !== "failed" && selectedDashboardId === null ? (
        <p className="panel-list__state">Select a dashboard to view panels.</p>
      ) : null}
      {status === "succeeded" && items.length === 0 ? (
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
            onClick={() => setIsModalOpen(true)}
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
