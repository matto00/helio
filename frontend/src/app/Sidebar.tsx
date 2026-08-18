import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";

import { SidebarBody } from "../shared/chrome/SidebarBody";
import { navDestinations } from "../shared/chrome/navDestinations";
import { IconButton } from "../shared/ui/IconButton";

interface SidebarProps {
  isDashboardListCollapsed: boolean;
  onToggleCollapse: () => void;
}

/** The desktop sidebar: the nav rail (from `navDestinations`, derived from
 * the shared `sections.ts` registry), the collapse toggle, and
 * `SidebarBody`'s per-section list. */
export function Sidebar({ isDashboardListCollapsed, onToggleCollapse }: SidebarProps) {
  return (
    // F-018: collapsing used to remove primary navigation entirely,
    // leaving only an unlabeled 20x48px strip as the way back, and the
    // state reset on every reload. Collapsed now keeps an icon-only
    // nav rail (still real <NavLink>s, still all 6 destinations) and
    // a properly sized, labeled toggle; the preference persists via
    // an effect in `AppShell`. `.app-sidebar--collapsed` (previously dead
    // CSS with zero references) now drives this real state.
    <aside
      className={isDashboardListCollapsed ? "app-sidebar app-sidebar--collapsed" : "app-sidebar"}
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
        <IconButton
          icon={
            isDashboardListCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />
          }
          variant="secondary"
          size="sm"
          className="app-sidebar-toggle"
          aria-label={isDashboardListCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!isDashboardListCollapsed}
          onClick={onToggleCollapse}
        />
      </div>
      {!isDashboardListCollapsed && <SidebarBody />}
    </aside>
  );
}
