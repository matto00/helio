// Synthetic panel-id stub builder for the dashboard grid's initial-load
// skeleton (HEL-528, design.md D10). Pure and unit-testable — nothing here
// touches React.
//
// The panel COUNT is genuinely unknowable before `fetchPanels` resolves, but
// the skeleton must not hand-place cards or read the saved layout array
// directly: it hands a set of synthetic "stub" panel-id stand-ins to the
// grid's OWN resolver (`resolveDashboardLayout`, `dashboardLayout.ts`) and
// reads the result back — the same function `DesktopPanelGrid`/
// `MobilePanelStack` call with the real, fetched panels.
//
// Choosing which ids to stub with is the one piece of judgment this file
// owns, in three tiers:
//
// 1. The active breakpoint's own saved layout has entries — reuse THOSE
//    panelIds as stubs. `resolveBreakpointLayout`'s exact-match shortcut then
//    returns those saved positions verbatim: one placeholder per layout
//    entry, at that entry's own position and size (D10 scenario 1).
// 2. The active breakpoint is empty, but another breakpoint's saved layout
//    is not — reuse (up to FALLBACK_STUB_COUNT of) THAT breakpoint's real
//    panelIds. `resolveDashboardLayout`'s projection machinery
//    (`effectiveSaved`/`projectLayout`) keys its projected positions by the
//    SOURCE breakpoint's real panelIds, so only a stub whose id matches one
//    of those projected entries receives the projected position — an
//    unrelated made-up id would silently fall through to the resolver's
//    generic default-packed fallback instead, which is not what "projected"
//    means (D10 scenario 3, dominant at `xs` since users drag at desktop
//    widths and leave the phone breakpoint's saved layout empty).
// 3. Every breakpoint's saved layout is empty — there is no real id data to
//    draw from at all. `FALLBACK_STUB_COUNT` synthetic ids let the resolver's
//    own `defaultItemWidth`/`findNextAvailablePosition` fallback placement
//    apply "for free" (D10 scenario 2).
//
// In every tier the delta the spec licenses is placeholder COUNT only — the
// resolver computes per-card geometry exactly, because nothing here invents
// a position.

import {
  dashboardLayoutBreakpoints,
  type DashboardLayoutBreakpoint,
} from "../../dashboards/state/dashboardLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";

/** Placeholder count used when no saved-layout entries exist to draw real
 *  panelIds from (tiers 2's cap and tier 3's synthetic set) — a documented,
 *  non-zero default so the grid never renders an empty area while loading. */
export const FALLBACK_STUB_COUNT = 3;

/** A minimal stand-in for a `Panel` — `resolveDashboardLayout` and its
 *  helpers only ever read `panel.id`, so nothing else needs to be real. Cast
 *  through `unknown` rather than constructing a full discriminated-union
 *  `Panel` (title/config/meta/appearance/...), none of which the resolver
 *  touches. */
function makeStubPanel(id: string): Panel {
  return { id } as unknown as Panel;
}

function richestSavedItems(savedLayout: DashboardLayout): DashboardLayoutItem[] {
  let best: DashboardLayoutItem[] = [];
  for (const bp of dashboardLayoutBreakpoints) {
    const items = savedLayout[bp];
    if (items.length > best.length) {
      best = items;
    }
  }
  return best;
}

/** Builds the synthetic panel stand-ins to feed `resolveDashboardLayout` for
 *  the grid skeleton's active breakpoint. See the file docblock for the
 *  three-tier rule. */
export function buildSkeletonStubPanels(
  savedLayout: DashboardLayout,
  activeBreakpoint: DashboardLayoutBreakpoint,
): Panel[] {
  const activeSaved = savedLayout[activeBreakpoint];
  if (activeSaved.length > 0) {
    return activeSaved.map((item) => makeStubPanel(item.panelId));
  }

  const richest = richestSavedItems(savedLayout);
  if (richest.length > 0) {
    return richest.slice(0, FALLBACK_STUB_COUNT).map((item) => makeStubPanel(item.panelId));
  }

  return Array.from({ length: FALLBACK_STUB_COUNT }, (_, index) =>
    makeStubPanel(`skeleton-stub-${index}`),
  );
}
