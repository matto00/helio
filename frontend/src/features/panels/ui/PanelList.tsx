import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useContainerWidth } from "react-grid-layout";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTableCellsLarge, faTableColumns } from "@fortawesome/free-solid-svg-icons";

import "./PanelList.css";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { updateUserPreferences } from "../../auth/state/authSlice";
import { createDashboard } from "../../dashboards/state/dashboardsSlice";
import { PanelGrid } from "./PanelGrid";
import { PanelGridSkeleton } from "./PanelGridSkeleton";
import { panelGridConfig } from "./panelGridConfig";
import { PanelCreationModal } from "./PanelCreationModal";
import { fetchPanels } from "../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { StatusMessage } from "../../../shared/chrome/StatusMessage";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Skeleton } from "../../../shared/ui/Skeleton";
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
  const {
    items: dashboards,
    selectedDashboardId,
    status: dashboardsStatus,
  } = useAppSelector((state) => state.dashboards);
  const { items, status, error } = useAppSelector((state) => state.panels);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingDashboard, setIsCreatingDashboard] = useState(false);
  const [createDashboardError, setCreateDashboardError] = useState<string | null>(null);
  // HEL-539 — local in-flight flag for the panels-list Retry action (status
  // itself flips straight to "loading" on retry, which swaps StatusMessage
  // out of its "failed" branch entirely; this only matters for the brief
  // window before that re-render commits).
  const [isRetryingPanels, setIsRetryingPanels] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // HEL-528 skeptic-final-1.md CR1 — the ONE container-width measurement for
  // whichever of `PanelGridSkeleton`/`PanelGrid` is currently mounted inside
  // `.panel-list__zoom-container`. Previously each measured independently via
  // its own `useContainerWidth()`, so the instant the skeleton unmounted and
  // `PanelGrid` mounted fresh, it started over at `panelGridConfig.initialWidth`
  // (1280) against a real ~1152px container and RGL animated the cards from
  // the wrong width back to the right one — a visible shift on precisely the
  // swap this ticket exists to make seamless. Hoisting the measurement here
  // (the only consumer of both) means neither branch ever re-enters the 1280px
  // initial state: this component never unmounts across that transition, so
  // the width — once ResizeObserver reports the real value — stays settled.
  const { containerRef: gridWidthContainerRef, width: gridContainerWidth } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
  // Merges the gesture-handler ref above with `useContainerWidth`'s own ref —
  // both need to observe the SAME `.panel-list__zoom-container` DOM node.
  const setZoomContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      gridWidthContainerRef.current = node;
    },
    [gridWidthContainerRef],
  );
  const selectedDashboard =
    dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;

  // HEL-528 design.md D11/D12 — the grid's initial-load skeleton. Gated on
  // `status === "loading"` only (not the idle pre-dispatch frame D11 uses
  // elsewhere): `panels.status` is only ever "idle" pre-dispatch when no
  // dashboard is selected (handled by the empty-state branch below) or right
  // after a delete empties the current dashboard's panels with no refetch
  // scheduled — widening to `idle` there would park a permanent skeleton over
  // either state. `items[0].dashboardId !== selectedDashboardId` is the D12
  // half: `fetchPanels.pending` does not clear `items`, so a dashboard switch
  // needs its own check beyond "no items" or the PREVIOUS dashboard's panels
  // would keep rendering under the new dashboard's layout while the fetch is
  // still in flight.
  const showPanelGridSkeleton =
    selectedDashboardId !== null &&
    status === "loading" &&
    (items.length === 0 || items[0].dashboardId !== selectedDashboardId);

  // HEL-528 evaluation-1.md CR3 — the dashboards fetch itself (`App.tsx`'s
  // unconditional `fetchDashboards()` mount effect) has not resolved yet, so
  // `dashboards.length === 0` below cannot be trusted to mean "this user has
  // zero dashboards" — it is equally true of every user, for the ~50-100ms a
  // cold boot's dashboards fetch is in flight. Rendering the "No dashboards
  // yet" + "New dashboard" CTA hero in that window is a false claim to a user
  // who may have dozens of dashboards, which the requester's rule 6 forbids
  // ("never flash empty content before the skeleton"); falling through to a
  // bare `null` would trip rule 6's other half ("never render nothing during
  // load"). Reuses the grid skeleton's own placeholder markup below: with no
  // dashboard selected there is no saved layout to read, so
  // `defaultDashboardLayout` (already the existing fallback) drives D10's
  // "empty saved layout" branch — the same generic 3-card placeholder a
  // brand-new dashboard's own grid would show. `dashboards.length === 0` is
  // required too, D4-style: once at least one dashboard is already known,
  // a later refetch (`status` flips to "loading" again with `items` still
  // populated) must keep rendering the already-resolved ladder below, not
  // flash back to this placeholder.
  const showBootstrapSkeleton =
    selectedDashboardId === null &&
    dashboards.length === 0 &&
    (dashboardsStatus === "idle" || dashboardsStatus === "loading");

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

  // Styles the single, always-mounted `.panel-list__zoom-container` below
  // (see its render-site comment — skeptic-final-1.md CR1) so a saved zoom
  // level other than 1 does not displace the swap between its skeleton and
  // resolved-grid children — D10/D11/D12.
  const zoomContainerStyle = {
    "--zoom-level": zoomLevel,
    transform: `scale(${zoomLevel})`,
    transformOrigin: "top left",
    height: `${100 / zoomLevel}%`,
    width: `${100 / zoomLevel}%`,
  } as CSSProperties;

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
              {showPanelGridSkeleton || showBootstrapSkeleton ? (
                // HEL-528 design.md D13 — while the skeleton is up this count is
                // either "0 panels" (cold boot) or the PREVIOUS dashboard's count
                // (mid-switch), the same premature-data-claim class D13 rejects
                // for a metric panel's "--"/"No data" pre-dispatch frame.
                //
                // skeptic-final-1.md CR2 — `showBootstrapSkeleton` opened a SECOND
                // window in which the grid skeleton is up (the dashboards-fetch
                // bootstrap gap, CR3) without this gate covering it, so the pill
                // read a literal "0 panels" above a three-card skeleton grid on
                // every cold boot — the exact defect task 6.8a closed on the
                // panels-loading path, reopened on the bootstrap path. Covering
                // both flags closes it on both.
                //
                // Sized to the real box, not a decorative default: this bar is a
                // sole `display: block` child of `.panel-list__count` (the real
                // pill — padding/border/font all come from that class, same as
                // every other Skeleton usage), and `1lh` resolves to the line-box
                // height of THIS element's own inherited font (`--font-mono` at
                // `--text-xs`), which is exactly the real text's line-box height —
                // the same fix as the sidebar rows in DashboardList.css, and the
                // same defect class: a bar with no intrinsic size collapses the
                // ambient box that depends on real content to size itself.
                // `ch` (not `em`) matches WIDTH because `--font-mono` is a true
                // monospace family, so `1ch` is exactly one character's advance —
                // `8ch` approximates the common "N panels" length; the exact
                // panel count is genuinely unknown pre-fetch (same acceptance the
                // grid skeleton's placeholder COUNT makes under D10), so this is
                // a close match rather than a guaranteed exact one.
                <Skeleton variant="line" width="8ch" height="1lh" />
              ) : (
                `${items.length} panel${items.length === 1 ? "" : "s"}`
              )}
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
            title="Zoom out"
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
            title="Zoom in"
            onClick={() => handleZoomChange(0.1)}
            disabled={zoomLevel >= 2.0}
          >
            +
          </button>
          <button
            type="button"
            className="panel-list__zoom-reset"
            aria-label="Reset zoom"
            title="Reset zoom"
            onClick={handleZoomReset}
            disabled={zoomLevel === 1.0}
          >
            Reset
          </button>
        </div>
      ) : null}
      {isModalOpen ? <PanelCreationModal onClose={() => setIsModalOpen(false)} /> : null}
      <StatusMessage
        status={status === "failed" ? "failed" : "idle"}
        message={error ?? undefined}
        onRetry={
          selectedDashboardId !== null
            ? () => {
                setIsRetryingPanels(true);
                void dispatch(fetchPanels(selectedDashboardId)).finally(() =>
                  setIsRetryingPanels(false),
                );
              }
            : undefined
        }
        retrying={isRetryingPanels}
      />
      {/* HEL-528 design.md D10/D11/D12 — the same `.panel-list__zoom-container`
          wrapper the resolved grid renders into, so a saved zoom level other
          than 1 does not displace the swap when real panels arrive.

          skeptic-final-1.md CR1, second occurrence — this wrapper is now a
          SINGLE, ALWAYS-MOUNTED element (only its CHILD varies), not two
          separate copies that each mounted/unmounted as the branch swapped.
          `useContainerWidth` (see `gridContainerWidth` above) attaches its
          `ResizeObserver` once, when `PanelList` itself first mounts, to
          whatever DOM node its ref pointed at then — it does not re-attach if
          that node's identity later changes. The FIRST version of this fix
          kept two separate `<div ref={setZoomContainerRef} ...>` copies (one
          per branch) plus a real gap between the CR3 bootstrap skeleton
          ending and the panels-loading skeleton starting where NEITHER
          existed — so the wrapper unmounted and remounted as a NEW DOM node,
          orphaning the observer against a now-detached element, which reports
          0 width. Caught live (frame-traced against `/registry`, not
          assumed): `gridContainerWidth` sampled `1280 → 1152 → 0` across
          exactly that sequence, with `0` surviving into the panels-loading
          skeleton and staying there. Keeping ONE wrapper mounted for
          `PanelList`'s entire lifetime — with its content, not its own
          presence, driven by which branch is active — gives the hook a
          stable target for its whole one-time effect. */}
      <div
        ref={setZoomContainerRef}
        className="panel-list__zoom-container"
        style={zoomContainerStyle}
      >
        {showPanelGridSkeleton || showBootstrapSkeleton ? (
          <PanelGridSkeleton
            layout={selectedDashboard?.layout ?? defaultDashboardLayout}
            width={gridContainerWidth}
          />
        ) : items.length > 0 &&
          selectedDashboardId !== null &&
          items[0].dashboardId === selectedDashboardId ? (
          <PanelGrid
            key={selectedDashboardId}
            dashboardId={selectedDashboardId}
            layout={selectedDashboard?.layout ?? defaultDashboardLayout}
            panels={items}
            zoomLevel={zoomLevel}
            width={gridContainerWidth}
          />
        ) : null}
      </div>
      {!(showPanelGridSkeleton || showBootstrapSkeleton) ? (
        <>
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
        </>
      ) : null}
    </section>
  );
}
