import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import "./App.css";
import { CreatePipelineModal } from "../features/pipelines/ui/CreatePipelineModal";
import { QuickLauncherOverlay } from "../features/assistant/ui/QuickLauncherOverlay";
import { RefinementChatDrawer } from "../features/dashboards/ui/RefinementChatDrawer";
import { DashboardShareDialog } from "../features/dashboards/ui/DashboardShareDialog";
import {
  ShareDialogProvider,
  useShareDialog,
} from "../features/dashboards/state/shareDialogContext";
import { BuiltInCommandActions } from "../features/commandPalette/BuiltInCommandActions";
import { CommandPaletteProvider } from "../features/commandPalette/CommandPaletteProvider";
import { GlobalCommandShortcuts } from "../features/commandPalette/GlobalCommandShortcuts";
import { CommandPalette } from "../features/commandPalette/ui/CommandPalette";
import { fetchDashboards } from "../features/dashboards/state/dashboardsSlice";
import { setCreatePipelineModalOpen } from "../features/pipelines/state/pipelinesSlice";
import { fetchPanels } from "../features/panels/state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { usePickerSelection } from "../shared/chrome/usePickerSelection";
import { resolveDashboardBackground } from "../theme/appearance";
import type { DashboardAppearance } from "../features/dashboards/types/dashboard";
import { DashboardAppearancePreviewContext } from "../features/dashboards/hooks/dashboardAppearancePreviewContext";
import { useTheme } from "../theme/ThemeProvider";
import { SaveStateContext, useSaveStateRegistry } from "../context/SaveStateContext";
import { ToastViewport } from "../shared/ui/Toast";
import { ErrorBoundary } from "../shared/chrome/ErrorBoundary";
import { AppRoutes } from "./AppRoutes";
import { CommandBar } from "./CommandBar";
import { Sidebar } from "./Sidebar";
import { MobileShell } from "./MobileShell";
import { rehydrateAuth } from "../features/auth/state/authSlice";

/** The authenticated app shell - rendered only when the user is signed in.
 * Owns only what's genuinely cross-cutting between `CommandBar`/`Sidebar`/
 * `MobileShell` and can't be owned by one of them (design.md "App.tsx split
 * boundary"): shared open/collapsed state, the appearance-preview draft,
 * `document.title`, the beforeunload guard, and the shell-level modals. */
