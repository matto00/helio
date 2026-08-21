import { NavLink } from "react-router-dom";

import "./BottomNav.css";
import { navDestinations } from "./navDestinations";

/**
 * Bottom tab bar for section navigation. Breakpoint-gated entirely in
 * `BottomNav.css` (hidden >=768px) so it is a real, always-mounted shared
 * component rather than a phone-only hack — promoting it to desktop later is
 * a stylesheet change, not a rewrite. See `notes/mobile-pwa-handoff.md` §W3.1.
 *
 * HEL-774: icon-only, matching the Instagram Liquid Glass reference — no
 * visible label. Each tab's `aria-label` is now its entire accessible name,
 * not belt-and-braces alongside a visible short label (former F-080).
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
            aria-label={destination.label}
            className={({ isActive }) =>
              isActive ? "bottom-nav__tab bottom-nav__tab--active" : "bottom-nav__tab"
            }
          >
            {/* Dedicated carrier for the active-state lozenge (D6) — never
                style the <svg> directly. Lucide emits width="22"/height="22"
                as presentation attributes, and the global
                `* { box-sizing: border-box }` then resolves padding+border
                inward from that 22px, clamping the icon's content box to 0px
                if the lozenge styling lands on the <svg> itself. */}
            <span className="bottom-nav__lozenge">
              <Icon className="bottom-nav__icon" size={22} aria-hidden="true" />
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
