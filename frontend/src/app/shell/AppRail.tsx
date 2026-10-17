import { PanelLeftOpen, Settings } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { logout } from "../../features/auth/state/authSlice";
import { UserMenu } from "../../features/auth/ui/UserMenu";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import {
  homeAlias,
  isDestinationActive,
  navDestinations,
} from "../../shared/chrome/navDestinations";
import { OrbitMark } from "../../shared/chrome/OrbitMark";
import { useIndicatorSlide } from "../../shared/motion/useIndicatorSlide";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import { takeListFocus } from "./contextListLayout";
import "./AppRail.css";

interface AppRailProps {
  /** Whether the current section has a context list at all (Connectors, Settings and review routes do not). */
  sectionHasList: boolean;
  listCollapsed: boolean;
  onExpandList: () => void;
}

/** The 56px icon rail (DESIGN.md §9): always rendered above the phone breakpoint, so every section stays one click
 *  away with the context list collapsed. Icon-only; every item has a `title` tooltip and an accessible name. Only the
 *  active item is accent-washed, by an indicator that slides between items (HEL-1573). Usage is not a rail
 *  item: owners reach it from the avatar menu. */
export function AppRail({ sectionHasList, listCollapsed, onExpandList }: AppRailProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const authStatus = useAppSelector((state) => state.auth.status);
  const HomeIcon = homeAlias.icon;
  const homeActive = isDestinationActive(homeAlias, pathname);
  const settingsActive = pathname.startsWith("/settings");
  const railRef = useIndicatorSlide<HTMLDivElement>();

  async function handleLogout() {
    await dispatch(logout());
    void navigate("/login");
  }

  return (
    <div className="app-rail" ref={railRef}>
      <span className="motion-indicator app-rail__indicator" aria-hidden="true" />
      <Link to={homeAlias.to} className="app-rail__logo" aria-label="Helio home" title="Helio">
        <OrbitMark size={20} />
      </Link>
      <nav className="app-rail__nav" aria-label="Main navigation">
        <Link
          to={homeAlias.to}
          className={homeActive ? "app-rail__item app-rail__item--active" : "app-rail__item"}
          aria-label={homeAlias.label}
          aria-current={homeActive ? "page" : undefined}
          data-indicator-active={homeActive ? "" : undefined}
          title={homeAlias.label}
        >
          <HomeIcon size={ICON_SIZE.lg} aria-hidden="true" />
        </Link>
        {navDestinations.map((destination) => {
          const Icon = destination.icon;
          const active = isDestinationActive(destination, pathname);
          return (
            <Link
              key={destination.to}
              to={destination.to}
              className={active ? "app-rail__item app-rail__item--active" : "app-rail__item"}
              aria-label={destination.label}
              aria-current={active ? "page" : undefined}
              data-indicator-active={active ? "" : undefined}
              title={destination.label}
            >
              <Icon size={ICON_SIZE.lg} aria-hidden="true" />
            </Link>
          );
        })}
      </nav>
      <div className="app-rail__foot">
        {sectionHasList && listCollapsed && (
          <button
            type="button"
            className="app-rail__item"
            aria-label="Expand list"
            aria-expanded={false}
            aria-controls="context-list"
            ref={(element) => {
              if (element !== null && takeListFocus("expand-button")) element.focus();
            }}
            title="Expand list"
            onClick={onExpandList}
          >
            <PanelLeftOpen size={ICON_SIZE.lg} aria-hidden="true" />
          </button>
        )}
        <Link
          to="/settings"
          className={settingsActive ? "app-rail__item app-rail__item--active" : "app-rail__item"}
          aria-label="Settings"
          aria-current={settingsActive ? "page" : undefined}
          data-indicator-active={settingsActive ? "" : undefined}
          title="Settings"
        >
          <Settings size={ICON_SIZE.lg} aria-hidden="true" />
        </Link>
        {authStatus === "authenticated" && currentUser !== null && (
          <UserMenu
            currentUser={currentUser}
            onNavigateToSettings={() => navigate("/settings")}
            onLogout={() => void handleLogout()}
            placement="rail"
          />
        )}
      </div>
    </div>
  );
}
