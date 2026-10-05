// The owner's one-time repair of stored-bad and incomplete layout breakpoints (HEL-1233 owner
// ruling, widened by HEL-1260's `extend-owner-repair`).
//
// Fires at most once per dashboard per mount, at EVERY viewport width (mounted by `PanelGrid`, not
// `DesktopPanelGrid`), and only when: the signed-in user is the dashboard's owner, this dashboard's
// panels have loaded (never on an empty/stale list), and at least one breakpoint is repairable (stored-bad,
// or valid but missing a live panel).
// The server re-checks ownership; the owner check here only avoids calls it would refuse.
//
// It is the ONE deliberate exception to the HEL-301 phone-width "no layout write" guarantee
// (hazard §4.1): it is a POST of the layout the user is already shown, never `updateDashboardLayout`
// or `setLayoutPending`, never a user-edit path, and adds no undo entry (see `useLayoutSave.ts`,
// class 4). A failure is logged once and never retried this mount.

import { useEffect, useRef } from "react";

import { repairDashboardLayout } from "../../dashboards/state/dashboardsSlice";
import { buildRepairPatch, hasRepairableBreakpoint } from "../../dashboards/state/repairPatch";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";

interface UseStoredLayoutRepairOptions {
  dashboardId: string;
  layout: DashboardLayout;
  panels: Panel[];
}

export function useStoredLayoutRepair({
  dashboardId,
  layout,
  panels,
}: UseStoredLayoutRepairOptions): void {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const ownerId = useAppSelector(
    (state) => state.dashboards.items.find((d) => d.id === dashboardId)?.ownerId ?? null,
  );
  const panelsLoaded = useAppSelector(
    (state) =>
      state.panels.status === "succeeded" && state.panels.loadedDashboardId === dashboardId,
  );
  const attemptedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!panelsLoaded || currentUserId === null || ownerId !== currentUserId) return;
    if (attemptedRef.current.has(dashboardId)) return;
    if (!hasRepairableBreakpoint(panels, layout)) return;
    attemptedRef.current.add(dashboardId);
    void dispatch(
      repairDashboardLayout({
        dashboardId,
        layout: buildRepairPatch(panels, layout),
        expectedLayout: layout,
      }),
    )
      .unwrap()
      .catch((message: unknown) => {
        console.warn(`Stored layout repair for dashboard ${dashboardId} not applied:`, message);
      });
  }, [panelsLoaded, currentUserId, ownerId, dashboardId, layout, panels, dispatch]);
}
