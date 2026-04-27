import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
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

import "./App.css";
import { DashboardAppearanceEditor } from "../components/DashboardAppearanceEditor";
import { OrbitMark } from "../components/OrbitMark";
import { DashboardList } from "../components/DashboardList";
import { PanelList } from "../components/PanelList";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { PublicOnlyRoute } from "../components/PublicOnlyRoute";
import { SourcesPage } from "../components/SourcesPage";
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

/** The authenticated app shell - rendered only when the user is signed in. */
function AppShell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { items, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const authStatus = useAppSelector((state) => state.auth.status);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const { theme, toggleTheme, accentColor, setAccentColor } = useTheme();
  const [isDashboardListCollapsed, setIsDashboardListCollapsed] = useState(false);
  const location = useLocation();
  const onDashboardView = location.pathname === "/";
  const selectedDashboard = items.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;
  const selectedDashboardName = selectedDashboard?.name ?? "No dashboard selected";

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
            <span>{onDashboardView ? "Dashboards" : "Data Sources"}</span>
            {onDashboardView && selectedDashboard !== null && (
              <>
                <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                  /
                </span>
                <span className="app-command-bar__breadcrumb-current">{selectedDashboardName}</span>
              </>
            )}
          </nav>
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
                ↩ Undo
              </button>
              <button
                type="button"
                className="undo-redo-btn"
                onClick={handleRedo}
                disabled={!canRedo}
                aria-label="Redo layout change"
                title="Redo (Ctrl+Shift+Z)"
              >
                Redo ↪
              </button>
            </>
          )}
          {onDashboardView && <DashboardAppearanceEditor dashboard={selectedDashboard} />}
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
            <PanelLeftOpen size={14} />
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
            </nav>
            <DashboardList onCollapse={() => setIsDashboardListCollapsed(true)} />
            <button
              type="button"
              className="app-sidebar-collapse"
              aria-label="Collapse dashboard list"
              onClick={() => setIsDashboardListCollapsed(true)}
            >
              <PanelLeftClose size={14} />
            </button>
          </aside>
        )}
        <section className="app-content">
          <Outlet />
        </section>
      </div>
    </main>
  );
}

export function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(rehydrateAuth());
  }, [dispatch]);

  return (
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
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
