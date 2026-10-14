import type { LucideIcon } from "lucide-react";
import { BarChart3, House } from "lucide-react";

import { isNavSection, sections } from "./sections";

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

/** HEL-1574: the Home entry that leads the desktop rail and the phone `BottomNav`. Outside the registry (the five
 * nav-visible entries stay exactly five): until the Home page exists (HEL-1578) it aliases the dashboards view, `/home` (HEL-1562 moved the app there; `/` is the marketing page).
 * Both surfaces render it as a plain link that is NEVER marked current, so on a dashboard route exactly one item (the
 * Dashboards destination) is active. */
export const homeAlias: NavDestination = {
  to: "/home",
  end: true,
  label: "Home",
  icon: House,
};
