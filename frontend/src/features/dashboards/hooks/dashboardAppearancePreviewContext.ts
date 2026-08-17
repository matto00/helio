import { createContext, useContext } from "react";

import type { DashboardAppearance } from "../types/dashboard";

/**
 * F-096: broadcasts `DashboardAppearanceEditor`'s in-popover, unsaved draft appearance (or `null`
 * once the popover closes) so any surface that renders the dashboard can live-preview it ahead of
 * Save — `App.tsx`'s shell background reads it directly (same component scope); `PanelList.tsx`'s
 * grid background reads it via this context because `App.tsx`'s route tree renders `PanelList`
 * through `<Outlet />` (a React Router nested route), one level below `AppShell`'s own function
 * scope, where a plain prop can't reach it without threading through the route table itself.
 *
 * Defaults to `null` (no draft in progress) — every existing consumer that doesn't sit under
 * `App.tsx`'s provider (e.g. component tests rendering `PanelList` standalone) sees the same
 * "use the dashboard's saved appearance" behavior as before this context existed.
 */
export const DashboardAppearancePreviewContext = createContext<DashboardAppearance | null>(null);

export function useDashboardAppearancePreview(): DashboardAppearance | null {
  return useContext(DashboardAppearancePreviewContext);
}
