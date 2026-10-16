import type { LucideIcon } from "lucide-react";
import { BarChart3, House } from "lucide-react";

import { isDashboardViewPath, isNavSection, sections } from "./sections";

/** A single top-level nav destination. Shared by the desktop sidebar nav
 * (`Sidebar.tsx`) and the phone `BottomNav` so the two surfaces can never
 * drift — derived from `sections.ts`'s registry (single source of truth),
 * not maintained as an independent list. */
export interface NavDestination {
  to: string;
  /** Passed straight to `NavLink`'s `end` prop — `true` for `/` so it doesn't
   * stay "active" for every nested route. */
  end?: boolean;
  label: string;
  icon: LucideIcon;
}

export const navDestinations: NavDestination[] = sections.filter(isNavSection).map((section) => ({
  to: section.path,
  end: section.end,
  label: section.label,
  icon: section.icon,
}));

/** HEL-1211: owner-only. Never part of `navDestinations` — appended by `useNavDestinations` only
 * when the signed-in user's tier is `owner`. Hiding it is a convenience; the server's 403 on
 * `GET /api/admin/usage` is the real gate. */
export const adminUsageDestination: NavDestination = {
  to: "/admin/usage",
  label: "Usage",
  icon: BarChart3,
};

/** The Home entry that leads the desktop rail and the phone `BottomNav` (HEL-1574). Outside the registry (the five
 * nav-visible entries stay exactly five). HEL-1578: it opens the real Home page (`/home`, the app home; `/` is the
 * marketing page) and is marked current there, so on `/home` exactly one item is active. */
export const homeAlias: NavDestination = {
  to: "/home",
  end: true,
  label: "Home",
  icon: House,
};

/** Whether a rail / BottomNav item is the current one. Home owns `/home`; the dashboards destination (the only other
 * `end` entry, `/dashboards`) owns the dashboard view, which includes `/dashboards/:id`; every other destination owns
 * its path prefix. Shared by both surfaces so they cannot drift. */
export function isDestinationActive(destination: NavDestination, pathname: string): boolean {
  if (destination.to === homeAlias.to) return pathname === homeAlias.to;
  if (destination.end) return isDashboardViewPath(pathname);
  return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
}
