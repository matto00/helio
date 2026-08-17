import type { LucideIcon } from "lucide-react";
import { BookOpen, Database, Gauge, LayoutDashboard, MessageSquare, Workflow } from "lucide-react";

/** A single top-level section destination. Shared by the desktop sidebar nav
 * (`App.tsx`) and the phone `BottomNav` so the two surfaces can never drift —
 * add or change a destination here and both pick it up. */
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

// F-009/F-085: "Chat" renamed to "Assistant" — the interaction surfaces this
// destination opens onto (QuickLauncherOverlay, the command-bar trigger, the
// message-turn role label) already used "Assistant"; this was the one
// structural label still saying "Chat". The route path (/chat) is unchanged.
export const navDestinations: NavDestination[] = [
  { to: "/", end: true, label: "Dashboards", shortLabel: "Home", icon: LayoutDashboard },
  { to: "/sources", label: "Data Sources", shortLabel: "Sources", icon: Database },
  { to: "/pipelines", label: "Data Pipelines", shortLabel: "Pipelines", icon: Workflow },
  { to: "/registry", label: "Data Types", shortLabel: "Types", icon: BookOpen },
  { to: "/metrics", label: "Metrics", icon: Gauge },
  { to: "/chat", label: "Assistant", icon: MessageSquare },
];
