import { NavLink } from "react-router-dom";

import "./BottomNav.css";
import { navDestinations } from "./navDestinations";

/**
 * Bottom tab bar for section navigation. Breakpoint-gated entirely in
 * `BottomNav.css` (hidden >=768px) so it is a real, always-mounted shared
 * component rather than a phone-only hack — promoting it to desktop later is
 * a stylesheet change, not a rewrite. See `notes/mobile-pwa-handoff.md` §W3.1.
 */
export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {navDestinations.map((destination) => {
        const Icon = destination.icon;
        return (
          <NavLink
            key={destination.to}
            to={destination.to}
            end={destination.end}
            // F-080: the visible label is the short form (fits the 72px
            // tab); the accessible name stays the full label so screen
            // reader users aren't shortchanged by the space constraint.
            aria-label={destination.label}
            className={({ isActive }) =>
              isActive ? "bottom-nav__tab bottom-nav__tab--active" : "bottom-nav__tab"
            }
          >
            <Icon className="bottom-nav__icon" size={22} aria-hidden="true" />
            <span className="bottom-nav__label" aria-hidden="true">
              {destination.shortLabel ?? destination.label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
