import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateLeft,
  faArrowRotateRight,
  faSun,
  faMoon,
} from "@fortawesome/free-solid-svg-icons";

import "./App.css";
import { DashboardAppearanceEditor } from "../features/dashboards/ui/DashboardAppearanceEditor";
import { OrbitMark } from "../shared/chrome/OrbitMark";
import { SidebarBody, sectionFromPathname } from "../shared/chrome/SidebarBody";
import { BottomNav } from "../shared/chrome/BottomNav";
import { MobileNavSheet, type MobileNavSheetItem } from "../shared/chrome/MobileNavSheet";
import { navDestinations } from "../shared/chrome/navDestinations";
import { PanelList } from "../features/panels/ui/PanelList";
import { ProtectedRoute } from "../features/auth/ui/ProtectedRoute";
import { PublicOnlyRoute } from "../features/auth/ui/PublicOnlyRoute";
import { SaveStateIndicator } from "../shared/chrome/SaveStateIndicator";
import { PipelineDetailPage } from "../features/pipelines/ui/PipelineDetailPage";
import { PipelinesPage } from "../features/pipelines/ui/PipelinesPage";
import { SourcesPage } from "../features/sources/ui/SourcesPage";
import { TypeRegistryPage } from "../features/dataTypes/ui/TypeRegistryPage";
import { ProposalReviewPage } from "../features/dashboards/ui/ProposalReviewPage";
import { UserMenu } from "../features/auth/ui/UserMenu";
import { logout, rehydrateAuth } from "../features/auth/state/authSlice";
import { LoginPage } from "../features/auth/ui/LoginPage";
import { OAuthCallbackPage } from "../features/auth/ui/OAuthCallbackPage";
import { RegisterPage } from "../features/auth/ui/RegisterPage";
import {
  fetchDashboards,
  setDashboardLayoutLocally,
  setSelectedDashboardId,
} from "../features/dashboards/state/dashboardsSlice";
import {
  selectPipelineOutputDataTypes,
  setSelectedTypeId,
} from "../features/dataTypes/state/dataTypesSlice";
import { setSelectedSourceId } from "../features/sources/state/sourcesSlice";
import {
  redoLayout,
  selectCanRedo,
  selectCanUndo,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "../features/layout/state/layoutHistorySlice";
import { fetchPanels } from "../features/panels/state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { useLayoutUndoRedo } from "../features/layout/hooks/useLayoutUndoRedo";
import { resolveDashboardBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import { SaveStateContext, type SaveStateContextValue } from "../context/SaveStateContext";
import { ToastViewport } from "../shared/ui/Toast";
import { ErrorBoundary } from "../shared/chrome/ErrorBoundary";

function breadcrumbLabel(pathname: string): string {
  if (pathname === "/") return "Dashboards";
  if (pathname.startsWith("/sources")) return "Data Sources";
  if (pathname.startsWith("/pipelines")) return "Data Pipelines";
  if (pathname.startsWith("/registry")) return "Type Registry";
  return "Dashboards";
}

/** The authenticated app shell - rendered only when the user is signed in. */
function AppShell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { items, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const authStatus = useAppSelector((state) => state.auth.status);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  const { theme, toggleTheme, accentColor, setAccentColor } = useTheme();
  const [isDashboardListCollapsed, setIsDashboardListCollapsed] = useState(false);
  const [isMobileNavSheetOpen, setIsMobileNavSheetOpen] = useState(false);
  const location = useLocation();
  const onDashboardView = location.pathname === "/";
  const selectedDashboard = items.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;
  const selectedDashboardName = selectedDashboard?.name ?? "No dashboard selected";

  // Resolve the currently-active item name for the section breadcrumb. Each
  // section derives its selection differently (sources/types via Redux,
  // pipelines via the route :id, dashboards via Redux), so we centralise the
  // lookup here to keep the header concise.
  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const dataTypes = useAppSelector((state) => state.dataTypes);
  // Registry only ever lists pipeline-bound output types (strict
  // source→pipeline→type→panel; see the sidebar's own SidebarBody.tsx) — the
  // breadcrumb and the phone sheet must agree on that same filtered set, or
  // the title text and the sheet's active-item highlight could disagree.
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  const mobileSection = sectionFromPathname(location.pathname);
  const pipelineRouteId = location.pathname.startsWith("/pipelines/")
    ? location.pathname.split("/")[2]
    : null;
  const breadcrumbItemName = ((): string | null => {
    if (mobileSection === "sources") {
      const id = sources.selectedSourceId ?? sources.items[0]?.id ?? null;
      return sources.items.find((s) => s.id === id)?.name ?? null;
    }
    if (mobileSection === "pipelines" && pipelineRouteId !== null) {
      return pipelines.items.find((p) => p.id === pipelineRouteId)?.name ?? null;
    }
    if (mobileSection === "registry") {
      const id = dataTypes.selectedTypeId ?? pipelineOutputDataTypes[0]?.id ?? null;
      return pipelineOutputDataTypes.find((dt) => dt.id === id)?.name ?? null;
    }
    return null;
  })();

  // Phone section sheet — one sheet component reused for every section,
  // fed by the exact same selectors/actions the desktop sidebar
  // (DashboardList / SidebarBody+SidebarItemList) reads and dispatches, per
  // notes/mobile-pwa-handoff.md §W3.2/§W3.3 ("do not fork the state"; every
  // section is a picker, never a dead end). Pipelines select via navigation
  // (matching SidebarItemList's `toHref`), the rest via Redux selection.
  const mobileSheetItems: MobileNavSheetItem[] = (() => {
    switch (mobileSection) {
      case "dashboards":
        return items.map((dashboard) => ({
          id: dashboard.id,
          name: dashboard.name,
          isActive: dashboard.id === selectedDashboardId,
        }));
      case "sources": {
        const effectiveSourceId = sources.selectedSourceId ?? sources.items[0]?.id ?? null;
        return sources.items.map((source) => ({
          id: source.id,
          name: source.name,
          isActive: source.id === effectiveSourceId,
        }));
      }
      case "pipelines":
        return pipelines.items.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          isActive: pipeline.id === pipelineRouteId,
        }));
      case "registry": {
        const effectiveTypeId = dataTypes.selectedTypeId ?? pipelineOutputDataTypes[0]?.id ?? null;
        return pipelineOutputDataTypes.map((dataType) => ({
          id: dataType.id,
          name: dataType.name,
          isActive: dataType.id === effectiveTypeId,
        }));
      }
    }
  })();

  // Reuses the same section→label mapping the desktop breadcrumb heading
  // uses, so the sheet's own heading (and the phone title's accessible name)
  // never drifts from desktop wording.
  const mobileSheetTitle = breadcrumbLabel(location.pathname);
  const mobileTitleDisplayName =
    mobileSection === "dashboards"
      ? selectedDashboardName
      : (breadcrumbItemName ?? mobileSheetTitle);
  const mobileTitleVisible = mobileSection === "dashboards" ? selectedDashboard !== null : true;

  const mobileSheetEmptyMessage: Record<typeof mobileSection, string> = {
    dashboards: "No dashboards yet.",
    sources: "No data sources yet.",
    pipelines: "No pipelines yet.",
    registry: "No types yet.",
  };

  function handleMobileSheetSelect(item: MobileNavSheetItem) {
    switch (mobileSection) {
      case "dashboards":
        dispatch(setSelectedDashboardId(item.id));
        return;
      case "sources":
        dispatch(setSelectedSourceId(item.id));
        return;
      case "pipelines":
        navigate(`/pipelines/${item.id}`);
        return;
      case "registry":
        dispatch(setSelectedTypeId(item.id));
        return;
    }
  }

  const flushFnRef = useRef<(() => void) | null>(null);

  const registerFlush = useCallback((fn: (() => void) | null) => {
    flushFnRef.current = fn;
  }, []);

  const flush = useCallback(() => {
    flushFnRef.current?.();
  }, []);

  const saveStateContextValue: SaveStateContextValue = useMemo(
    () => ({ registerFlush, flush }),
    [registerFlush, flush],
  );

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

  const canUndo = useAppSelector(selectCanUndo(selectedDashboardId));
  const canRedo = useAppSelector(selectCanRedo(selectedDashboardId));
  const undoTarget = useAppSelector(selectUndoLayout(selectedDashboardId));
  const redoTarget = useAppSelector(selectRedoLayout(selectedDashboardId));

  useLayoutUndoRedo(selectedDashboardId);

  function handleUndo() {
    if (!selectedDashboardId || !undoTarget || !selectedDashboard) return;
    dispatch(
      undoLayout({ dashboardId: selectedDashboardId, currentLayout: selectedDashboard.layout }),
    );
    dispatch(setDashboardLayoutLocally({ dashboardId: selectedDashboardId, layout: undoTarget }));
  }

  function handleRedo() {
    if (!selectedDashboardId || !redoTarget || !selectedDashboard) return;
    dispatch(
      redoLayout({ dashboardId: selectedDashboardId, currentLayout: selectedDashboard.layout }),
    );
    dispatch(setDashboardLayoutLocally({ dashboardId: selectedDashboardId, layout: redoTarget }));
  }

  async function handleLogout() {
    await dispatch(logout());
    void navigate("/login");
  }

  useEffect(() => {
    void dispatch(fetchDashboards());
  }, [dispatch]);

  useEffect(() => {
    if (selectedDashboardId === null) {
      return;
    }

    void dispatch(fetchPanels(selectedDashboardId));
  }, [dispatch, selectedDashboardId]);

  const shellStyle =
    onDashboardView &&
    selectedDashboard !== null &&
    selectedDashboard.appearance.background !== "transparent"
      ? ({
          "--dashboard-background-override": resolveDashboardBackground(
            theme,
            selectedDashboard.appearance,
          ),
        } as CSSProperties)
      : undefined;

  return (
    <SaveStateContext.Provider value={saveStateContextValue}>
      <main className="app-shell" style={shellStyle}>
        {/* -- COMMAND BAR -- */}
        <header className="app-command-bar">
          <div className="app-command-bar__left">
            <span className="app-command-bar__logo">
              <OrbitMark />
              <span className="app-command-bar__wordmark">Helio</span>
            </span>
            <span className="app-command-bar__sep" aria-hidden="true" />
            <nav className="app-command-bar__breadcrumb" aria-label="Breadcrumb">
              <span>{breadcrumbLabel(location.pathname)}</span>
              {onDashboardView && selectedDashboard !== null && (
                <>
                  <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="app-command-bar__breadcrumb-current">
                    {selectedDashboardName}
                  </span>
                </>
              )}
              {!onDashboardView && breadcrumbItemName !== null && (
                <>
                  <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="app-command-bar__breadcrumb-current">{breadcrumbItemName}</span>
                </>
              )}
            </nav>
            {/* Phone-only: the breadcrumb above is display:none <768px (App.css),
                so this is the section-item switcher entry point there —
                dashboards, sources, pipelines, and registry all share the one
                control + MobileNavSheet per notes/mobile-pwa-handoff.md
                §W3.2/§W3.3. Desktop breadcrumb markup above is untouched. */}
            {mobileTitleVisible && (
              <button
                type="button"
                className="app-command-bar__mobile-title"
                onClick={() => setIsMobileNavSheetOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={isMobileNavSheetOpen}
                aria-label={`Switch ${mobileSheetTitle.toLowerCase()} (current: ${mobileTitleDisplayName})`}
              >
                <span className="app-command-bar__mobile-title-name" aria-hidden="true">
                  {mobileTitleDisplayName}
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            )}
            {onDashboardView && selectedDashboard !== null && (
              <SaveStateIndicator onSaveNow={flush} />
            )}
          </div>
          <div className="app-command-bar__right">
            {onDashboardView && (
              <>
                <button
                  type="button"
                  className="undo-redo-btn"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="Undo layout change"
                  title="Undo (Ctrl+Z)"
                >
                  <FontAwesomeIcon icon={faArrowRotateLeft} /> Undo
                </button>
                <button
                  type="button"
                  className="undo-redo-btn"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="Redo layout change"
                  title="Redo (Ctrl+Shift+Z)"
                >
                  Redo <FontAwesomeIcon icon={faArrowRotateRight} />
                </button>
              </>
            )}
            {onDashboardView && <DashboardAppearanceEditor dashboard={selectedDashboard} />}
            <button
              type="button"
              className="topbar-theme-btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
            </button>
            {authStatus === "authenticated" && currentUser !== null && (
              <UserMenu
                currentUser={currentUser}
                theme={theme}
                toggleTheme={toggleTheme}
                accentColor={accentColor}
                setAccentColor={setAccentColor}
                onLogout={() => void handleLogout()}
              />
            )}
          </div>
        </header>

        {/* -- BODY (sidebar + content) -- */}
        <div className="app-body">
          {isDashboardListCollapsed ? (
            <button
              type="button"
              className="app-sidebar-toggle"
              aria-label="Expand dashboard list"
              onClick={() => setIsDashboardListCollapsed(false)}
            >
              <PanelLeftOpen size={18} />
            </button>
          ) : (
            <aside className="app-sidebar">
              <nav className="app-sidebar__nav" aria-label="Main navigation">
                {navDestinations.map((destination) => (
                  <NavLink
                    key={destination.to}
                    to={destination.to}
                    end={destination.end}
                    className="app-sidebar__nav-link"
                  >
                    {destination.label}
                  </NavLink>
                ))}
              </nav>
              <SidebarBody onCollapse={() => setIsDashboardListCollapsed(true)} />
              <button
                type="button"
                className="app-sidebar-collapse"
                aria-label="Collapse dashboard list"
                onClick={() => setIsDashboardListCollapsed(true)}
              >
                <PanelLeftClose size={18} />
              </button>
            </aside>
          )}
          <section className="app-content">
            <ErrorBoundary resetKey={`${location.pathname}:${selectedDashboardId ?? ""}`}>
              <Outlet />
            </ErrorBoundary>
          </section>
        </div>

        {/* Phone-only section nav — hidden >=768px via BottomNav.css; every
            protected route renders it so no route is a navigation trap
            (notes/mobile-pwa-handoff.md §W3.3). */}
        <BottomNav />
      </main>
      <MobileNavSheet
        open={isMobileNavSheetOpen}
        onClose={() => setIsMobileNavSheetOpen(false)}
        title={mobileSheetTitle}
        items={mobileSheetItems}
        onSelect={handleMobileSheetSelect}
        emptyMessage={mobileSheetEmptyMessage[mobileSection]}
      />
    </SaveStateContext.Provider>
  );
}

export function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(rehydrateAuth());
  }, [dispatch]);

  return (
    <>
      <ToastViewport />
      <Routes>
        {/* Public-only routes (redirect to / when already authenticated) */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* Public route: OAuth callback - must be outside ProtectedRoute and PublicOnlyRoute */}
        <Route path="/auth/callback" element={<OAuthCallbackPage />} />

        {/* Protected routes (redirect to /login when unauthenticated) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<PanelList />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/pipelines" element={<PipelinesPage />} />
            <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
            <Route path="/registry" element={<TypeRegistryPage />} />
            <Route path="/proposals/review" element={<ProposalReviewPage />} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
