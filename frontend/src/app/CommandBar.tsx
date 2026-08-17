import { ChevronDown } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateLeft,
  faArrowRotateRight,
  faComments,
  faCommentDots,
  faSun,
  faMoon,
} from "@fortawesome/free-solid-svg-icons";

import { UserMenu } from "../features/auth/ui/UserMenu";
import { logout } from "../features/auth/state/authSlice";
import { DashboardAppearanceEditor } from "../features/dashboards/ui/DashboardAppearanceEditor";
import { setDashboardLayoutLocally } from "../features/dashboards/state/dashboardsSlice";
import type { DashboardAppearance } from "../features/dashboards/types/dashboard";
import {
  redoLayout,
  selectCanRedo,
  selectCanUndo,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "../features/layout/state/layoutHistorySlice";
import { useLayoutUndoRedo } from "../features/layout/hooks/useLayoutUndoRedo";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { OrbitMark } from "../shared/chrome/OrbitMark";
import { SaveStateIndicator } from "../shared/chrome/SaveStateIndicator";
import { pickerIdForPathname } from "../shared/chrome/sections";
import { usePickerSelection } from "../shared/chrome/usePickerSelection";
import { useSaveState } from "../context/SaveStateContext";
import { useTheme } from "../theme/ThemeProvider";

interface CommandBarProps {
  isMobileNavSheetOpen: boolean;
  onOpenMobileNavSheet: () => void;
  onOpenRefinement: () => void;
  onOpenQuickLauncher: () => void;
  draftAppearance: DashboardAppearance | null;
  setDraftAppearance: (appearance: DashboardAppearance | null) => void;
}

/** The command bar: logo, breadcrumb, phone title/switcher trigger,
 * save-state indicator, undo/redo, appearance editor, refine-with-AI, the
 * quick-launcher trigger, theme toggle, and the user menu. Owns undo/redo
 * entirely (design.md "App.tsx split boundary") since it's unconditionally
 * mounted for exactly `AppShell`'s lifetime. Reads `usePickerSelection`
 * directly rather than receiving a hand-drilled prop bag. */
export function CommandBar({
  isMobileNavSheetOpen,
  onOpenMobileNavSheet,
  onOpenRefinement,
  onOpenQuickLauncher,
  draftAppearance,
  setDraftAppearance,
}: CommandBarProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { flush } = useSaveState();
  const { theme, toggleTheme, accentColor, setAccentColor } = useTheme();

  const { items, selectedDashboardId } = useAppSelector((state) => state.dashboards);
  const authStatus = useAppSelector((state) => state.auth.status);
  const currentUser = useAppSelector((state) => state.auth.currentUser);

  const onDashboardView = location.pathname === "/";
  const selectedDashboard = items.find((dashboard) => dashboard.id === selectedDashboardId) ?? null;
  const selectedDashboardName = selectedDashboard?.name ?? "No dashboard selected";

  const pickerSelection = usePickerSelection(location.pathname);
  const pickerId = pickerIdForPathname(location.pathname);
  const mobileTitleDisplayName =
    pickerId === "dashboards"
      ? selectedDashboardName
      : (pickerSelection.activeItemName ?? pickerSelection.heading);
  // F-003/F-016: every real picker section shows the phone title/switcher
  // unconditionally now, including "dashboards" with zero items (previously
  // gated on `selectedDashboard !== null`, which made the switcher — and so
  // the only path to the create-dashboard sheet — unreachable for a
  // zero-dashboard phone user). "other" (Settings, the proposal/patch-set
  // review routes) is a real, non-picker destination, so it never shows a
  // section switcher at all rather than falling through to the dashboards
  // one (F-016).
  const mobileTitleVisible = pickerId !== "other";

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

  return (
    <header className="app-command-bar">
      <div className="app-command-bar__left">
        {/* F-185: the wordmark is a real link home, not inert chrome. */}
        <Link to="/" className="app-command-bar__logo" aria-label="Helio home">
          <OrbitMark />
          <span className="app-command-bar__wordmark">Helio</span>
        </Link>
        <span className="app-command-bar__sep" aria-hidden="true" />
        <nav className="app-command-bar__breadcrumb" aria-label="Breadcrumb">
          <span>{pickerSelection.heading}</span>
          {onDashboardView && selectedDashboard !== null && (
            <>
              <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span className="app-command-bar__breadcrumb-current" title={selectedDashboardName}>
                {selectedDashboardName}
              </span>
            </>
          )}
          {!onDashboardView && pickerSelection.activeItemName !== null && (
            <>
              <span className="app-command-bar__breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span
                className="app-command-bar__breadcrumb-current"
                title={pickerSelection.activeItemName}
              >
                {pickerSelection.activeItemName}
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
            onClick={onOpenMobileNavSheet}
            aria-haspopup="dialog"
            aria-expanded={isMobileNavSheetOpen}
            aria-label={`Switch ${pickerSelection.heading.toLowerCase()} (current: ${mobileTitleDisplayName})`}
          >
            <span className="app-command-bar__mobile-title-name" aria-hidden="true">
              {mobileTitleDisplayName}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
        {onDashboardView && selectedDashboard !== null && <SaveStateIndicator onSaveNow={flush} />}
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
            onClick={onOpenRefinement}
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
            onClick={onOpenQuickLauncher}
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
  );
}
