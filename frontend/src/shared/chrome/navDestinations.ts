import type { LucideIcon } from "lucide-react";
import { BookOpen, Database, LayoutDashboard, Workflow } from "lucide-react";

/** A single top-level section destination. Shared by the desktop sidebar nav
 * (`App.tsx`) and the phone `BottomNav` so the two surfaces can never drift —
 * add or change a destination here and both pick it up. */
export interface NavDestination {
  to: string;
  /** Passed straight to `NavLink`'s `end` prop — `true` for `/` so it doesn't
   * stay "active" for every nested route. */
  end?: boolean;
  label: string;
  icon: LucideIcon;
}

export const navDestinations: NavDestination[] = [
  { to: "/", end: true, label: "Dashboards", icon: LayoutDashboard },
  { to: "/sources", label: "Data Sources", icon: Database },
  { to: "/pipelines", label: "Data Pipelines", icon: Workflow },
  { to: "/registry", label: "Type Registry", icon: BookOpen },
];
