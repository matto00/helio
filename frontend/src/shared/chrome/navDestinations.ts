import type { LucideIcon } from "lucide-react";
import { BarChart3, CircleUser, House } from "lucide-react";

import { isDashboardViewPath, isNavSection, sections, type PickerId } from "./sections";

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
  /** Extra route prefixes that also mark this destination current (HEL-1583: the phone Data tab owns `/connectors`,
   * the Me tab owns `/settings` and `/admin/usage`). Only the phone tabs set it; the rail's destinations never do. */
  activePrefixes?: readonly string[];
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

/** A phone tab that is a menu rather than a route (HEL-1583: Me opens the user menu). It has no `to`, so there is no
 * placeholder path; its active state comes from `activePrefixes` alone. */
export interface MenuNavTab {
  kind: "menu";
  label: string;
  icon: LucideIcon;
  activePrefixes: readonly string[];
}

/** One phone `BottomNav` tab: a route link or a menu button. */
export type PhoneNavTab = (NavDestination & { kind: "route" }) | MenuNavTab;

function navEntry(pickerId: PickerId): NavDestination {
  const section = sections.find((entry) => entry.showInNav && entry.pickerId === pickerId);
  const destination = navDestinations.find((entry) => entry.to === section?.path);
  if (!destination) throw new Error(`No nav destination for the "${pickerId}" section`);
  return destination;
}

const connectorsPath = sections.find((entry) => entry.label === "Connectors")?.path ?? "";
const settingsPath = sections.find((entry) => entry.label === "Settings")?.path ?? "";

/** The phone tab bar (HEL-1583, owner answer `assistant-to-header`): Home, Dashboards, Data, Pipelines, Me. Derived from
 * `homeAlias` and the registry's own destinations: only the labels ("Data", "Pipelines") and the extra
 * `activePrefixes` are phone-specific. Connectors, Assistant and Usage stay rail-only destinations; the phone reaches
 * them through the Data sub-row, the header's "Open assistant" button and the Me menu. */
export const phoneNavTabs: PhoneNavTab[] = [
  { kind: "route", ...homeAlias },
  { kind: "route", ...navEntry("dashboards") },
  { kind: "route", ...navEntry("sources"), label: "Data", activePrefixes: [connectorsPath] },
  { kind: "route", ...navEntry("pipelines"), label: "Pipelines" },
  {
    kind: "menu",
    label: "Me",
    icon: CircleUser,
    activePrefixes: [settingsPath, adminUsageDestination.to],
  },
];

/** The two pages the phone Data tab covers, in sub-row order (HEL-1583 `DataSectionTabs`): the Data tab's own route and
 * its extra Connectors prefix, so the sub-row can never name a path the tab does not own. */
export const dataSectionLinks: ReadonlyArray<{ to: string; label: string }> = [
  { to: navEntry("sources").to, label: "Sources" },
  { to: connectorsPath, label: "Connectors" },
];

/** Whether a rail / BottomNav item is the current one. Home owns `/home`; the dashboards destination (the only other
 * `end` entry, `/dashboards`) owns the dashboard view, which includes `/dashboards/:id`; every other destination owns
 * its path prefix. Shared by both surfaces so they cannot drift. */
export function isDestinationActive(
  destination: NavDestination | MenuNavTab,
  pathname: string,
): boolean {
  const underPrefix = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if ("kind" in destination && destination.kind === "menu") {
    return destination.activePrefixes.some(underPrefix);
  }
  const route = destination as NavDestination;
  if (route.to === homeAlias.to) return pathname === homeAlias.to;
  if (route.end) return isDashboardViewPath(pathname);
  return underPrefix(route.to) || (route.activePrefixes ?? []).some(underPrefix);
}
