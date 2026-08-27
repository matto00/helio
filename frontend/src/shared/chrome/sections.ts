import type { LucideIcon } from "lucide-react";
import {
  ChartNoAxesColumn,
  Database,
  LayoutDashboard,
  Link2,
  MessageCircle,
  Shapes,
  Workflow,
} from "lucide-react";

/** Which picker/list a route belongs to — the same narrow union
 * `SidebarBody`'s old `sectionFromPathname` returned. Says *which* section's
 * selection logic (`usePickerSelection`) applies to a route; it does not by
 * itself carry label/icon/nav-visibility — see `SectionEntry`. Multiple
 * routes can share a `pickerId` of `"other"` while keeping distinct labels
 * (`/settings`, `/proposals/review`, `/patch-sets/review` — none of them are
 * a pickable list section). */
export type PickerId =
  | "dashboards"
  | "sources"
  | "pipelines"
  | "registry"
  | "metrics"
  | "chat"
  | "other";

interface SectionEntryBase {
  /** Route path this entry matches. Exact-match (`end: true`) or prefix
   * match — see `findSection` below. */
  path: string;
  /** `true` for exact-match routes (currently only `/`, so it doesn't stay
   * "active"/matched for every nested route). Passed straight through to
   * `NavLink`'s own `end` prop for nav-visible entries. */
  end?: boolean;
  pickerId: PickerId;
  label: string;
}

/** `icon` is required whenever `showInNav` is `true` (a nav-visible entry
 * needs something to render in the sidebar rail / bottom tab bar) and absent
 * otherwise — encoded as a discriminated union so `navDestinations.ts` never
 * needs a non-null assertion to satisfy `NavDestination.icon`'s existing
 * required type. */
export type SectionEntry =
  | (SectionEntryBase & { showInNav: true; icon: LucideIcon })
  | (SectionEntryBase & { showInNav: false; icon?: never });

/** The single source of truth for every route the authenticated shell
 * renders: `{path, label, icon?, showInNav, pickerId}`. The desktop
 * breadcrumb, `document.title`, the phone title/sheet, the sidebar nav rail,
 * and `BottomNav` all derive their route→label/icon mapping from this array
 * — no component hardcodes an independent one.
 *
 * Order is most-specific-first (kept from the old `sectionFromPathname`):
 * `/` is the only exact-match (`end: true`) entry, since every path starts
 * with "/" — everything else prefix-matches, which also covers nested detail
 * routes (`/pipelines/:id`, `/registry/:id`, `/metrics/:id`). */
export const sections: SectionEntry[] = [
  {
    path: "/",
    end: true,
    pickerId: "dashboards",
    label: "Dashboards",
    icon: LayoutDashboard,
    showInNav: true,
  },
  {
    path: "/sources",
    pickerId: "sources",
    label: "Data Sources",
    icon: Database,
    showInNav: true,
  },
  {
    path: "/pipelines",
    pickerId: "pipelines",
    label: "Data Pipelines",
    icon: Workflow,
    showInNav: true,
  },
  // HEL-824: a real nav destination alongside Data Sources / Data Pipelines, but not a
  // pickable sidebar-list section (`pickerId: "other"`, matching Settings' own shape) — the
  // Connectors page owns its own list rendering rather than driving `SidebarItemList`.
  {
    path: "/connectors",
    pickerId: "other",
    label: "Connectors",
    icon: Link2,
    showInNav: true,
  },
  {
    path: "/registry",
    pickerId: "registry",
    label: "Data Types",
    // HEL-774: BookOpen -> Shapes. Dropping BottomNav's visible labels makes
    // the glyph the sole carrier of meaning, and an open book reads as
    // documentation/a library, not a registry of row shapes — Shapes reads
    // as "kinds of things", which is what a type registry is (D11). Also
    // reaches the desktop sidebar, which keeps its label, so the change is
    // cosmetic there and corrective here; leaving the two surfaces on
    // different icons would break this registry's single-source-of-truth
    // guarantee.
    icon: Shapes,
    showInNav: true,
  },
  {
    path: "/metrics",
    pickerId: "metrics",
    label: "Metrics",
    icon: ChartNoAxesColumn,
    showInNav: true,
  },
  {
    path: "/chat",
    // F-009/F-085: "Chat" renamed to "Assistant" — the interaction surfaces
    // this destination opens onto (QuickLauncherOverlay, the command-bar
    // trigger, the message-turn role label) already used "Assistant". The
    // route path (/chat) is unchanged.
    pickerId: "chat",
    label: "Assistant",
    icon: MessageCircle,
    showInNav: true,
  },
  // HEL-724: these three routes are real, distinct chrome destinations, not
  // a pickable list section (`pickerId: "other"`) — but they each get their
  // own label instead of sharing the pre-registry default fallback, which
  // used to silently mislabel all three "Dashboards". This is the deliberate,
  // intended label change the ticket calls for.
  {
    path: "/settings",
    pickerId: "other",
    label: "Settings",
    showInNav: false,
  },
  {
    path: "/proposals/review",
    pickerId: "other",
    label: "Review Proposal",
    showInNav: false,
  },
  {
    path: "/patch-sets/review",
    pickerId: "other",
    label: "Review Changes",
    showInNav: false,
  },
  // HEL-739: same "other"-picker, non-nav review-route treatment as the two
  // entries above — without these, both routes silently fell through to the
  // "Dashboards" default (the identical HEL-724 bug class, re-caught by the
  // final-gate skeptic).
  {
    path: "/pipeline-proposals/review",
    pickerId: "other",
    label: "Review Pipeline Proposal",
    showInNav: false,
  },
  {
    path: "/combined-proposals/review",
    pickerId: "other",
    label: "Review Combined Proposal",
    showInNav: false,
  },
];

/** Type guard narrowing `SectionEntry` to its nav-visible variant (icon
 * guaranteed present) — used by `navDestinations.ts`'s derivation. */
export function isNavSection(
  section: SectionEntry,
): section is Extract<SectionEntry, { showInNav: true }> {
  return section.showInNav;
}

function findSection(pathname: string): SectionEntry | undefined {
  return sections.find((section) =>
    section.end ? pathname === section.path : pathname.startsWith(section.path),
  );
}

/** Resolves the registry entry for a pathname, or `undefined` if the
 * pathname isn't one of the shell's known routes (shouldn't happen for any
 * route actually rendered inside `AppShell` — see `AppRoutes.tsx`). */
export function sectionForPathname(pathname: string): SectionEntry | undefined {
  return findSection(pathname);
}

/** Resolves which picker/list section a route belongs to. Defaults to
 * `"other"` for an unmatched pathname, mirroring the old
 * `sectionFromPathname`'s catch-all. */
export function pickerIdForPathname(pathname: string): PickerId {
  return findSection(pathname)?.pickerId ?? "other";
}

/** Resolves the display label for a route (breadcrumb / `document.title` /
 * phone title). Falls back to "Dashboards", matching the old
 * `breadcrumbLabel`'s ultimate default case — unreachable in practice since
 * every route `AppShell` renders is registered above. */
export function sectionLabel(pathname: string): string {
  return findSection(pathname)?.label ?? "Dashboards";
}
