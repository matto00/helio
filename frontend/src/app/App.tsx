import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateLeft,
  faArrowRotateRight,
  faComments,
  faCommentDots,
  faCompass,
  faSun,
  faMoon,
} from "@fortawesome/free-solid-svg-icons";

import "./App.css";
import { ChatPage } from "../features/assistant/ui/ChatPage";
import { setSelectedConversationId } from "../features/assistant/state/assistantConversationsSlice";
import { QuickLauncherOverlay } from "../features/assistant/ui/QuickLauncherOverlay";
import { DashboardAppearanceEditor } from "../features/dashboards/ui/DashboardAppearanceEditor";
import { RefinementChatDrawer } from "../features/dashboards/ui/RefinementChatDrawer";
import { OrbitMark } from "../shared/chrome/OrbitMark";
import { SidebarBody, sectionFromPathname } from "../shared/chrome/SidebarBody";
import { BottomNav } from "../shared/chrome/BottomNav";
import { MobileNavSheet, type MobileNavSheetItem } from "../shared/chrome/MobileNavSheet";
import { navDestinations } from "../shared/chrome/navDestinations";
import { PanelList } from "../features/panels/ui/PanelList";
import { ProtectedRoute } from "../features/auth/ui/ProtectedRoute";
import { PublicOnlyRoute } from "../features/auth/ui/PublicOnlyRoute";
import { SaveStateIndicator } from "../shared/chrome/SaveStateIndicator";
import { MetricDetailPage } from "../features/metrics/ui/MetricDetailPage";
import { MetricsPage } from "../features/metrics/ui/MetricsPage";
import { CreatePipelineModal } from "../features/pipelines/ui/CreatePipelineModal";
import { PipelineDetailPage } from "../features/pipelines/ui/PipelineDetailPage";
import { PipelinesPage } from "../features/pipelines/ui/PipelinesPage";
import { SettingsPage } from "../features/settings/ui/SettingsPage";
import { SourcesPage } from "../features/sources/ui/SourcesPage";
import { TypeRegistryPage } from "../features/dataTypes/ui/TypeRegistryPage";
import { ProposalReviewPage } from "../features/dashboards/ui/ProposalReviewPage";
import { PatchSetReviewPage } from "../features/patchSets/ui/PatchSetReviewPage";
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
import {
  fetchPipelines,
  selectPipelineNameByOutputTypeId,
  setCreatePipelineModalOpen,
} from "../features/pipelines/state/pipelinesSlice";
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
import type { DashboardAppearance } from "../features/dashboards/types/dashboard";
import { DashboardAppearancePreviewContext } from "../features/dashboards/hooks/dashboardAppearancePreviewContext";
import { useTheme } from "../theme/ThemeProvider";
import { SaveStateContext, type SaveStateContextValue } from "../context/SaveStateContext";
import { ToastViewport } from "../shared/ui/Toast";
import { EmptyState } from "../shared/ui/EmptyState";
import { ErrorBoundary } from "../shared/chrome/ErrorBoundary";

function breadcrumbLabel(pathname: string): string {
  if (pathname === "/") return "Dashboards";
  if (pathname.startsWith("/sources")) return "Data Sources";
  if (pathname.startsWith("/pipelines")) return "Data Pipelines";
  if (pathname.startsWith("/registry")) return "Data Types";
  if (pathname.startsWith("/metrics")) return "Metrics";
  if (pathname.startsWith("/chat")) return "Assistant";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Dashboards";
}

/** Rendered for any route that doesn't match a real page — including while
 * unauthenticated, so it never depends on `AppShell`/auth context (design.md
 * D-shell). Replaces the previous silent `<Navigate to="/" />` redirect
 * (F-188): a genuinely unknown URL now says so instead of pretending nothing
 * happened. */