export function AppShell() {
  const dispatch = useAppDispatch();
  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  const { theme } = useTheme();
  // F-018: persisted across reloads so collapsing the sidebar isn't undone by
  // the next page load. Guarded against storage being unavailable (private
  // browsing / quota) — collapse state simply won't persist in that case.
  const [isDashboardListCollapsed, setIsDashboardListCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("helio.sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const [isMobileNavSheetOpen, setIsMobileNavSheetOpen] = useState(false);
  const [isRefinementOpen, setIsRefinementOpen] = useState(false);
  const [isQuickLauncherOpen, setIsQuickLauncherOpen] = useState(false);
  const location = useLocation();
  const onDashboardView = location.pathname === "/";
  const { items, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const selectedDashboard = items.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;
  const selectedDashboardName = selectedDashboard?.name ?? "No dashboard selected";
  // F-096: an unsaved pick in `DashboardAppearanceEditor`'s popover — live-previewed here (shell
  // background) and in `PanelList` (grid background) before Save actually persists it.
  const [draftAppearance, setDraftAppearance] = useState<DashboardAppearance | null>(null);
  const pipelines = useAppSelector((state) => state.pipelines);

  // Drives the desktop breadcrumb text baked into the sr-only <h1> below and
  // the document.title effect — the one place both of those still need the
  // current item's name, via the shared registry/hook (HEL-724).
  const pickerSelection = usePickerSelection(location.pathname);

  const saveStateContextValue = useSaveStateRegistry();

  // F-018: persist the collapsed/expanded sidebar preference across reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem("helio.sidebarCollapsed", String(isDashboardListCollapsed));
    } catch {
      // Storage unavailable — the initializer above already tolerates this.
    }
  }, [isDashboardListCollapsed]);

  // F-019: most routes render no page-level heading and `document.title`
  // never changed on navigation. The visible per-route heading itself lives
  // in each page (out of this package's ownership); `document.title` is
  // driven from here off the same label the breadcrumb already uses, so the
  // browser tab/history entry always matches what's on screen.
  useEffect(() => {
    const section = pickerSelection.heading;
    const itemName = onDashboardView ? selectedDashboardName : pickerSelection.activeItemName;
    document.title =
      itemName && itemName !== "No dashboard selected"
        ? `${itemName} · ${section} · Helio`
        : `${section} · Helio`;
  }, [
    location.pathname,
    onDashboardView,
    selectedDashboardName,
    pickerSelection.heading,
    pickerSelection.activeItemName,
  ]);

  // beforeunload guard: warn when there are pending changes
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (Object.keys(pendingPanelUpdates).length > 0) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pendingPanelUpdates]);

  useEffect(() => {
    void dispatch(fetchDashboards());
  }, [dispatch]);

  useEffect(() => {
    if (selectedDashboardId === null) {
      return;
    }

    void dispatch(fetchPanels(selectedDashboardId));
  }, [dispatch, selectedDashboardId]);

  const effectiveDashboardAppearance =
    (onDashboardView && draftAppearance) || selectedDashboard?.appearance;

  const shellStyle =
    onDashboardView &&
    effectiveDashboardAppearance !== undefined &&
    effectiveDashboardAppearance.background !== "transparent"
      ? ({
          "--dashboard-background-override": resolveDashboardBackground(
            theme,
            effectiveDashboardAppearance,
          ),
        } as CSSProperties)
      : undefined;

  return (
    <ShareDialogProvider>
      <SaveStateContext.Provider value={saveStateContextValue}>
        {/* F-089: first focusable element on every load, targeting the real
          <main> landmark below (F-088) so keyboard/screen-reader users can
          bypass the 11 chrome tab-stops that otherwise precede page content. */}
        <a href="#app-main-content" className="app-skip-link">
          Skip to content
        </a>
        <div className="app-shell" style={shellStyle}>
          <CommandBar
            isMobileNavSheetOpen={isMobileNavSheetOpen}
            // HEL-773 design.md D2 — the trigger now toggles: tapping it again
            // while the sheet is open closes it, preserving the behavior
            // today's full-viewport backdrop already provided.
            onOpenMobileNavSheet={() => setIsMobileNavSheetOpen((wasOpen) => !wasOpen)}
            onOpenRefinement={() => setIsRefinementOpen(true)}
            onOpenQuickLauncher={() => setIsQuickLauncherOpen(true)}
            draftAppearance={draftAppearance}
            setDraftAppearance={setDraftAppearance}
          />

          {/* -- BODY (sidebar + content) -- */}
          <div className="app-body">
            <Sidebar
              isDashboardListCollapsed={isDashboardListCollapsed}
              onToggleCollapse={() => setIsDashboardListCollapsed((collapsed) => !collapsed)}
            />
            {/* F-088: the routed page content is the real <main> landmark now —
              <header>/<aside> are chrome, siblings of it, not its ancestors. */}
            <main className="app-content" id="app-main-content">
              {/* F-019: a real (visually-hidden) per-route <h1> — most pages
                render no heading at all today. Paired with the document.title
                effect above so both the visible tab and an accessibility tree
                agree on "where am I", off the same label. */}
              <h1 className="app-content__sr-heading">
                {onDashboardView
                  ? selectedDashboardName === "No dashboard selected"
                    ? pickerSelection.heading
                    : `${pickerSelection.heading}: ${selectedDashboardName}`
                  : pickerSelection.activeItemName !== null
                    ? `${pickerSelection.heading}: ${pickerSelection.activeItemName}`
                    : pickerSelection.heading}
              </h1>
              <ErrorBoundary resetKey={`${location.pathname}:${selectedDashboardId ?? ""}`}>
                <DashboardAppearancePreviewContext.Provider value={draftAppearance}>
                  <Outlet />
                </DashboardAppearancePreviewContext.Provider>
              </ErrorBoundary>
            </main>
          </div>

          <MobileShell
            isMobileNavSheetOpen={isMobileNavSheetOpen}
            onClose={() => setIsMobileNavSheetOpen(false)}
          />
        </div>
        {/* F-045: mounted at the shell level (like RefinementChatDrawer/
          QuickLauncherOverlay below) so the sidebar's pipelines "+" works from
          any route, not just the pipelines list — previously it only set
          `createModalOpen` in Redux with nothing mounted to read it outside
          `/pipelines`, so the modal silently opened later, on whatever route
          the user next visited `/pipelines` from. Skipped only on the exact
          list route, which already mounts its own instance (unchanged, not
          our file) — mounting both there would double the dialog. */}
        {location.pathname !== "/pipelines" && pipelines.createModalOpen && (
          <CreatePipelineModal onClose={() => dispatch(setCreatePipelineModalOpen(false))} />
        )}
        {/* HEL-411 design.md D6 — gated on selectedDashboardId !== null: RefinementChatDrawer's
          dashboardId prop is required (the drawer always targets the currently-open dashboard,
          never a user-typed id), so it's simply not mounted when nothing is selected. */}
        {selectedDashboardId !== null && (
          <RefinementChatDrawer
            open={isRefinementOpen}
            onClose={() => setIsRefinementOpen(false)}
            dashboardId={selectedDashboardId}
          />
        )}
        {/* HEL-665 design.md D7 — unconditional (unlike RefinementChatDrawer above): the
          quick-launcher has no per-route/per-dashboard dependency, matching its trigger button's
          own unconditional visibility. */}
        <QuickLauncherOverlay
          open={isQuickLauncherOpen}
          onClose={() => setIsQuickLauncherOpen(false)}
        />
        {/* HEL-496 — command palette shell + registry. Provider is scoped to this cluster (nothing
          else in AppShell consumes the registry directly); GlobalCommandShortcuts owns Cmd/Ctrl+K
          (palette) and Cmd/Ctrl+J (quick-launcher, moved off K per the
          `palette-takes-k-launcher-moves` resolution), BuiltInCommandActions seeds navigation/
          theme/"Open assistant" actions. */}
        <CommandPaletteProvider>
          <GlobalCommandShortcuts onOpenQuickLauncher={() => setIsQuickLauncherOpen(true)} />
          <BuiltInCommandActions onOpenQuickLauncher={() => setIsQuickLauncherOpen(true)} />
          <CommandPalette />
        </CommandPaletteProvider>
        {/* HEL-590 (evaluation-1.md CR4) — mounted at shell level, a sibling of Sidebar/MobileShell
          above, not nested inside `.app-sidebar` (which is `display: none` below the desktop
          breakpoint and would hide this dialog's entire subtree, including the native <dialog>'s
          own top-layer promotion, along with it). */}
        <ShareDialogHost />
      </SaveStateContext.Provider>
    </ShareDialogProvider>
  );
}

