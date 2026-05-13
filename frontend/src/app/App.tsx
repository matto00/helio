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
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateLeft,
  faArrowRotateRight,
  faSun,
  faMoon,
} from "@fortawesome/free-solid-svg-icons";

import "./App.css";
import { DashboardAppearanceEditor } from "../components/DashboardAppearanceEditor";
import { OrbitMark } from "../components/OrbitMark";
import { SidebarBody } from "../components/SidebarBody";
import { PanelList } from "../components/PanelList";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { PublicOnlyRoute } from "../components/PublicOnlyRoute";
import { SaveStateIndicator } from "../components/SaveStateIndicator";
import { PipelineDetailPage } from "../components/PipelineDetailPage";
import { PipelinesPage } from "../components/PipelinesPage";
import { SourcesPage } from "../components/SourcesPage";
import { TypeRegistryPage } from "../components/TypeRegistryPage";
import { UserMenu } from "../components/UserMenu";
import { logout, rehydrateAuth } from "../features/auth/authSlice";
import { LoginPage } from "../features/auth/LoginPage";
import { OAuthCallbackPage } from "../features/auth/OAuthCallbackPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { fetchDashboards, setDashboardLayoutLocally } from "../features/dashboards/dashboardsSlice";
import {
  redoLayout,
  selectCanRedo,
  selectCanUndo,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "../features/layout/layoutHistorySlice";
import { fetchPanels } from "../features/panels/panelsSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { useLayoutUndoRedo } from "../hooks/useLayoutUndoRedo";
import { resolveDashboardBackground } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import { SaveStateContext, type SaveStateContextValue } from "../context/SaveStateContext";
import { ToastViewport } from "../components/ui/Toast";

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
  const breadcrumbItemName = ((): string | null => {
    if (location.pathname.startsWith("/sources")) {
      const id = sources.selectedSourceId ?? sources.items[0]?.id ?? null;
      return sources.items.find((s) => s.id === id)?.name ?? null;
    }
    if (location.pathname.startsWith("/pipelines/")) {
      const id = location.pathname.split("/")[2];
      return pipelines.items.find((p) => p.id === id)?.name ?? null;
    }
    if (location.pathname.startsWith("/registry")) {
      const id = dataTypes.selectedTypeId ?? dataTypes.items[0]?.id ?? null;
      return dataTypes.items.find((dt) => dt.id === id)?.name ?? null;
    }
    return null;
  })();
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
                <NavLink to="/" end className="app-sidebar__nav-link">
                  Dashboards
                </NavLink>
                <NavLink to="/sources" className="app-sidebar__nav-link">
                  Data Sources
                </NavLink>
                <NavLink to="/pipelines" className="app-sidebar__nav-link">
                  Data Pipelines
                </NavLink>
                <NavLink to="/registry" className="app-sidebar__nav-link">
                  Type Registry
                </NavLink>
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
            <Outlet />
          </section>
        </div>
      </main>
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
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
