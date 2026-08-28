import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useContainerWidth } from "react-grid-layout";
import { LayoutDashboard, LayoutGrid, TriangleAlert } from "lucide-react";

import "./PanelList.css";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { updateUserPreferences } from "../../auth/state/authSlice";
import { useCreateDashboardAction } from "../../dashboards/hooks/useCreateDashboardAction";
import { useOnboardingHost } from "../../onboarding/hooks/useOnboardingHost";
import { OnboardingChecklist } from "../../onboarding/ui/OnboardingChecklist";
import { PanelGrid } from "./grid/PanelGrid";
import { PanelGridSkeleton } from "./grid/PanelGridSkeleton";
import { panelGridConfig } from "./grid/panelGridConfig";
import { PanelCreationModal } from "./PanelCreationModal";
import { useCreatePanelAction } from "../hooks/useCreatePanelAction";
import { fetchPanels, setPanelCreationModalOpen } from "../state/panelsSlice";
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
  const {
    items: dashboards,
    selectedDashboardId,
    status: dashboardsStatus,
  } = useAppSelector((state) => state.dashboards);
  const { items, status, error, staleDashboardId, panelCreationModalOpen } = useAppSelector(
    (state) => state.panels,
  );
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  // HEL-548 D5/D6 — the create-action seam. `createDashboardAction` owns the
  // isPending/error state PanelList used to hold itself (`handleCreateDashboard`
  // moved into the hook, task 3.2); `createPanelAction` is a pure flag flip
  // over the D5a-lifted `panelCreationModalOpen` Redux field.
  const createDashboardAction = useCreateDashboardAction();
  const createPanelAction = useCreatePanelAction();
  // HEL-554 D3 — called UNCONDITIONALLY, mirroring the two hooks above: owns
  // every onboarding side effect (hydration/persistence, sticky activation,
  // the sources/pipelines fetch trigger) and reports whether the checklist
  // should be visible on this render.
  const { visible: onboardingVisible } = useOnboardingHost();
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

  // HEL-528 design.md D11/D12 + HEL-548 D2 — the grid's initial-load
  // skeleton. Now widened to admit the `idle` pre-dispatch frame TOO — but
  // only when `staleDashboardId` (HEL-548 D1) says a fetch has NOT yet been
  // dispatched for `selectedDashboardId`. Before D1's discriminator, `idle`
  // was ambiguous between two states that must render differently: no
  // dashboard selected (handled by the empty-state branch below, unaffected —
  // gated out by `selectedDashboardId !== null`) or right after a delete
  // empties the current dashboard's panels with no refetch scheduled (the
  // TERMINAL state — must render the "No panels yet" empty state, not a
  // skeleton). `staleDashboardId !== selectedDashboardId` is what tells the
  // pre-dispatch frame (fetch provably coming, per D2's proof) apart from
  // that terminal state (no fetch coming — `staleDashboardId ===
  // selectedDashboardId`), so this is NOT the widening HEL-528 task 2.4b
  // forbade: 2.4b's bare-`idle` gate could not make that distinction and so
  // parked a permanent skeleton over the terminal state; this one excludes
  // the terminal state by construction. `items[0].dashboardId !==
  // selectedDashboardId` is the D12 half: `fetchPanels.pending` does not
  // clear `items`, so a dashboard switch needs its own check beyond "no
  // items" or the PREVIOUS dashboard's panels would keep rendering under the
  // new dashboard's layout while the fetch is still in flight.
  const showPanelGridSkeleton =
    selectedDashboardId !== null &&
    (status === "loading" || (status === "idle" && staleDashboardId !== selectedDashboardId)) &&
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

  // HEL-554 D5/D6, tasks 4.2/2.13 — mirrors the two conditions below that
  // decide whether the zero-dashboard / zero-panel `EmptyState` would render
  // at all, absent the checklist. Reused twice: to suppress those two
  // `EmptyState`s while the checklist visibly occupies their region (D5 —
  // "keyed off the SAME visible value the surface renders on"), and to pick
  // the checklist's own Primary-vs-Secondary emphasis (D6) — Primary only in
  // the placement where no EmptyState (and so no other Primary) already
  // occupies this region; Secondary once the checklist sits above a
  // skeleton or a real, populated grid instead.
  const contentGateOpen = !(showPanelGridSkeleton || showBootstrapSkeleton);
  const wouldShowZeroDashboardEmptyState =
    contentGateOpen &&
    status !== "loading" &&
    status !== "failed" &&
    selectedDashboardId === null &&
    dashboards.length === 0;
  const wouldShowZeroPanelEmptyState =
    contentGateOpen &&
    selectedDashboardId !== null &&
    items.length === 0 &&
    (status === "succeeded" || staleDashboardId === selectedDashboardId);
  const onboardingSupersedesEmptyState =
    onboardingVisible && (wouldShowZeroDashboardEmptyState || wouldShowZeroPanelEmptyState);

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

  // HEL-548 D5a — reset the panel-creation modal's flag on unmount. Unlike
  // `useState`, a Redux flag outlives this component: open the modal →
  // Cmd/Ctrl+K → navigate away → PanelList unmounts with the flag still
  // `true` → returning to `/` would open the modal unbidden (browser Back
  // hits the same path). Stable dependency (`[dispatch]` only) — a changing
  // dependency would fire this cleanup on every change and close a
  // legitimately-open modal, not just on unmount. StrictMode's dev
  // double-invoke fires this cleanup once at mount too — harmless, since the
  // flag starts `false` — so don't "fix" that by deleting the reset.
  useEffect(() => {
    return () => {
      dispatch(setPanelCreationModalOpen(false));
    };
  }, [dispatch]);

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
      {panelCreationModalOpen ? (
        <PanelCreationModal onClose={() => dispatch(setPanelCreationModalOpen(false))} />
      ) : null}
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
      {/* HEL-554 D1/D4.1 — mounted OUTSIDE line ~413's skeleton gate below (and
          outside the zero-content gate further down), so it does not blink
          out during the `fetchPanels` round trip after step 3 auto-selects a
          newly-created dashboard. Renders BEFORE the zoom-container so it
          sits visually above the grid once the region stops being empty
          (D6's "above the grid" placement, e.g. the all-four-complete state,
          where real panels render beneath the still-visible completed
          chain). */}
      {onboardingVisible ? (
        <OnboardingChecklist
          createDashboardAction={createDashboardAction}
          emphasisVariant={onboardingSupersedesEmptyState ? "primary" : "secondary"}
        />
      ) : null}
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
      {contentGateOpen ? (
        <>
          {wouldShowZeroDashboardEmptyState && !onboardingVisible
            ? // HEL-548 D6/D6a/task 3.3 (HEL-770 absorbed) — conditional
              // error intent, applied within this ONE branch: a failed
              // create renders the error-title/-icon/role="alert" treatment
              // (parity with HEL-539's five `intent="error"` siblings),
              // carrying the thunk's own (now-specific, D6) rejection
              // message. With no failure present the ordinary first-run
              // empty state stays exactly as neutral as before — unchanged,
              // no role="alert". The CTA is the same `New dashboard` /
              // `Creating…` action either way, so a failed attempt can be
              // retried from the same surface.
              //
              // HEL-554 D5 — suppressed (the `!onboardingVisible` guard above)
              // whenever the checklist supersedes this region; the checklist
              // carries the same "never blank"/CTA/announced-error guarantees
              // itself (`frontend-panel-empty-state`'s modified requirement).
              (() => {
                const createDashboardError = createDashboardAction.error;
                return createDashboardError !== null ? (
                  <EmptyState
                    intent="error"
                    icon={<TriangleAlert />}
                    title="Couldn't create dashboard"
                    description={createDashboardError}
                    cta={createDashboardAction.cta}
                  />
                ) : (
                  <EmptyState
                    icon={<LayoutDashboard />}
                    title="No dashboards yet"
                    description="Create your first dashboard to start adding panels."
                    cta={createDashboardAction.cta}
                  />
                );
              })()
            : null}
          {/* D5 — NOT suppressed by `onboardingVisible`: dashboards exist
              once this branch can render, so it is never a first-run state
              and has no CTA of its own to double up with the checklist. */}
          {status !== "loading" &&
          status !== "failed" &&
          selectedDashboardId === null &&
          dashboards.length > 0 ? (
            <EmptyState
              icon={<LayoutDashboard />}
              title="Select a dashboard"
              description="Choose a dashboard from the sidebar to view its panels."
            />
          ) : null}
          {/* HEL-548 D1/D2/task 2.3 — admits the terminal (post-delete)
              state alongside the resolved-succeeded one:
              `staleDashboardId === selectedDashboardId` means
              `markDashboardPanelsStale` invalidated THIS dashboard with no
              refetch scheduled (deletePanel's terminal case). Closes the §7
              gap HEL-528 design.md D11 traced and assigned to this ticket —
              deleting a dashboard's last panel used to render nothing at
              all, permanently. `selectedDashboardId !== null` is hoisted
              into the gate itself (previously only guarded the cta) so a
              CTA-less hero can never render in a state this branch already
              excludes.

              HEL-554 D5 — suppressed while the checklist supersedes this
              region too (including this exact post-delete state — the
              modified `frontend-panel-empty-state` spec's own scenario). */}
          {wouldShowZeroPanelEmptyState && !onboardingVisible ? (
            <EmptyState
              icon={<LayoutGrid />}
              title="No panels yet"
              description="Add a panel to start building your dashboard."
              cta={createPanelAction.cta}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