// HEL-590 (evaluation-2.md non-blocking suggestion) -- matches the public share-link viewer route
// mounted in `AppRoutes.tsx` (`/dashboards/:dashboardId/panels`). Kept as a single shared regex so
// the two call sites (here and the skip check below) can never drift apart.
const PUBLIC_DASHBOARD_VIEWER_PATH = /^\/dashboards\/[^/]+\/panels$/;

export function App() {
  const dispatch = useAppDispatch();
  const authStatus = useAppSelector((state) => state.auth.status);
  const location = useLocation();

  // F-207: gated on "idle" (mirroring `fetchPipelines`'s gate elsewhere in
  // this file) so React StrictMode's dev-only double-invoke of this effect
  // doesn't fire a second, redundant `GET /api/auth/me` — the first dispatch
  // already flips `status` off "idle" before the second invocation runs.
  // HEL-590: also skipped on the public share-link viewer route -- every anonymous visitor there
  // otherwise triggers a `GET /api/auth/me` that always 401s. Harmless (identical for every
  // visitor, so not an existence/state oracle) but unnecessary; a signed-in user who navigates
  // there directly still has `authStatus` already resolved from elsewhere in the app, so this
  // never leaves a genuinely authenticated session unresolved.
  useEffect(() => {
    if (authStatus === "idle" && !PUBLIC_DASHBOARD_VIEWER_PATH.test(location.pathname)) {
      void dispatch(rehydrateAuth());
    }
  }, [dispatch, authStatus, location.pathname]);

  return (
    <>
      <ToastViewport />
      <AppRoutes />
    </>
  );
}

/** HEL-590 (evaluation-1.md CR4) — reads the shell-level `ShareDialogContext` and renders
 *  `DashboardShareDialog` here, at `AppShell`'s own top level (see the mount site above). Split
 *  into its own component (rather than inlined in `AppShell`) purely so `useShareDialog()` doesn't
 *  add a re-render dependency to the much larger `AppShell` component for every open/close. */
function ShareDialogHost() {
  const { target, close } = useShareDialog();
  // HEL-590 (evaluation-2.md CR-E): stays MOUNTED across close, transitioning `open: true -> false`
  // instead of unmounting -- `Modal`'s focus-restore effect only runs on that `[open]` transition
  // (see `Modal.tsx`), so unmounting (the previous `if (target === null) return null` shape)
  // skipped it entirely and left focus on `<body>`. `lastTarget` retains the most recent non-null
  // target so `DashboardShareDialog` always has real `dashboardId`/`dashboardName` props to render
  // (harmless once `open={false}`, since Modal's own `dialog.close()` hides it either way).
  const [lastTarget, setLastTarget] = useState<{
    dashboardId: string;
    dashboardName: string;
  } | null>(null);
  // React's documented "adjusting state during render" pattern (not an effect, so this commits in
  // the SAME render as `target` becoming non-null -- no one-render flash of stale/absent props).
  if (target !== null && target !== lastTarget) {
    setLastTarget(target);
  }
  if (lastTarget === null) return null;
  return (
    <DashboardShareDialog
      dashboardId={lastTarget.dashboardId}
      dashboardName={lastTarget.dashboardName}
      open={target !== null}
      onClose={close}
    />
  );
}
