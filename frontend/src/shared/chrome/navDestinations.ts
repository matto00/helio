import type { LucideIcon } from "lucide-react";

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
