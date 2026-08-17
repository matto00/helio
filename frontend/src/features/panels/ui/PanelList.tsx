import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTableCellsLarge, faTableColumns } from "@fortawesome/free-solid-svg-icons";

import "./PanelList.css";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { updateUserPreferences } from "../../auth/state/authSlice";
import { createDashboard } from "../../dashboards/state/dashboardsSlice";
import { PanelGrid } from "./PanelGrid";
import { PanelCreationModal } from "./PanelCreationModal";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { StatusMessage } from "../../../shared/chrome/StatusMessage";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { resolveDashboardGridBackground } from "../../../theme/appearance";
import { useTheme } from "../../../theme/ThemeProvider";
import { useDashboardAppearancePreview } from "../../dashboards/hooks/dashboardAppearancePreviewContext";

export function PanelList() {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  // F-096: `App.tsx`'s `DashboardAppearanceEditor` popover broadcasts its unsaved draft via
  // context (PanelList is rendered through `<Outlet />`, one function scope below AppShell, so a
  // plain prop can't reach it — see dashboardAppearancePreviewContext.ts). `null` outside that
  // provider (e.g. this component's own tests) preserves pre-F-096 behavior.
  const previewAppearance = useDashboardAppearancePreview();
  const { items: dashboards, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const { items, status, error } = useAppSelector((state) => state.panels);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingDashboard, setIsCreatingDashboard] = useState(false);
  const [createDashboardError, setCreateDashboardError] = useState<string | null>(null);
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

  // F-003: the main content pane's own "no dashboards yet" empty state needs
  // a real way out, not just a re-statement of "use the sidebar" — mirrors
  // DashboardList.tsx's own quick-create (a bare name, renameable afterward).
  async function handleCreateDashboard() {
    setIsCreatingDashboard(true);
    setCreateDashboardError(null);
    try {
      await dispatch(createDashboard({ name: "Untitled dashboard" })).unwrap();
    } catch {
      setCreateDashboardError("Failed to create dashboard.");
    } finally {
      setIsCreatingDashboard(false);
    }
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

  const effectiveDashboardAppearance = previewAppearance ?? selectedDashboard?.appearance;

  return (
    <section
      className="panel-list"
      aria-label="panels"
      style={
        effectiveDashboardAppearance?.gridBackground &&
        effectiveDashboardAppearance.gridBackground !== "transparent"
          ? ({
              "--dashboard-grid-background-override": resolveDashboardGridBackground(
                theme,
                effectiveDashboardAppearance,
              ),
            } as CSSProperties)
          : undefined
      }
    >
      <header className="panel-list__header">
        <div className="panel-list__header-actions">
          <div className="panel-list__panel-actions">
            <span className="panel-list__count">
              {items.length} panel{items.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="panel-list__add"
              onClick={() => setIsModalOpen(true)}
              disabled={selectedDashboardId === null}
              title={selectedDashboardId === null ? "Select a dashboard first" : undefined}
            >
              <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
              Add panel
            </button>
          </div>
        </div>
      </header>
      {selectedDashboardId ? (
        <div role="group" aria-label="Zoom controls" className="panel-list__zoom-widget">
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
      {isModalOpen ? <PanelCreationModal onClose={() => setIsModalOpen(false)} /> : null}
      <StatusMessage
        status={status}
        message={status === "loading" ? "Loading panels..." : (error ?? undefined)}
      />
      {status !== "loading" && status !== "failed" && selectedDashboardId === null ? (
        dashboards.length === 0 ? (
          <EmptyState
            icon={faTableColumns}
            title="No dashboards yet"
            description={
              createDashboardError ?? "Create your first dashboard to start adding panels."
            }
            cta={{
              label: isCreatingDashboard ? "Creating..." : "New dashboard",
              icon: faPlus,
              onClick: handleCreateDashboard,
            }}
          />
        ) : (
          <EmptyState
            icon={faTableColumns}
            title="Select a dashboard"
            description="Choose a dashboard from the sidebar to view its panels."
          />
        )
      ) : null}
      {status === "succeeded" && items.length === 0 ? (
        <EmptyState
          icon={faTableCellsLarge}
          title="No panels yet"
          description="Add a panel to start building your dashboard."
          cta={
            selectedDashboardId !== null
              ? { label: "Add panel", icon: faPlus, onClick: () => setIsModalOpen(true) }
              : undefined
          }
        />
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