function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="app-not-found">
      <EmptyState
        icon={faCompass}
        title="Page not found"
        description="That page doesn't exist or may have moved."
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    </div>
  );
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
  const selectedDashboard = items.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;
  // F-096: an unsaved pick in `DashboardAppearanceEditor`'s popover — live-previewed here (shell
  // background) and in `PanelList` (grid background) before Save actually persists it.
  const [draftAppearance, setDraftAppearance] = useState<DashboardAppearance | null>(null);
  const selectedDashboardName = selectedDashboard?.name ?? "No dashboard selected";

  // Resolve the currently-active item name for the section breadcrumb. Each
  // section derives its selection differently (sources/types/conversations via
  // Redux, pipelines via the route :id, dashboards via Redux), so we
  // centralise the lookup here to keep the header concise.
  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const dataTypes = useAppSelector((state) => state.dataTypes);
  const metrics = useAppSelector((state) => state.metrics);
  const conversations = useAppSelector((state) => state.assistantConversations);
  // Registry only ever lists pipeline-bound output types (strict
  // source→pipeline→type→panel; see the sidebar's own SidebarBody.tsx) — the
  // breadcrumb and the phone sheet must agree on that same filtered set, or
  // the title text and the sheet's active-item highlight could disagree.
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  const pipelineNameByTypeId = useAppSelector(selectPipelineNameByOutputTypeId);
  const mobileSection = sectionFromPathname(location.pathname);
  const pipelineRouteId = location.pathname.startsWith("/pipelines/")
    ? location.pathname.split("/")[2]
    : null;
  const metricRouteId = location.pathname.startsWith("/metrics/")
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
    if (mobileSection === "metrics" && metricRouteId !== null) {
      return metrics.items.find((m) => m.id === metricRouteId)?.name ?? null;
    }
    if (mobileSection === "chat") {
      const id = conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;
      return conversations.items.find((c) => c.id === id)?.title ?? null;
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
        return pipelineOutputDataTypes.map((dataType) => {
          // Provenance subtitle: which pipeline produces this DataType. Omitted
          // when no pipeline is loaded for it, mirroring the desktop sidebar
          // (HEL-270).
          const pipelineName = pipelineNameByTypeId.get(dataType.id);
          return {
            id: dataType.id,
            name: dataType.name,
            isActive: dataType.id === effectiveTypeId,
            subtitle: pipelineName !== undefined ? `Pipeline: ${pipelineName}` : undefined,
          };
        });
      }
      case "metrics":
        return metrics.items.map((metric) => ({
          id: metric.id,
          name: metric.name,
          isActive: metric.id === metricRouteId,
        }));
      case "chat": {
        const effectiveConversationId =
          conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;
        return conversations.items.map((conversation) => ({
          id: conversation.id,
          name: conversation.title,
          isActive: conversation.id === effectiveConversationId,
        }));
      }
      case "other":
        // Settings + the proposal/patch-set review routes aren't a picker
        // section (F-016) — the phone title control is hidden entirely for
        // them (see `mobileTitleVisible` below), so this is never read.
        return [];
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
  // F-003/F-016: every real picker section shows the phone title/switcher
  // unconditionally now, including "dashboards" with zero items (previously
  // gated on `selectedDashboard !== null`, which made the switcher — and so
  // the only path to the create-dashboard sheet — unreachable for a
  // zero-dashboard phone user). "other" (Settings, the proposal/patch-set
  // review routes) is a real, non-picker destination, so it never shows a
  // section switcher at all rather than falling through to the dashboards
  // one (F-016).
  const mobileTitleVisible = mobileSection !== "other";

  const mobileSheetEmptyMessage: Record<typeof mobileSection, string> = {
    dashboards: "No dashboards yet.",
    sources: "No data sources yet.",
    pipelines: "No pipelines yet.",
    registry: "No types yet.",
    metrics: "No metrics yet.",
    chat: "No conversations yet.",
    other: "",
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
      case "metrics":
        navigate(`/metrics/${item.id}`);
        return;
      case "chat":
        dispatch(setSelectedConversationId(item.id));
        return;
      case "other":
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
    const section = breadcrumbLabel(location.pathname);
    const itemName = onDashboardView ? selectedDashboardName : breadcrumbItemName;
    document.title =
      itemName && itemName !== "No dashboard selected"
        ? `${itemName} · ${section} · Helio`
        : `${section} · Helio`;
  }, [location.pathname, onDashboardView, selectedDashboardName, breadcrumbItemName]);

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

  // Quick-launcher keyboard shortcut (design.md D7) -- Cmd/Ctrl+K, the conventional "quick open"
  // binding, additive alongside the command-bar trigger button.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsQuickLauncherOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  // The phone registry sheet resolves each DataType's producing pipeline for its
  // provenance subtitle (HEL-270). Fetch pipelines when the registry section is
  // active and not yet loaded — status-gated so a sidebar-driven fetch and this
  // one don't loop. Mirrors the desktop `SidebarBody` registry-section fetch.
  useEffect(() => {
    if (mobileSection === "registry" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [dispatch, mobileSection, pipelines.status]);

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
    <SaveStateContext.Provider value={saveStateContextValue}>
      {/* F-089: first focusable element on every load, targeting the real
          <main> landmark below (F-088) so keyboard/screen-reader users can
          bypass the 11 chrome tab-stops that otherwise precede page content. */}
      <a href="#app-main-content" className="app-skip-link">
        Skip to content
      </a>
      <div className="app-shell" style={shellStyle}>
        {/* -- COMMAND BAR -- */}
        <header className="app-command-bar">
          <div className="app-command-bar__left">
            {/* F-185: the wordmark is a real link home, not inert chrome. */}
            <Link to="/" className="app-command-bar__logo" aria-label="Helio home">
              <OrbitMark />
              <span className="app-command-bar__wordmark">Helio</span>
            </Link>
            <span className="app-command-bar__sep" aria-hidden="true" />
            <nav className="app-command-bar__breadcrumb" aria-label="Breadcrumb">
              <span>{breadcrumbLabel(location.pathname)}</span>
              {onDashboardView && selectedDashboard !== null && (
                <>
                  <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span
                    className="app-command-bar__breadcrumb-current"
                    title={selectedDashboardName}
                  >
                    {selectedDashboardName}
                  </span>
                </>
              )}
              {!onDashboardView && breadcrumbItemName !== null && (
                <>
                  <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="app-command-bar__breadcrumb-current" title={breadcrumbItemName}>
                    {breadcrumbItemName}
                  </span>
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
                {/* F-186: `undo-redo-btn` used to be its own full button recipe,
                    byte-identical to `.cmd-btn`'s hover/disabled states — it's
                    now just a marker class the <=768px media query hides on,
                    with `.cmd-btn` supplying the actual look. */}
                <button
                  type="button"
                  className="cmd-btn undo-redo-btn"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="Undo layout change"
                  title="Undo (Ctrl+Z)"
                >
                  <FontAwesomeIcon icon={faArrowRotateLeft} /> Undo
                </button>
                <button
                  type="button"
                  className="cmd-btn undo-redo-btn"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="Redo layout change"
                  title="Redo (Ctrl+Shift+Z)"
                >
                  Redo <FontAwesomeIcon icon={faArrowRotateRight} />
                </button>
              </>
            )}
            {onDashboardView && (
              <DashboardAppearanceEditor
                dashboard={selectedDashboard}
                onPreviewChange={setDraftAppearance}
              />
            )}
            {onDashboardView && selectedDashboard !== null && (
              <button
                type="button"
                className="cmd-btn cmd-btn--icon"
                onClick={() => setIsRefinementOpen(true)}
                aria-label="Refine this dashboard with AI"
                title="Refine with AI"
              >
                <FontAwesomeIcon icon={faCommentDots} />
              </button>
            )}
            {/* Quick-launcher trigger (design.md D7) -- mirrors the theme-toggle button's exact
                recipe below (same .cmd-btn.cmd-btn--icon classes), genuinely unconditional (unlike
                "Refine with AI" above, which is gated to the dashboard view). F-082: suppressed on
                /chat itself -- that route already IS the assistant surface this button opens. */}
            {!location.pathname.startsWith("/chat") && (
              <button
                type="button"
                className="cmd-btn cmd-btn--icon"
                onClick={() => setIsQuickLauncherOpen(true)}
                aria-label="Open assistant"
                title="Assistant (Ctrl/Cmd+K)"
              >
                <FontAwesomeIcon icon={faComments} />
              </button>
            )}
            <button
              type="button"
              className="cmd-btn cmd-btn--icon"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
            </button>
            {authStatus === "authenticated" && currentUser !== null && (
              <UserMenu
                currentUser={currentUser}
                accentColor={accentColor}
                setAccentColor={setAccentColor}
                onNavigateToSettings={() => navigate("/settings")}
                onLogout={() => void handleLogout()}
              />
            )}
          </div>
        </header>

        {/* -- BODY (sidebar + content) -- */}
        <div className="app-body">
          {/* F-018: collapsing used to remove primary navigation entirely,
              leaving only an unlabeled 20x48px strip as the way back, and the
              state reset on every reload. Collapsed now keeps an icon-only
              nav rail (still real <NavLink>s, still all 6 destinations) and
              a properly sized, labeled toggle; the preference persists via
              the effect above. `.app-sidebar--collapsed` (previously dead
              CSS with zero references) now drives this real state. */}
          <aside
            className={
              isDashboardListCollapsed ? "app-sidebar app-sidebar--collapsed" : "app-sidebar"
            }
          >
            <div className="app-sidebar__nav-row">
              <nav className="app-sidebar__nav" aria-label="Main navigation">
                {navDestinations.map((destination) => {
                  const Icon = destination.icon;
                  return (
                    <NavLink
                      key={destination.to}
                      to={destination.to}
                      end={destination.end}
                      className="app-sidebar__nav-link"
                      title={isDashboardListCollapsed ? destination.label : undefined}
                    >
                      <Icon className="app-sidebar__nav-icon" size={16} aria-hidden="true" />
                      <span className="app-sidebar__nav-label">{destination.label}</span>
                    </NavLink>
                  );
                })}
              </nav>
              <button
                type="button"
                className="app-sidebar-toggle"
                aria-label={isDashboardListCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!isDashboardListCollapsed}
                onClick={() => setIsDashboardListCollapsed((collapsed) => !collapsed)}
              >
                {isDashboardListCollapsed ? (
                  <PanelLeftOpen size={16} />
                ) : (
                  <PanelLeftClose size={16} />
                )}
              </button>
            </div>
            {!isDashboardListCollapsed && <SidebarBody />}
          </aside>
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
                  ? breadcrumbLabel(location.pathname)
                  : `${breadcrumbLabel(location.pathname)}: ${selectedDashboardName}`
                : breadcrumbItemName !== null
                  ? `${breadcrumbLabel(location.pathname)}: ${breadcrumbItemName}`
                  : breadcrumbLabel(location.pathname)}
            </h1>
            <ErrorBoundary resetKey={`${location.pathname}:${selectedDashboardId ?? ""}`}>
              <DashboardAppearancePreviewContext.Provider value={draftAppearance}>
                <Outlet />
              </DashboardAppearancePreviewContext.Provider>
            </ErrorBoundary>
          </main>
        </div>

        {/* Phone-only section nav — hidden >=768px via BottomNav.css; every
            protected route renders it so no route is a navigation trap
            (notes/mobile-pwa-handoff.md §W3.3). */}
        <BottomNav />
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
      <MobileNavSheet
        open={isMobileNavSheetOpen}
        onClose={() => setIsMobileNavSheetOpen(false)}
        title={mobileSheetTitle}
        items={mobileSheetItems}
        onSelect={handleMobileSheetSelect}
        emptyMessage={mobileSheetEmptyMessage[mobileSection]}
      />
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
    </SaveStateContext.Provider>
  );
}

export function App() {
  const dispatch = useAppDispatch();
  const authStatus = useAppSelector((state) => state.auth.status);

  // F-207: gated on "idle" (mirroring `fetchPipelines`'s gate elsewhere in
  // this file) so React StrictMode's dev-only double-invoke of this effect
  // doesn't fire a second, redundant `GET /api/auth/me` — the first dispatch
  // already flips `status` off "idle" before the second invocation runs.
  useEffect(() => {
    if (authStatus === "idle") {
      void dispatch(rehydrateAuth());
    }
  }, [dispatch, authStatus]);

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
            <Route path="/registry/:id" element={<TypeRegistryPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/metrics/:id" element={<MetricDetailPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/proposals/review" element={<ProposalReviewPage />} />
            <Route path="/patch-sets/review" element={<PatchSetReviewPage />} />
          </Route>
        </Route>

        {/* Fallback — F-188: a real "not found" page instead of a silent redirect. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
