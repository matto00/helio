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
  /** Shorter label for width-constrained contexts (F-080: `BottomNav`'s
   * six 72px phone tabs — "Data Pipelines"/"Type Registry" overflowed their
   * slots at the full label). Falls back to `label` when unset. */
  shortLabel?: string;
  icon: LucideIcon;
}

export const navDestinations: NavDestination[] = sections.filter(isNavSection).map((section) => ({
  to: section.path,
  end: section.end,
  label: section.label,
  shortLabel: section.shortLabel,
  icon: section.icon,
}));
